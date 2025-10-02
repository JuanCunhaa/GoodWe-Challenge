import crypto from 'node:crypto';

export function registerTuyaRoutes(router, { dbApi, helpers }) {
  const { requireUser } = helpers;

  const TUYA_ENABLED = String(process.env.TUYA_ENABLED || 'true').toLowerCase() === 'true'
  const TUYA_ACCESS_ID = (process.env.TUYA_ACCESS_ID || '').trim()
  const TUYA_ACCESS_SECRET = (process.env.TUYA_ACCESS_SECRET || '').trim()
  const TUYA_API_BASE = ((process.env.TUYA_API_BASE || 'https://openapi.tuyaus.com').replace(/\/$/, '')).trim()
  const TUYA_FALLBACK_BASES = [TUYA_API_BASE,'https://openapi.tuyaweu.com','https://openapi.tuyain.com','https://openapi.tuyacn.com'].filter((v,i,a)=>!!v && a.indexOf(v)===i)
  const TUYA_SIGN_VERSION = String(process.env.TUYA_SIGN_VERSION || '2.0')
  const TUYA_LANG = String(process.env.TUYA_LANG || 'pt')
  let tuyaToken = { access_token: '', expire_time: 0 }

  function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex') }
  function hmac256Hex(key, str) { return crypto.createHmac('sha256', key).update(str).digest('hex').toUpperCase() }
  function nowMs() { return Date.now().toString() }

  async function tuyaSignedFetchOnce(apiBase, path, { method='GET', query='', bodyObj=null, accessToken='' } = {}){
    const t = nowMs()
    const urlPath = path + (query ? `?${query}` : '')
    const body = bodyObj ? JSON.stringify(bodyObj) : ''
    const contentHash = sha256Hex(body)
    const stringToSign = [method.toUpperCase(), contentHash, '', urlPath].join('\n')
    const str = TUYA_ACCESS_ID + (accessToken || '') + t + stringToSign
    const sign = hmac256Hex(TUYA_ACCESS_SECRET, str)
    const headers = { 'client_id': TUYA_ACCESS_ID, 'sign': sign, 't': t, 'sign_method': 'HMAC-SHA256', 'sign_version': TUYA_SIGN_VERSION, 'lang': TUYA_LANG }
    if (accessToken) headers['access_token'] = accessToken
    if (body) headers['Content-Type'] = 'application/json'
    const url = `${apiBase}${urlPath}`
    const r = await fetch(url, { method, headers, body: body || undefined, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) })
    const json = await r.json().catch(() => null)
    return { apiBase, status: r.status, json }
  }
  async function tuyaSignAndFetch(path, opts={}){
    let last
    for (const base of TUYA_FALLBACK_BASES) {
      const res = await tuyaSignedFetchOnce(base, path, opts)
      last = res
      if (res.status === 200 && res.json && res.json.success === true) return res
      if (res.status === 401 || res.status === 429) return res
      if (res.status !== 404 && res.status !== 502) return res
    }
    return last
  }
  async function tuyaEnsureAppToken(){
    if (!TUYA_ENABLED) throw new Error('TUYA_DISABLED')
    if (!TUYA_ACCESS_ID || !TUYA_ACCESS_SECRET) throw new Error('missing TUYA_ACCESS_ID/SECRET')
    const now = Date.now()
    if (tuyaToken.access_token && now < tuyaToken.expire_time - 5000) return tuyaToken.access_token
    const t = nowMs()
    const path = '/v1.0/token'
    const query = 'grant_type=1'
    const contentHash = sha256Hex('')
    const stringToSign = ['GET', contentHash, '', `${path}?${query}`].join('\n')
    const sign = hmac256Hex(TUYA_ACCESS_SECRET, TUYA_ACCESS_ID + t + stringToSign)
    const headers = { 'client_id': TUYA_ACCESS_ID, 'sign': sign, 't': t, 'sign_method': 'HMAC-SHA256', 'sign_version': TUYA_SIGN_VERSION }
    let last
    for (const base of TUYA_FALLBACK_BASES) {
      const url = `${base}${path}?${query}`
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) })
      const j = await r.json().catch(() => null)
      last = { base, j, status: r.status }
      if (r.status === 200 && j && j.success === true) {
        tuyaToken = { access_token: j.result.access_token, expire_time: now + (Number(j.result.expire_time) || 3600) * 1000 }
        return tuyaToken.access_token
      }
      if (r.status === 401 || r.status === 429) break
    }
    throw new Error('tuya token failed: ' + JSON.stringify(last || {}))
  }
  async function ensureTuyaLinkedUser(user){
    const row = await dbApi.getLinkedAccount(user.id, 'tuya')
    if (!row) throw Object.assign(new Error('not linked'), { code: 'NOT_LINKED' })
    const meta = row?.meta ? (JSON.parse(row.meta || '{}') || {}) : {}
    const uid = String(meta.uid || '')
    const uids = (meta.uids && typeof meta.uids === 'object') ? meta.uids : null
    if (!uid && (!uids || Object.keys(uids).length === 0)) throw Object.assign(new Error('missing uid'), { code: 'MISSING_UID' })
    return { uid, uids, row }
  }

  router.post('/auth/tuya/link', async (req, res) => {
    if (!TUYA_ENABLED) return res.status(501).json({ ok: false, error: 'Tuya integration disabled' })
    const user = await requireUser(req, res); if (!user) return
    const uid = String(req.body?.uid || '').trim()
    const app = String(req.body?.app || '').trim().toLowerCase() || 'default'
    if (!uid) return res.status(400).json({ ok: false, error: 'uid required' })
    const row = await dbApi.getLinkedAccount(user.id, 'tuya').catch(()=>null)
    let meta = {}
    try { meta = row?.meta ? (JSON.parse(row.meta || '{}') || {}) : {} } catch {}
    if (!meta.uids || typeof meta.uids !== 'object') meta.uids = {}
    meta.uids[app] = uid
    if (!meta.uid) meta.uid = uid
    await dbApi.upsertLinkedAccount({ user_id: user.id, vendor: 'tuya', access_token: row?.access_token ?? null, refresh_token: row?.refresh_token ?? null, expires_at: row?.expires_at ?? null, scopes: row?.scopes ?? null, meta })
    res.json({ ok: true, uids: meta.uids })
  })

  router.get('/auth/tuya/status', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return
    try { const row = await dbApi.getLinkedAccount(user.id, 'tuya'); const meta = row?.meta ? (JSON.parse(row.meta || '{}') || {}) : {}; const uids = (meta.uids && typeof meta.uids==='object') ? meta.uids : (meta.uid ? { default: meta.uid } : {}); res.json({ ok: true, connected: !!(row && Object.keys(uids).length>0), uid: meta.uid || '', uids }) }
    catch { res.json({ ok: true, connected: false }) }
  })

  router.post('/auth/tuya/unlink', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return
    try { await dbApi.deleteLinkedAccount(user.id, 'tuya'); res.status(204).end() } catch { res.status(500).json({ ok: false, error: 'unlink failed' }) }
  })

  router.get('/tuya/devices', async (req, res) => {
    try {
      const user = await requireUser(req, res); if (!user) return
      const { uid, uids } = await ensureTuyaLinkedUser(user)
      const token = await tuyaEnsureAppToken()
      const appPick = String(req.query.app || 'all').toLowerCase()
      const uidMap = {}
      if (uids && typeof uids === 'object') {
        for (const [label, id] of Object.entries(uids)) {
          if (!id) continue
          if (appPick === 'all' || appPick === String(label).toLowerCase()) uidMap[String(id)] = label
        }
      }
      if (Object.keys(uidMap).length === 0 && uid) uidMap[String(uid)] = 'default'
      const aggregate = []
      for (const [uidVal, label] of Object.entries(uidMap)) {
        // 1) Preferred: users/{uid}/devices
        let list = []
        {
          const q = `page_no=1&page_size=100`
          const r = await tuyaSignAndFetch(`/v1.0/iot-03/users/${encodeURIComponent(uidVal)}/devices`, { method:'GET', query: q, accessToken: token })
          if (r.status === 200 && r.json?.success === true) {
            const res = r.json?.result
            list = Array.isArray(res?.list) ? res.list : (Array.isArray(res?.devices) ? res.devices : [])
          }
        }
        // 2) Fallback: /devices?uid=
        if (!list || list.length === 0) {
          const q2 = `page_no=1&page_size=100&uid=${encodeURIComponent(uidVal)}`
          const r2 = await tuyaSignAndFetch(`/v1.0/iot-03/devices`, { method:'GET', query: q2, accessToken: token })
          if (r2.status === 200 && r2.json?.success === true) {
            const res2 = r2.json?.result
            list = Array.isArray(res2?.list) ? res2.list : []
          }
        }
        for (const d of (list || [])) aggregate.push({ ...d, _app: label })
      }
      const seen = new Set(); const items = []
      for (const d of aggregate) { const id = String(d?.id || d?.uuid || ''); if (!id) continue; if (seen.has(id)) continue; seen.add(id); items.push(d) }
      res.json({ ok: true, items, total: items.length })
    } catch (e) {
      const code = String(e?.code || '')
      if (code === 'NOT_LINKED' || code === 'MISSING_UID') return res.status(401).json({ ok: false, error: code.toLowerCase() })
      res.status(500).json({ ok: false, error: String(e?.message || e) })
    }
  })

  router.post('/tuya/commands', async (req, res) => {
    try {
      const user = await requireUser(req, res); if (!user) return
      await ensureTuyaLinkedUser(user)
      const token = await tuyaEnsureAppToken()
      const id = String(req.body?.device_id || '').trim()
      const commands = Array.isArray(req.body?.commands) ? req.body.commands : []
      if (!id || commands.length === 0) return res.status(400).json({ ok: false, error: 'device_id and commands required' })
      const path = `/v1.0/iot-03/devices/${encodeURIComponent(id)}/commands`
      const r = await tuyaSignAndFetch(path, { method: 'POST', bodyObj: { commands }, accessToken: token })
      if (r.status !== 200 || r.json?.success !== true) return res.status(r.status).json(r.json || { ok: false })
      const statusPath = `/v1.0/iot-03/devices/${encodeURIComponent(id)}/status`
      const s = await tuyaSignAndFetch(statusPath, { method: 'GET', accessToken: token })
      let normalized = null
      if (s.status === 200 && s.json?.success === true) {
        const arr = Array.isArray(s.json?.result) ? s.json.result : []
        const known = ['switch', 'switch_1', 'switch_led', 'power']
        let code = known.find(k => arr.some(x => x?.code === k)) || ''
        const entry = code ? arr.find(x => x?.code === code) : null
        const v = entry?.value
        const isOn = (v === true) || (v === 1) || (String(v).toLowerCase() === 'true') || (String(v).toLowerCase() === 'on')
        const value = (entry == null) ? '' : (isOn ? 'on' : 'off')
        normalized = { components: { main: { switch: { switch: { value } } } } }
      }
      res.json({ ok: true, result: r.json?.result, status: normalized })
    } catch (e) {
      const code = String(e?.code || '')
      if (code === 'NOT_LINKED' || code === 'MISSING_UID') return res.status(401).json({ ok: false, error: code.toLowerCase() })
      res.status(500).json({ ok: false, error: String(e?.message || e) })
    }
  })

  router.get('/tuya/device/:id/status', async (req, res) => {
    try {
      const user = await requireUser(req, res); if (!user) return;
      await ensureTuyaLinkedUser(user);
      const token = await tuyaEnsureAppToken();
      const id = String(req.params.id || '');
      const path = `/v1.0/iot-03/devices/${encodeURIComponent(id)}/status`
      const { status, json } = await tuyaSignAndFetch(path, { method: 'GET', accessToken: token });
      if (status !== 200 || json?.success !== true) return res.status(status).json(json || { ok:false })
      const list = Array.isArray(json.result) ? json.result : []
      const map = Object.fromEntries(list.map(it => [it.code, it.value]));
      const fnPath = `/v1.0/iot-03/devices/${encodeURIComponent(id)}/functions`
      const f = await tuyaSignAndFetch(fnPath, { method: 'GET', accessToken: token })
      let code = ''
      if (f.status === 200 && f.json?.success === true) {
        const funcs = Array.isArray(f.json?.result?.functions) ? f.json.result.functions : []
        code = (['switch_led','switch','switch_1','power'].find(k => funcs.some(x => x?.code === k))) || ''
      }
      const on = code ? !!map[code] : null;
      res.json({ ok: true, on, status: map, code });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });

  router.post('/tuya/device/:id/:action', async (req, res) => {
    try {
      const user = await requireUser(req, res); if (!user) return;
      await ensureTuyaLinkedUser(user);
      const token = await tuyaEnsureAppToken();
      const id = String(req.params.id || '');
      const action = String(req.params.action || 'off').toLowerCase();
      const fnPath = `/v1.0/iot-03/devices/${encodeURIComponent(id)}/functions`
      const f = await tuyaSignAndFetch(fnPath, { method: 'GET', accessToken: token })
      let code = ''
      if (f.status === 200 && f.json?.success === true) {
        const funcs = Array.isArray(f.json?.result?.functions) ? f.json.result.functions : []
        code = (['switch_led','switch','switch_1','power'].find(k => funcs.some(x => x?.code === k))) || ''
      }
      if (!code) return res.status(400).json({ ok: false, error: 'no switch code found for this device' });
      const payload = { commands: [{ code, value: action === 'on' }] };
      const path = `/v1.0/iot-03/devices/${encodeURIComponent(id)}/commands`;
      const { status, json } = await tuyaSignAndFetch(path, { method: 'POST', bodyObj: payload, accessToken: token });
      if (status !== 200 || json?.success !== true) return res.status(status).json(json || { ok: false });
      res.json({ ok: true, result: json.result, code });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });
}


