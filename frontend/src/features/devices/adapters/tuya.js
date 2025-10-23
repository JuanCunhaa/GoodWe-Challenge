// src/features/devices/adapters/tuya.js
import { integrationsApi } from '../../../services/integrationsApi.js'
import { batch, safeParse } from '../utils.js'

// caches in-memory por sessão (não reativos, mas suficientes p/ debug e envio)
const codeCache = new Map()      // deviceId -> code (ex.: 'switch', 'switch_1', 'switch_led', 'power')
const funcSchema = new Map()     // deviceId -> { [code]: { type, valuesParsed } }

function normalizeTuyaDevice(d) {
  const id = String(d.id || d.uuid || '')
  const name = String(d.name || d.local_key || 'Device')
  const category = String(d.category || d.product_id || '').toLowerCase()
  const online = !!d.online
  const looksSwitch =
    category.includes('switch') ||
    category.includes('socket') ||
    category.includes('plug') ||
    category.includes('light') ||
    ['cz', 'dj'].some(k => category.includes(k))
  return {
    id, name, category, online,
    vendor: 'tuya',
    roomId: '',
    components: [{ id: 'main', capabilities: looksSwitch ? [{ id: 'switch' }] : [] }],
  }
}

function pickOnOffCodeFromFunctions(funcs = []) {
  const isBool = (x) => {
    const t = String(x?.type || '').toLowerCase()
    return t === 'bool' || t === 'boolean'
  }
  const isEnum = (x) => String(x?.type || '').toLowerCase() === 'enum'
  const mainSwitchCodes = ['switch','switch_spray','switch_1','switch_2','switch_3','switch_main','power','power_switch','device_switch','master_switch','power_go','light','switch_led','switch_charge']
  // 1) Prefer boolean main switch-like codes
  for (const code of mainSwitchCodes) {
    const f = funcs.find(x => x?.code === code && isBool(x))
    if (f) return f
  }
  // 2) Generic boolean that looks like power/switch/spray/light
  const fb = funcs.find(x => isBool(x) && /(switch|power|spray|light)/i.test(x?.code||''))
  if (fb) return fb
  // 3) Enum with on/off range on known codes
  for (const code of mainSwitchCodes) {
    const f = funcs.find(x => x?.code === code && isEnum(x))
    if (f) return f
  }
  // 4) Any enum with on/off-like values
  const enums = funcs.filter(isEnum)
  for (const f of enums){
    try {
      const vals = safeParse(f.values)
      const range = Array.isArray(vals?.range) ? vals.range.map(s=> String(s).toLowerCase()) : []
      if (range.includes('on') && range.includes('off')) return f
    } catch {}
  }
  return null
}

function makeTuyaValue(deviceId, code, on) {
  const dev = funcSchema.get(deviceId) || {}
  const schema = dev[code]
  const t = String(schema?.type || '').toLowerCase()
  const parsed = schema?.valuesParsed

  if (t === 'boolean' || t === 'bool') return !!on

  if (t === 'enum') {
    const range = Array.isArray(parsed?.range) ? parsed.range.map(String) : []
    if (range.includes('on') && range.includes('off')) return on ? 'on' : 'off'
    if (range.length >= 2) return on ? String(range[0]) : String(range[1])
    return on ? 'on' : 'off'
  }

  if (t === 'integer' || t === 'value') {
    const min = Number(parsed?.min ?? 0)
    const max = Number(parsed?.max ?? 1)
    if (min === 0 && max === 1) return on ? 1 : 0
    return on ? 1 : 0
  }

  // sem schema conhecido
  return !!on
}

async function ensureFunctionsCached(token, deviceId) {
  if (funcSchema.has(deviceId)) return funcSchema.get(deviceId)
  const f = await integrationsApi.tuyaFunctions(token, deviceId)
  const funcs = f?.result?.functions || []
  const map = {}
  for (const fn of funcs) {
    map[fn.code] = {
      type: String(fn.type || '').toLowerCase(),
      valuesParsed: safeParse(fn.values),
    }
  }
  funcSchema.set(deviceId, map)

  const picked = pickOnOffCodeFromFunctions(funcs)
  if (picked?.code) codeCache.set(deviceId, picked.code)

  return map
}

const TuyaAdapter = {
  key: 'tuya',
  label: 'Tuya',

  listDevices: async (token, { setRooms, setStatusMap }) => {
    const j = await integrationsApi.tuyaDevices(token)
    const raw = Array.isArray(j?.items) ? j.items : []
    const items = raw.map(normalizeTuyaDevice)

    // rooms/reset (Tuya não usa rooms neste app)
    setRooms({})
    // limpa status ao trocar lista
    // (mantém statusMap por device conforme re-carregado abaixo)

    // pré-carrega functions e on/off code para quem parece switch
    await batch(items, 6, async (d) => {
      try {
        await ensureFunctionsCached(token, d.id)
        const code = codeCache.get(d.id)
        if (code) {
          const caps = Array.isArray(d.components?.[0]?.capabilities) ? d.components[0].capabilities : []
          if (!caps.some(c => (c.id || c.capability) === 'switch')) {
            d.components = [{ id: 'main', capabilities: [...caps, { id: 'switch' }] }]
          }
        }
      } catch {}
    })

    // carrega status real (via endpoint normalizado do backend)
    const ids = items.filter(d => codeCache.get(d.id)).map(d => d.id)
    await batch(ids, 6, async (id) => {
      try {
        const s = await integrationsApi.tuyaDeviceStatus(token, id) // { ok, code, status }
        if (s?.code && !codeCache.get(id)) codeCache.set(id, s.code)
        if (s?.status) setStatusMap(m => ({ ...m, [id]: s.status }))
      } catch {}
    })

    return items
  },

  canControl: async () => true, // temos /tuya/commands no backend

  sendSwitch: async (token, { id, on }) => {
    // offline é checado na página pela prop "online"
    // 1) tenta code conhecido ou descobre via functions
    let code = codeCache.get(id)
    if (!code) {
      await ensureFunctionsCached(token, id)
      code = codeCache.get(id)
    }
    // 2) se ainda não, tenta fallbacks comuns
    const fallbackCodes = ['switch', 'switch_1', 'switch_led', 'power', 'switch_main', 'power_switch', 'device_switch', 'master_switch', 'switch_spray', 'power_go', 'light', 'switch_charge']
    const codesToTry = code ? [code, ...fallbackCodes.filter(c => c !== code)] : fallbackCodes

    let lastErr = null
    for (const c of codesToTry) {
      try {
        const value = makeTuyaValue(id, c, on)
        await integrationsApi.tuyaSendCommands(token, id, [{ code: c, value }])
        codeCache.set(id, c)
        break
      } catch (e) {
        lastErr = e
        continue
      }
    }
    if (lastErr) {
      // se todas falharem, propaga o último erro
      throw lastErr
    }

    // 3) lê status real após o comando
    const s = await integrationsApi.tuyaDeviceStatus(token, id)
    return s?.status || null
  },

  getDebugBadge: (id) => {
    const code = codeCache.get(id)
    return code ? `code: ${code}` : null
  },
}

export default TuyaAdapter
