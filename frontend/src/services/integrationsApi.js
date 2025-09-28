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
  },
  // Philips Hue
  hueStatus: (token) => request('/auth/hue/status', { token }),
  hueUnlink: (token) => request('/auth/hue/unlink', { method:'POST', token, body:{} }),
  hueDevices: (token) => request('/hue/devices', { token }),
  hueEnsureAppKey: (token, devicetype='goodwe-app#server') => request('/auth/hue/appkey', { method:'POST', token, body: { devicetype } }),
  // Tuya
  tuyaStatus: (token) => request('/auth/tuya/status', { token }),
  tuyaLink: (token, uid) => request('/auth/tuya/link', { method:'POST', token, body: { uid } }),
  tuyaUnlink: (token) => request('/auth/tuya/unlink', { method:'POST', token, body:{} }),
  tuyaDevices: (token) => request('/tuya/devices', { token }),
  tuyaSendCommands: (token, device_id, commands) => request('/tuya/commands', { method:'POST', token, body: { device_id, commands } }),
};
