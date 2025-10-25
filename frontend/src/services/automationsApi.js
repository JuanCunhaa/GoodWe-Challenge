const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function request(path, { method='GET', body, token } = {}){
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: body? JSON.stringify(body): undefined });
  const ct = res.headers.get('content-type')||'';
  const data = ct.includes('application/json') ? await res.json().catch(()=>null) : null;
  if (!res.ok) throw new Error(data?.error || `${res.status}`);
  return data || {};
}

export const automationsApi = {
  list: (token) => request('/automations', { token }),
  update: (token, id, payload) => request(`/automations/${encodeURIComponent(id)}`, { method:'PUT', token, body: payload }),
  simulate: (token, routine) => request('/routines/adaptive/simulate', { method:'POST', token, body: { routine } }),
  train: (token, { automation_id, window_days=7, k=3, promoteIfReady=false }={}) =>
    request('/routines/adaptive/train', { method:'POST', token, body: { automation_id, window_days, k, promoteIfReady } }),
};

