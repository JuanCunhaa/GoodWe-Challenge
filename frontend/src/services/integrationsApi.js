const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function request(path, { method='GET', body, token } = {}){
  const headers = { 'Content-Type':'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type')||'';
  const data = ct.includes('application/json') ? await res.json().catch(()=>null) : null;
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

export const integrationsApi = {
  stStatus: (token) => request('/auth/smartthings/status', { token }),
  stUnlink: (token) => request('/auth/smartthings/unlink', { method:'POST', token, body:{} }),
  stDevices: (token) => request('/smartthings/devices', { token }),
  stDeviceStatus: (token, id) => request(`/smartthings/device/${encodeURIComponent(id)}/status`, { token }),
  stRooms: (token, locationId) => request(locationId ? `/smartthings/rooms?locationId=${encodeURIComponent(locationId)}` : '/smartthings/rooms', { token }),
  stSendCommands: (token, deviceId, payload) => {
    const body = Array.isArray(payload)
      ? { deviceId, commands: payload }
      : (payload && payload.capability ? { deviceId, ...payload } : { deviceId, commands: [] });
    return request('/smartthings/commands', { method:'POST', token, body });
  }
};
