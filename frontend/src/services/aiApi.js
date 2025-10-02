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
};
