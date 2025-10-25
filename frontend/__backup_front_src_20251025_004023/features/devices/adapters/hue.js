// src/features/devices/adapters/hue.js
import { integrationsApi } from '../../../services/integrationsApi.js'

const HueAdapter = {
  key: 'philips-hue',
  label: 'Philips Hue',

  listDevices: async (token) => {
    const j = await integrationsApi.hueDevices(token)
    return Array.isArray(j?.items) ? j.items : []
  },

  canControl: async () => false,

  sendSwitch: async () => null,

  getDebugBadge: () => null,
}

export default HueAdapter
