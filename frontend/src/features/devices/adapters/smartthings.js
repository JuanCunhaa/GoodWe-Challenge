// src/features/devices/adapters/smartthings.js
import { integrationsApi } from '../../../services/integrationsApi.js'
import { batch } from '../utils.js'

const SmartThingsAdapter = {
  key: 'smartthings',
  label: 'SmartThings',

  listDevices: async (token, { setRooms, setStatusMap }) => {
    const j = await integrationsApi.stDevices(token)
    const items = Array.isArray(j?.items) ? j.items : []

    // rooms (best effort)
    try {
      const r = await integrationsApi.stRooms(token)
      const map = {}
      for (const it of (r?.items || [])) if (it?.id) map[it.id] = it.name || ''
      setRooms(map)
    } catch {}

    // status em lote (para quem tem switch)
    const hasSwitch = (d) => (d.components?.[0]?.capabilities || [])
      .map(c => c.id || c.capability)
      .includes('switch')

    const ids = items.filter(hasSwitch).map(d => d.id)
    await batch(ids, 6, async (id) => {
      const s = await integrationsApi.stDeviceStatus(token, id)
      if (s?.status) setStatusMap(m => ({ ...m, [id]: s.status }))
    })

    return items
  },

  canControl: async (token) => {
    const s = await integrationsApi.stStatus(token)
    const scopes = String(s?.scopes || '')
    return scopes.includes('devices:commands') || scopes.includes('x:devices:*')
  },

  sendSwitch: async (token, { id, on, component = 'main' }) => {
    await integrationsApi.stSendCommands(token, id, {
      capability: 'switch',
      command: on ? 'on' : 'off',
      component,
      arguments: []
    })
    const j = await integrationsApi.stDeviceStatus(token, id)
    return j?.status || null
  },

  getDebugBadge: () => null,
}

export default SmartThingsAdapter
