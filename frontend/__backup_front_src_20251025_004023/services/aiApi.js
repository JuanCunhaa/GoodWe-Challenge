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
  recommendations: (token) => {
    const t = import.meta.env.VITE_TARIFF_BRL_PER_KWH ? Number(import.meta.env.VITE_TARIFF_BRL_PER_KWH) : undefined;
    const q = new URLSearchParams();
    if (typeof t === 'number' && !Number.isNaN(t)) q.set('tariff', String(t));
    const path = q.toString() ? `/ai/recommendations?${q.toString()}` : `/ai/recommendations`;
    return request(path, { token });
  },
  devicesOverview: (token) => request(`/ai/devices/overview`, { token }),
  iotUptime: (token, vendor, id, window = '24h') => request(`/iot/device/${encodeURIComponent(vendor)}/${encodeURIComponent(id)}/uptime?window=${encodeURIComponent(window)}`, { token }),
  deviceUsageByHour: (token, vendor, id, window = '24h', tariff) => {
    const q = new URLSearchParams({ window: String(window) });
    if (typeof tariff === 'number' && !Number.isNaN(tariff)) q.set('tariff', String(tariff));
    return request(`/iot/device/${encodeURIComponent(vendor)}/${encodeURIComponent(id)}/usage-by-hour?${q.toString()}`, { token });
  },
  topConsumers: (token, window = '60') => request(`/iot/top-consumers?window=${encodeURIComponent(window)}`, { token }),
};
