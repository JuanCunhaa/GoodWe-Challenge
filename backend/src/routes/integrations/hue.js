import crypto from 'node:crypto';

export function registerHueRoutes(router, { dbApi, helpers }) {
  const { tryGetUser, requireUser } = helpers;
  const HUE_ENABLED = String(process.env.HUE_ENABLED || 'true').toLowerCase() === 'true';

  function getEncKey() {
    const hex = String(process.env.INTEGRATIONS_ENC_KEY || '').trim();
    if (!hex || hex.length !== 64) return null;
    try { return Buffer.from(hex, 'hex'); } catch { return null; }
  }
  function enc(plain) {
    const key = getEncKey(); if (!key) throw new Error('missing INTEGRATIONS_ENC_KEY (32-byte hex)');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + ct.toString('hex') + ':' + tag.toString('hex');
  }
  function dec(packed) {
    const key = getEncKey(); if (!key) throw new Error('missing INTEGRATIONS_ENC_KEY');
    const [ivh, cth, tagh] = String(packed || '').split(':');
    if (!ivh || !cth || !tagh) return '';
    const iv = Buffer.from(ivh, 'hex');
    const ct = Buffer.from(cth, 'hex');
    const tag = Buffer.from(tagh, 'hex');
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  }
  function deriveBaseUrl(req) {
    const explicit = (process.env.BASE_URL || '').trim();
    if (explicit) return explicit.replace(/\/$/, '');
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${proto}://${host}`;
  }
  async function hueTokenRequest(params) {
    const clientId = process.env.HUE_CLIENT_ID || '';
    const clientSecret = process.env.HUE_CLIENT_SECRET || '';
    const tokenUrl = process.env.HUE_TOKEN_URL || 'https://api.meethue.com/v2/oauth2/token';
    const body = new URLSearchParams(params).toString();
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const r = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${basic}` }, body, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
    if (!r.ok) { const t = await r.text(); throw new Error(`Hue token HTTP ${r.status}: ${t.slice(0, 200)}`); }
    return r.json();
  }
  async function ensureHueAccess(user) {
    const row = await dbApi.getLinkedAccount(user.id, 'hue');
    if (!row) throw Object.assign(new Error('not linked'), { code: 'NOT_LINKED' });
    let access = dec(row.access_token || '');
    const refresh = dec(row.refresh_token || '');
    const now = Date.now();
    if (!access || now >= Number(row.expires_at || 0) - 5000) {
      const tok = await hueTokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
      access = String(tok.access_token || '');
      const newRefresh = String(tok.refresh_token || refresh || '');
      const expiresIn = Number(tok.expires_in || 0);
      const expires_at = Date.now() + Math.max(0, expiresIn - 30) * 1000;
      const scopes = String(tok.scope || row.scopes || '');
      await dbApi.upsertLinkedAccount({ user_id: user.id, vendor: 'hue', access_token: enc(access), refresh_token: enc(newRefresh), expires_at, scopes, meta: { refreshed_at: Date.now() } });
    }
    return access;
  }
  async function getHueContext(user) {
    const row = await dbApi.getLinkedAccount(user.id, 'hue');
    if (!row) throw Object.assign(new Error('not linked'), { code: 'NOT_LINKED' });
    const token = await ensureHueAccess(user);
    const envKey = (process.env.HUE_APP_KEY || '').trim();
    let appKey = envKey || '';
    try { const meta = row?.meta ? JSON.parse(row.meta) : {}; if (!appKey && meta && meta.app_key) appKey = String(meta.app_key); } catch { }
    return { token, appKey };
  }

  router.get('/auth/hue', async (req, res) => {
    if (!HUE_ENABLED) return res.status(501).json({ ok: false, error: 'Hue integration disabled' });
    let user = await tryGetUser(req);
    if (!user) {
      const t = String(req.query.token || '');
      try { if (t) { const sess = await dbApi.getSession(t); if (sess) user = await dbApi.getUserById(sess.user_id); } } catch { }
    }
    if (!user) { res.status(401).send('missing token'); return; }
    try {
      const state = crypto.randomBytes(16).toString('hex');
      await dbApi.createOauthState({ state, vendor: 'hue', user_id: user.id });
      const base = deriveBaseUrl(req);
      const authUrl = (process.env.HUE_AUTH_URL || 'https://api.meethue.com/v2/oauth2/authorize');
      const redirectUri = base + '/api/integrations/hue/callback';
      const url = `${authUrl}?client_id=${encodeURIComponent(process.env.HUE_CLIENT_ID || '')}` + `&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}` + `&state=${encodeURIComponent(state)}`;
      res.redirect(url);
    } catch { res.status(500).send('Erro ao iniciar OAuth (Hue)'); }
  });

  router.get('/integrations/hue/callback', async (req, res) => {
    if (!HUE_ENABLED) return res.status(501).send('Hue integration disabled');
    try {
      const code = String(req.query.code || '');
      const state = String(req.query.state || '');
      if (!code || !state) return res.status(400).send('missing code/state');
      const st = await dbApi.consumeOauthState(state);
      if (!st || st.vendor !== 'hue') return res.status(400).send('invalid state');
      const base = deriveBaseUrl(req);
      const redirectUri = base + '/api/integrations/hue/callback';
      const tok = await hueTokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
      const access = String(tok.access_token || '');
      const refresh = String(tok.refresh_token || '');
      const expiresIn = Number(tok.expires_in || 0);
      const expires_at = Date.now() + Math.max(0, expiresIn - 30) * 1000;
      const scopes = String(tok.scope || '');
      if (!access || !refresh) throw new Error('missing tokens');
      await dbApi.upsertLinkedAccount({ user_id: st.user_id, vendor: 'hue', access_token: enc(access), refresh_token: enc(refresh), expires_at, scopes, meta: { obtained_at: Date.now() } });
      const frontOrigin = (process.env.FRONT_ORIGIN || process.env.CORS_ORIGIN || '').replace(/\/$/, '');
      const toPath = String(process.env.FRONT_REDIRECT_SUCCESS || '/perfil');
      const toUrl = frontOrigin ? (frontOrigin + (toPath.startsWith('/') ? toPath : ('/' + toPath))) : toPath;
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!doctype html><meta charset="utf-8"/><title>Hue</title>
        <body style="font-family:system-ui,Segoe UI,Roboto,Arial;padding:24px;background:#0b1220;color:#e2e8f0">
          Conectado com sucesso.
          <script>(function(){ try { if (window.opener) window.opener.postMessage('hue:linked','*'); }catch(e){}; setTimeout(function(){ location.href = ${JSON.stringify(toUrl)}; }, 300); })();</script>
        </body>`);
    } catch (e) { res.status(500).send('Falha ao conectar Hue'); }
  });

  router.get('/auth/hue/status', async (req, res) => {
    if (!HUE_ENABLED) return res.json({ ok: true, connected: false, disabled: true });
    const user = await requireUser(req, res); if (!user) return;
    try {
      const row = await dbApi.getLinkedAccount(user.id, 'hue');
      const meta = row?.meta ? (JSON.parse(row.meta || '{}') || {}) : {};
      const envKey = (process.env.HUE_APP_KEY || '').trim();
      const hasAppKey = !!(envKey || meta?.app_key);
      res.json({ ok: true, connected: !!row, expires_at: row?.expires_at || null, scopes: row?.scopes || '', has_app_key: hasAppKey });
    } catch { res.json({ ok: true, connected: false }); }
  });

  router.post('/auth/hue/unlink', async (req, res) => {
    if (!HUE_ENABLED) return res.status(501).json({ ok: false, error: 'Hue integration disabled' });
    const user = await requireUser(req, res); if (!user) return;
    try { await dbApi.deleteLinkedAccount(user.id, 'hue'); res.status(204).end(); }
    catch (e) { res.status(500).json({ ok: false, error: 'unlink failed' }); }
  });

  router.get('/hue/devices', async (req, res) => {
    if (!HUE_ENABLED) return res.status(501).json({ ok: false, error: 'Hue integration disabled' });
    const user = await requireUser(req, res); if (!user) return;
    try {
      const { token, appKey } = await getHueContext(user);
      if (!appKey) return res.status(400).json({ ok: false, error: 'missing app key (HUE_APP_KEY or stored meta.app_key). Gere via /api/auth/hue/appkey' });
      const apiBase = (process.env.HUE_API_BASE || 'https://api.meethue.com/route/clip/v2').replace(/\/$/, '');
      const hdrs = { 'Authorization': `Bearer ${token}`, 'hue-application-key': appKey };
      const rDev = await fetch(`${apiBase}/resource/device`, { headers: hdrs, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
      const jDev = await rDev.json(); if (!rDev.ok) return res.status(rDev.status).json(jDev);
      const devices = Array.isArray(jDev?.data) ? jDev.data : [];
      const fetchRes = async (path) => { try { const r = await fetch(`${apiBase}${path}`, { headers: hdrs, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) }); const j = await r.json(); return Array.isArray(j?.data) ? j.data : []; } catch { return []; } };
      const lights = await fetchRes('/resource/light');
      const plugs = await fetchRes('/resource/smart_plug');
      const byRid = new Map();
      for (const it of lights) if (it?.id) byRid.set(it.id, { kind: 'light', on: !!it?.on?.on });
      for (const it of plugs) if (it?.id) byRid.set(it.id, { kind: 'smart_plug', on: !!it?.on?.on });
      const norm = devices.map((d) => {
        const id = d?.id || '';
        const name = d?.metadata?.name || d?.product_data?.product_name || 'Device';
        const type = d?.product_data?.product_name || d?.metadata?.archetype || d?.type || '';
        let on = null, rid = null, kind = null;
        const svcs = Array.isArray(d?.services) ? d.services : [];
        for (const s of svcs) { const st = byRid.get(s?.rid); if (st) { on = st.on; rid = s.rid; kind = st.kind; break; } }
        return { id, name, vendor: 'philips-hue', type, on, controlRid: rid, controlKind: kind };
      });
      res.json({ ok: true, items: norm, total: norm.length, ts: Date.now() });
    } catch (e) { if (String(e?.code) === 'NOT_LINKED') return res.status(401).json({ ok: false, error: 'not linked' }); res.status(500).json({ ok: false, error: 'failed to fetch hue devices' }); }
  });

  router.post('/hue/device/:rid/:action', async (req, res) => {
    if (!HUE_ENABLED) return res.status(501).json({ ok: false, error: 'Hue integration disabled' });
    const user = await requireUser(req, res); if (!user) return;
    try {
      const { token, appKey } = await getHueContext(user);
      if (!appKey) return res.status(400).json({ ok: false, error: 'missing app key' });
      const rid = String(req.params.rid || '');
      const action = String(req.params.action || '').toLowerCase();
      const kind = String(req.query.kind || 'light');
      if (!rid || (action !== 'on' && action !== 'off')) return res.status(400).json({ ok: false, error: 'rid and action(on|off) required' });
      const apiBase = (process.env.HUE_API_BASE || 'https://api.meethue.com/route/clip/v2').replace(/\/$/, '');
      const hdrs = { 'Authorization': `Bearer ${token}`, 'hue-application-key': appKey, 'Content-Type': 'application/json' };
      const body = { on: { on: action === 'on' } };
      const r = await fetch(`${apiBase}/resource/${encodeURIComponent(kind)}/${encodeURIComponent(rid)}`, { method: 'PUT', headers: hdrs, body: JSON.stringify(body), signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
      const j = await r.json().catch(() => null);
      if (!r.ok) return res.status(r.status).json({ ok: false, error: 'hue toggle failed', details: j });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });

  router.post('/auth/hue/appkey', async (req, res) => {
    if (!HUE_ENABLED) return res.status(501).json({ ok: false, error: 'Hue integration disabled' });
    try {
      const user = await requireUser(req, res); if (!user) return;
      const { token } = await getHueContext(user);
      const bridgeId = String(req.body?.bridge_id || '');
      const devicetype = String(req.body?.devicetype || 'goodwe-app#server');
      const base = (process.env.HUE_API_BASE || 'https://api.meethue.com/route/clip/v2').replace(/\/$/, '');
      const hdrs = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
      const r = await fetch(`${base}/resource/bridge/0`, { method: 'POST', headers: hdrs, body: JSON.stringify({ devicetype }), signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
      const j = await r.json().catch(() => null);
      if (!r.ok) return res.status(r.status).json({ ok: false, error: 'hue appkey http error', details: j });
      const arr = Array.isArray(j) ? j : [];
      const succ = arr.find(it => it?.success?.username);
      if (!succ) return res.status(400).json({ ok: false, error: 'no app key returned (press the bridge link button and retry)', details: j });
      const appKey = String(succ.success.username);
      const row = await dbApi.getLinkedAccount(user.id, 'hue');
      const meta = row?.meta ? (JSON.parse(row.meta || '{}') || {}) : {};
      meta.app_key = appKey;
      await dbApi.upsertLinkedAccount({ user_id: user.id, vendor: 'hue', access_token: row.access_token, refresh_token: row.refresh_token, expires_at: row.expires_at, scopes: row.scopes, meta });
      res.json({ ok: true, app_key: appKey });
    } catch (e) { if (String(e?.code) === 'NOT_LINKED') return res.status(401).json({ ok: false, error: 'not linked' }); res.status(500).json({ ok: false, error: String(e) }); }
  });
}

