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

export const habitsApi = {
  list: (token) => request('/habits', { token }),
  setState: (token, id, state) => request(`/habits/${encodeURIComponent(id)}/state`, { method:'PUT', token, body: { state } }),
  undo: (token, id) => request(`/habits/${encodeURIComponent(id)}/undo`, { method:'POST', token, body: {} }),
  logs: (token, { limit=50, pattern_id=null }={}) => {
    const q = new URLSearchParams({ limit: String(limit), ...(pattern_id? { pattern_id: String(pattern_id) } : {}) }).toString();
    return request(`/habits/logs?${q}`, { token });
  },
  createManual: (token, payload) => request('/habits/manual', { method:'POST', token, body: payload }),
};
