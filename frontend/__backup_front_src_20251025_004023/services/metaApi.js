const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function request(path, { method='GET', token, body } = {}){
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`${API_BASE}${path}`, { method, headers, body: body? JSON.stringify(body): undefined });
  const data = await r.json().catch(()=>null);
  if (!r.ok) throw new Error(data?.error || `${r.status} ${r.statusText}`);
  return data;
}

export const metaApi = {
  listRooms: (token) => request('/rooms', { token }),
  createRoom: (token, name) => request('/rooms', { method:'POST', token, body: { name } }),
  deleteRoom: (token, id) => request(`/rooms/${encodeURIComponent(id)}`, { method:'DELETE', token }),
  getDeviceMeta: (token) => request('/device-meta', { token }),
  upsertDeviceMeta: (token, payload) => request('/device-meta', { method:'PUT', token, body: payload }),
};

