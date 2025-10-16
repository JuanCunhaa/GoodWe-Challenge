const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function request(path, { token } = {}){
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`${API_BASE}${path}`, { method: 'GET', headers });
  const data = await r.json().catch(()=>null);
  if (!r.ok) throw new Error(data?.error || `${r.status} ${r.statusText}`);
  return data;
}

export const aiApi = {
  forecast: (token, hours = 24) => request(`/ai/forecast?hours=${encodeURIComponent(hours)}`, { token }),
  recommendations: (token) => request(`/ai/recommendations`, { token }),
  devicesOverview: (token) => request(`/ai/devices/overview`, { token }),
  iotUptime: (token, vendor, id, window = '24h') => request(`/iot/device/${encodeURIComponent(vendor)}/${encodeURIComponent(id)}/uptime?window=${encodeURIComponent(window)}`, { token }),
  topConsumers: (token, window = '60') => request(`/iot/top-consumers?window=${encodeURIComponent(window)}`, { token }),
  automationsSuggest: (token, days = 7) => request(`/ai/automations/suggest?days=${encodeURIComponent(days)}`, { token }),
  costProjection: (token, { hours = 24, tariff } = {}) => {
    const q = new URLSearchParams({ hours: String(hours) });
    const t = tariff ?? (import.meta.env.VITE_TARIFF_BRL_PER_KWH ? Number(import.meta.env.VITE_TARIFF_BRL_PER_KWH) : undefined);
    if (typeof t === 'number' && !Number.isNaN(t)) q.set('tariff', String(t));
    return request(`/ai/cost-projection?${q.toString()}`, { token });
  },
  batteryStrategy: (token, { hours = 24, min_soc = 20, max_soc = 90 } = {}) =>
    request(`/ai/battery/strategy?hours=${encodeURIComponent(hours)}&min_soc=${encodeURIComponent(min_soc)}&max_soc=${encodeURIComponent(max_soc)}`, { token }),
};
