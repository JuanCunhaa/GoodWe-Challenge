import crypto from 'node:crypto';

export function registerTuyaRoutes(router, { dbApi, helpers }) {
  const { requireUser } = helpers;

  const TUYA_ENABLED = String(process.env.TUYA_ENABLED || 'true').toLowerCase() === 'true'
  const TUYA_ACCESS_ID = (process.env.TUYA_ACCESS_ID || '').trim()
  const TUYA_ACCESS_SECRET = (process.env.TUYA_ACCESS_SECRET || '').trim()
  const TUYA_API_BASE = ((process.env.TUYA_API_BASE || 'https://openapi.tuyaus.com').replace(/\/$/, '')).trim()
  const TUYA_FALLBACK_BASES = [TUYA_API_BASE,'https://openapi.tuyaweu.com','https://openapi.tuyain.com','https://openapi.tuyacn.com'].filter((v,i,a)=>!!v && a.indexOf(v)===i)
  const TUYA_SIGN_VERSION = String(process.env.TUYA_SIGN_VERSION || '2.0')
  const TUYA_LANG = String(process.env.TUYA_LANG || 'pt')
  let tuyaToken = { access_token: '', expire_time: 0 }

  // Heuristic code lists for on/off
  const SWITCH_CANDIDATES = [
    'switch','switch_spray','switch_1','switch_2','switch_3','switch_main',
    'power','power_switch','device_switch','master_switch','power_go','light','switch_led','switch_charge'
  ]
  const AVOID_CODES = new Set(['child_lock','countdown','countdown_1','countdown_2','quick_feed','manual_feed','export_calibrate','weight_calibrate','factory_reset','reset_map','reset_edge_brush','reset_roll_brush','reset_filter','reset_duster_cloth','seek','request','path_data','command_trans','voice_data','timer','notification','volume_set','snooze','snooze_time','meal_plan','moodlighting','colour_data_hsv'])

  function parseValues(v){ try { return typeof v === 'string' ? JSON.parse(v) : (v||{}); } catch { return {} } }
  function findOnOffFunction(funcs){
    // 1) Prefer known boolean switch-like codes
    for (const c of SWITCH_CANDIDATES){
      const f = funcs.find(x => x?.code === c && String(x?.type||'').toLowerCase() === 'boolean')
      if (f) return { code: c, kind: 'boolean', on: true, off: false }
    }
    // 2) Any boolean that looks like power/switch/spray/light
    const fb = funcs.find(x => String(x?.type||'').toLowerCase() === 'boolean' && /(switch|power|spray|light)/i.test(x?.code||''))
    if (fb && !AVOID_CODES.has(fb.code)) return { code: fb.code, kind: 'boolean', on: true, off: false }
    // 3) Enum with range that contains on/off-like values
    const enums = funcs.filter(x => String(x?.type||'').toLowerCase() === 'enum')
    for (const f of enums){
      if (AVOID_CODES.has(f.code)) continue
      const vals = parseValues(f.values)
      const range = Array.isArray(vals?.range) ? vals.range.map(s=> String(s).toLowerCase()) : []
      const onVal = range.find(v => ['on','open','start','enable'].includes(v))
      const offVal = range.find(v => ['off','close','stop','disable'].includes(v))
      if (onVal && offVal) return { code: f.code, kind: 'enum', on: onVal, off: offVal }
    }
    return null
  }

  function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex') }
  function hmac256Hex(key, str) { return crypto.createHmac('sha256', key).update(str).digest('hex').toUpperCase() }
  function nowMs() { return Date.now().toString() }

  async function tuyaSignedFetchOnce(apiBase, path, { method='GET', query='', bodyObj=null, accessToken='' } = {}){
    const t = nowMs()
    const urlPath = path + (query ? `?${query}` : '')
    const body = bodyObj ? JSON.stringify(bodyObj) : ''
    const contentHash = sha256Hex(body)
    const stringToSign = [method.toUpperCase(), contentHash, '', urlPath].join('\n')
    const str = TUYA_ACCESS_ID + (accessToken || '') + t + stringToSign
    const sign = hmac256Hex(TUYA_ACCESS_SECRET, str)
    const headers = { 'client_id': TUYA_ACCESS_ID, 'sign': sign, 't': t, 'sign_method': 'HMAC-SHA256', 'sign_version': TUYA_SIGN_VERSION, 'lang': TUYA_LANG }
    // Tuya OpenAPI 2.1 exige headers adicionais em alguns projetos
    if (String(TUYA_SIGN_VERSION) === '2.1') {
      headers['sign_headers'] = 'client_id'
      headers['mode'] = 'sha256'
    }
    if (accessToken) headers['access_token'] = accessToken
    if (body) headers['Content-Type'] = 'application/json'
    const url = `${apiBase}${urlPath}`
    const r = await fetch(url, { method, headers, body: body || undefined, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) })
    const json = await r.json().catch(() => null)
    return { apiBase, status: r.status, json }
  }
  async function tuyaSignAndFetch(path, opts={}){
    let last
    for (const base of TUYA_FALLBACK_BASES) {
      const res = await tuyaSignedFetchOnce(base, path, opts)
      last = res
      if (res.status === 200 && res.json && res.json.success === true) return res
      // Não pare cedo em erros; tente as demais regiões
      continue
    }
    return last
  }
  async function tuyaEnsureAppToken(){
    if (!TUYA_ENABLED) throw new Error('TUYA_DISABLED')
    if (!TUYA_ACCESS_ID || !TUYA_ACCESS_SECRET) throw new Error('missing TUYA_ACCESS_ID/SECRET')
    const now = Date.now()
    if (tuyaToken.access_token && now < tuyaToken.expire_time - 5000) return tuyaToken.access_token
    const t = nowMs()
    const path = '/v1.0/token'
    const query = 'grant_type=1'
    const contentHash = sha256Hex('')
    const stringToSign = ['GET', contentHash, '', `${path}?${query}`].join('\n')
    const sign = hmac256Hex(TUYA_ACCESS_SECRET, TUYA_ACCESS_ID + t + stringToSign)
    const headers = { 'client_id': TUYA_ACCESS_ID, 'sign': sign, 't': t, 'sign_method': 'HMAC-SHA256', 'sign_version': TUYA_SIGN_VERSION }
    if (String(TUYA_SIGN_VERSION) === '2.1') { headers['sign_headers'] = 'client_id'; headers['mode'] = 'sha256' }
    let last
    for (const base of TUYA_FALLBACK_BASES) {
      const url = `${base}${path}?${query}`
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) })
      const j = await r.json().catch(() => null)
      last = { base, j, status: r.status }
      if (r.status === 200 && j && j.success === true) {
        tuyaToken = { access_token: j.result.access_token, expire_time: now + (Number(j.result.expire_time) || 3600) * 1000 }
        return tuyaToken.access_token
      }
      if (r.status === 401 || r.status === 429) break
    }
    throw new Error('tuya token failed: ' + JSON.stringify(last || {}))
  }
  async function ensureTuyaLinkedUser(user){
    const row = await dbApi.getLinkedAccount(user.id, 'tuya')
    if (!row) throw Object.assign(new Error('not linked'), { code: 'NOT_LINKED' })
    const meta = row?.meta ? (JSON.parse(row.meta || '{}') || {}) : {}
    const uid = String(meta.uid || '')
    const uids = (meta.uids && typeof meta.uids === 'object') ? meta.uids : null
    if (!uid && (!uids || Object.keys(uids).length === 0)) throw Object.assign(new Error('missing uid'), { code: 'MISSING_UID' })
    return { uid, uids, row }
  }

  router.post('/auth/tuya/link', async (req, res) => {
    if (!TUYA_ENABLED) return res.status(501).json({ ok: false, error: 'Tuya integration disabled' })
    const user = await requireUser(req, res); if (!user) return
    const uid = String(req.body?.uid || '').trim()
    const app = String(req.body?.app || '').trim().toLowerCase() || 'default'
    if (!uid) return res.status(400).json({ ok: false, error: 'uid required' })
    const row = await dbApi.getLinkedAccount(user.id, 'tuya').catch(()=>null)
    let meta = {}
    try { meta = row?.meta ? (JSON.parse(row.meta || '{}') || {}) : {} } catch {}
    if (!meta.uids || typeof meta.uids !== 'object') meta.uids = {}
    meta.uids[app] = uid
    if (!meta.uid) meta.uid = uid
    await dbApi.upsertLinkedAccount({ user_id: user.id, vendor: 'tuya', access_token: row?.access_token ?? null, refresh_token: row?.refresh_token ?? null, expires_at: row?.expires_at ?? null, scopes: row?.scopes ?? null, meta })
    res.json({ ok: true, uids: meta.uids })
  })

  router.get('/auth/tuya/status', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return
    try { const row = await dbApi.getLinkedAccount(user.id, 'tuya'); const meta = row?.meta ? (JSON.parse(row.meta || '{}') || {}) : {}; const uids = (meta.uids && typeof meta.uids==='object') ? meta.uids : (meta.uid ? { default: meta.uid } : {}); res.json({ ok: true, connected: !!(row && Object.keys(uids).length>0), uid: meta.uid || '', uids }) }
    catch { res.json({ ok: true, connected: false }) }
  })

  router.post('/auth/tuya/unlink', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return
    try { await dbApi.deleteLinkedAccount(user.id, 'tuya'); res.status(204).end() } catch { res.status(500).json({ ok: false, error: 'unlink failed' }) }
  })

  router.get('/tuya/devices', async (req, res) => {
    try {
      const user = await requireUser(req, res); if (!user) return
      const { uid } = await ensureTuyaLinkedUser(user)
      const token = await tuyaEnsureAppToken()
      
      // 1) Antigo caminho que funcionava: /v1.0/users/{uid}/devices
      let items = []
      try {
        const r1 = await tuyaSignAndFetch(`/v1.0/users/${encodeURIComponent(uid)}/devices`, { method: 'GET', accessToken: token })
        if (r1.status === 200 && r1.json?.success === true) {
          const arr = Array.isArray(r1.json?.result) ? r1.json.result : []
          if (arr.length) items = arr
        }
      } catch {}

      // 2) Fallbacks mais novos (iot-03): users/{uid}/devices e devices?uid
      if (items.length === 0) {
        try {
          const r2 = await tuyaSignAndFetch(`/v1.0/iot-03/users/${encodeURIComponent(uid)}/devices`, { method: 'GET', query: 'page_no=1&page_size=100', accessToken: token })
          if (r2.status === 200 && r2.json?.success === true) {
            const res = r2.json?.result
            const arr = Array.isArray(res?.list) ? res.list : (Array.isArray(res?.devices) ? res.devices : [])
            if (arr && arr.length) items = arr
          }
        } catch {}
      }
      if (items.length === 0) {
        try {
          const r3 = await tuyaSignAndFetch(`/v1.0/iot-03/devices`, { method: 'GET', query: `page_no=1&page_size=100&uid=${encodeURIComponent(uid)}`, accessToken: token })
          if (r3.status === 200 && r3.json?.success === true) {
            const arr = Array.isArray(r3.json?.result?.list) ? r3.json.result.list : []
            if (arr && arr.length) items = arr
          }
        } catch {}
      }

      // 3) Enriquecer com roomId/roomName
      // 3.1) Buscar homes do usuário
      const roomNameById = new Map()
      try {
        let homes = []
        // iot-03 first
        try {
          const rh = await tuyaSignAndFetch(`/v1.0/iot-03/users/${encodeURIComponent(uid)}/homes`, { method:'GET', accessToken: token })
          if (rh.status === 200 && rh.json?.success === true) {
            const hr = rh.json?.result
            homes = Array.isArray(hr) ? hr : (Array.isArray(hr?.homes) ? hr.homes : [])
          }
        } catch {}
        if (!homes.length) {
          try {
            const rh2 = await tuyaSignAndFetch(`/v1.0/users/${encodeURIComponent(uid)}/homes`, { method:'GET', accessToken: token })
            if (rh2.status === 200 && rh2.json?.success === true) {
              const hr2 = rh2.json?.result
              homes = Array.isArray(hr2) ? hr2 : (Array.isArray(hr2?.homes) ? hr2.homes : [])
            }
          } catch {}
        }
        // 3.2) Para cada home, buscar rooms
        for (const h of homes) {
          const homeId = h?.home_id || h?.id
          if (!homeId) continue
          // iot-03
          let rooms = []
          try {
            const rr = await tuyaSignAndFetch(`/v1.0/iot-03/homes/${encodeURIComponent(homeId)}/rooms`, { method:'GET', accessToken: token })
            if (rr.status === 200 && rr.json?.success === true) {
              const rres = rr.json?.result
              rooms = Array.isArray(rres) ? rres : (Array.isArray(rres?.rooms) ? rres.rooms : [])
            }
          } catch {}
          if (!rooms.length) {
            try {
              const rr2 = await tuyaSignAndFetch(`/v1.0/homes/${encodeURIComponent(homeId)}/rooms`, { method:'GET', accessToken: token })
              if (rr2.status === 200 && rr2.json?.success === true) {
                const rres2 = rr2.json?.result
                rooms = Array.isArray(rres2) ? rres2 : (Array.isArray(rres2?.rooms) ? rres2.rooms : [])
              }
            } catch {}
          }
          for (const r of rooms) {
            const rid = r?.room_id || r?.id
            const rname = r?.name || r?.room_name || ''
            if (rid && rname) roomNameById.set(String(rid), String(rname))
          }
        }
      } catch {}

      // 3.3) Para cada device, obter detalhes e anexar room info
      const enriched = []
      for (const d of items) {
        const id = String(d?.id || d?.uuid || '')
        if (!id) { enriched.push(d); continue }
        let roomId = ''
        try {
          let det = null
          // iot-03 detail
          try {
            const rd = await tuyaSignAndFetch(`/v1.0/iot-03/devices/${encodeURIComponent(id)}`, { method:'GET', accessToken: token })
            if (rd.status === 200 && rd.json?.success === true) det = rd.json?.result
          } catch {}
          if (!det) {
            const rd2 = await tuyaSignAndFetch(`/v1.0/devices/${encodeURIComponent(id)}`, { method:'GET', accessToken: token })
            if (rd2.status === 200 && rd2.json?.success === true) det = rd2.json?.result
          }
          if (det && (det.room_id || det.roomId)) roomId = String(det.room_id || det.roomId)
        } catch {}
        const roomName = roomId ? (roomNameById.get(roomId) || '') : ''
        enriched.push({ ...d, roomId, roomName })
      }

      res.json({ ok: true, items: enriched, total: enriched.length })
    } catch (e) {
      const code = String(e?.code || '')
      if (code === 'NOT_LINKED' || code === 'MISSING_UID') return res.status(401).json({ ok: false, error: code.toLowerCase() })
      res.status(500).json({ ok: false, error: String(e?.message || e) })
    }
  })

  router.post('/tuya/commands', async (req, res) => {
    try {
      const user = await requireUser(req, res); if (!user) return
      await ensureTuyaLinkedUser(user)
      const token = await tuyaEnsureAppToken()
      const id = String(req.body?.device_id || '').trim()
      const commands = Array.isArray(req.body?.commands) ? req.body.commands : []
      if (!id || commands.length === 0) return res.status(400).json({ ok: false, error: 'device_id and commands required' })
      const path = `/v1.0/iot-03/devices/${encodeURIComponent(id)}/commands`
      const r = await tuyaSignAndFetch(path, { method: 'POST', bodyObj: { commands }, accessToken: token })
      if (r.status !== 200 || r.json?.success !== true) return res.status(r.status).json(r.json || { ok: false })
      const statusPath = `/v1.0/iot-03/devices/${encodeURIComponent(id)}/status`
      const s = await tuyaSignAndFetch(statusPath, { method: 'GET', accessToken: token })
      let normalized = null
      if (s.status === 200 && s.json?.success === true) {
        const arr = Array.isArray(s.json?.result) ? s.json.result : []
        let code = SWITCH_CANDIDATES.find(k => arr.some(x => x?.code === k)) || ''
        const entry = code ? arr.find(x => x?.code === code) : null
        if (entry) {
          const v = entry.value
          const isOn = (v === true) || (v === 1) || (String(v).toLowerCase() === 'true') || (String(v).toLowerCase() === 'on')
          const value = isOn ? 'on' : 'off'
          normalized = { components: { main: { switch: { switch: { value } } } } }
        }
      }
      res.json({ ok: true, result: r.json?.result, status: normalized })
    } catch (e) {
      const code = String(e?.code || '')
      if (code === 'NOT_LINKED' || code === 'MISSING_UID') return res.status(401).json({ ok: false, error: code.toLowerCase() })
      res.status(500).json({ ok: false, error: String(e?.message || e) })
    }
  })

  router.get('/tuya/device/:id/status', async (req, res) => {
    try {
      const user = await requireUser(req, res); if (!user) return;
      await ensureTuyaLinkedUser(user);
      const token = await tuyaEnsureAppToken();
      const id = String(req.params.id || '');
      const path = `/v1.0/iot-03/devices/${encodeURIComponent(id)}/status`
      const { status, json } = await tuyaSignAndFetch(path, { method: 'GET', accessToken: token });
      if (status !== 200 || json?.success !== true) return res.status(status).json(json || { ok:false })
      const list = Array.isArray(json.result) ? json.result : []
      const map = Object.fromEntries(list.map(it => [it.code, it.value]));
      const fnPath = `/v1.0/iot-03/devices/${encodeURIComponent(id)}/functions`
      const f = await tuyaSignAndFetch(fnPath, { method: 'GET', accessToken: token })
      let isOn = null; let code = ''
      if (f.status === 200 && f.json?.success === true) {
        const funcs = Array.isArray(f.json?.result?.functions) ? f.json.result.functions : []
        const pick = findOnOffFunction(funcs)
        if (pick) {
          code = pick.code
          if (Object.prototype.hasOwnProperty.call(map, code)) {
            const v = map[code];
            if (pick.kind === 'boolean') isOn = (v === true) || (v === 1) || (String(v).toLowerCase() === 'true') || (String(v).toLowerCase() === 'on')
            else if (pick.kind === 'enum') isOn = (String(v).toLowerCase() === String(pick.on))
          }
        }
        // Include raw debug into response
        return res.json({ ok: true, on: isOn, status: (isOn==null? map : { components: { main: { switch: { switch: { value: isOn ? 'on' : 'off' } } } } }), code, raw_status: list, status_map: map, functions: funcs })
      }
      // Normalize to SmartThings-like shape so the UI consegue ler 'components.main.switch.switch.value'
      const normalized = (isOn == null)
        ? null
        : { components: { main: { switch: { switch: { value: isOn ? 'on' : 'off' } } } } };
      res.json({ ok: true, on: isOn, status: normalized || map, code, raw_status: list, status_map: map, functions: [] });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });

  // Tuya: list available functions (DP codes) for a device
  router.get('/tuya/device/:id/functions', async (req, res) => {
    try {
      const user = await requireUser(req, res); if (!user) return;
      await ensureTuyaLinkedUser(user);
      const token = await tuyaEnsureAppToken();
      const id = String(req.params.id || '');
      const path = `/v1.0/iot-03/devices/${encodeURIComponent(id)}/functions`;
      const { status, json } = await tuyaSignAndFetch(path, { method: 'GET', accessToken: token });
      if (status !== 200 || json?.success !== true) return res.status(status).json(json || { ok:false });
      const funcs = Array.isArray(json?.result?.functions) ? json.result.functions : [];
      res.json({ ok: true, functions: funcs });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });

  router.post('/tuya/device/:id/:action', async (req, res) => {
    try {
      const user = await requireUser(req, res); if (!user) return;
      await ensureTuyaLinkedUser(user);
      const token = await tuyaEnsureAppToken();
      const id = String(req.params.id || '');
      const action = String(req.params.action || 'off').toLowerCase();
      const fnPath = `/v1.0/iot-03/devices/${encodeURIComponent(id)}/functions`
      const f = await tuyaSignAndFetch(fnPath, { method: 'GET', accessToken: token })
      if (f.status !== 200 || f.json?.success !== true) return res.status(400).json({ ok:false, error:'cannot read functions' })
      const funcs = Array.isArray(f.json?.result?.functions) ? f.json.result.functions : []
      const pick = findOnOffFunction(funcs)
      if (!pick) return res.status(400).json({ ok:false, error:'no compatible on/off function for this device' })
      const code = pick.code
      const value = (action === 'on') ? pick.on : pick.off
      const payload = { commands: [{ code, value }] };
      const path = `/v1.0/iot-03/devices/${encodeURIComponent(id)}/commands`;
      const { status, json } = await tuyaSignAndFetch(path, { method: 'POST', bodyObj: payload, accessToken: token });
      if (status !== 200 || json?.success !== true) return res.status(status).json(json || { ok: false });
      res.json({ ok: true, result: json.result, code, value });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });
}
