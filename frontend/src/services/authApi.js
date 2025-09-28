const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function request(path, { method='GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'omit',
  });
  const data = await res.json().catch(()=>({ ok:false, error:'invalid json' }));
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

export const authApi = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  register: (email, password, powerstation_id) => request('/auth/register', { method:'POST', body: { email, password, powerstation_id } }),
  me: (token) => request('/auth/me', { token }),
  changePassword: (token, old_password, new_password) => request('/auth/change-password', { method: 'POST', token, body: { old_password, new_password } }),
  listPowerstations: () => request('/powerstations'),
}

export function saveSession(token, user){
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

export function loadSession(){
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  return { token, user };
}

