import crypto from 'node:crypto';

export function registerSmartThingsRoutes(router, { dbApi, helpers }) {
  const { tryGetUser, requireUser } = helpers;

  // Webhook lifecycle
  router.post('/integrations/st/webhook', async (req, res) => {
    try {
      const lifecycle = String(req.body?.lifecycle || '');
      if (lifecycle === 'CONFIRMATION') {
        const url = String(req.body?.confirmationData?.confirmationUrl || '');
        if (url) { try { await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) }); } catch { } }
        return res.json({ statusCode: 200 });
      }
      if (lifecycle === 'PING') { return res.json({ statusCode: 200 }); }
      return res.json({ statusCode: 200 });
    } catch (e) { return res.json({ statusCode: 200 }); }
  });

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
  async function stTokenRequest(params) {
    const clientId = process.env.ST_CLIENT_ID || '';
    const clientSecret = process.env.ST_CLIENT_SECRET || '';
    const tokenUrl = process.env.ST_TOKEN_URL || 'https://auth-global.api.smartthings.com/oauth/token';
    const body = new URLSearchParams(params).toString();
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const r = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${basic}` }, body, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
    if (!r.ok) { const t = await r.text(); throw new Error(`SmartThings token HTTP ${r.status}: ${t.slice(0, 200)}`); }
    return r.json();
  }

  router.get('/auth/smartthings', async (req, res) => {
    let user = await tryGetUser(req);
    if (!user) {
      const t = String(req.query.token || '');
      try { if (t) { const sess = await dbApi.getSession(t); if (sess) user = await dbApi.getUserById(sess.user_id); } } catch { }
    }
    if (!user) { res.status(401).send('missing token'); return; }
    try {
      const state = crypto.randomBytes(16).toString('hex');
      await dbApi.createOauthState({ state, vendor: 'smartthings', user_id: user.id });
      const base = deriveBaseUrl(req);
      const authUrl = (process.env.ST_AUTH_URL || 'https://auth-global.api.smartthings.com/oauth/authorize');
      const redirectUri = base + (process.env.ST_REDIRECT_PATH || '/api/integrations/st/callback');
      const scopes = (process.env.ST_SCOPES || 'devices:read devices:commands');
      const url = `${authUrl}?client_id=${encodeURIComponent(process.env.ST_CLIENT_ID || '')}` +
        `&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&state=${encodeURIComponent(state)}`;
      res.redirect(url);
    } catch (e) { res.status(500).send('Erro ao iniciar OAuth'); }
  });

  router.get('/integrations/st/callback', async (req, res) => {
    try {
      const code = String(req.query.code || '');
      const state = String(req.query.state || '');
      if (!code || !state) return res.status(400).send('missing code/state');
      const st = await dbApi.consumeOauthState(state);
      if (!st || st.vendor !== 'smartthings') return res.status(400).send('invalid state');
      const base = deriveBaseUrl(req);
      const redirectUri = base + (process.env.ST_REDIRECT_PATH || '/api/integrations/st/callback');
      const tok = await stTokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
      const access = String(tok.access_token || '');
      const refresh = String(tok.refresh_token || '');
      const expiresIn = Number(tok.expires_in || 0);
      const expires_at = Date.now() + Math.max(0, expiresIn - 30) * 1000;
      const scopes = String(tok.scope || process.env.ST_SCOPES || '');
      if (!access || !refresh) throw new Error('missing tokens');
      await dbApi.upsertLinkedAccount({ user_id: st.user_id, vendor: 'smartthings', access_token: enc(access), refresh_token: enc(refresh), expires_at, scopes, meta: { obtained_at: Date.now() } });
      const frontOrigin = (process.env.FRONT_ORIGIN || process.env.CORS_ORIGIN || '').replace(/\/$/, '');
      const toPath = String(process.env.FRONT_REDIRECT_SUCCESS || '/perfil');
      const toUrl = frontOrigin ? (frontOrigin + (toPath.startsWith('/') ? toPath : ('/' + toPath))) : toPath;
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!doctype html><meta charset="utf-8"/><title>SmartThings</title>
        <body style="font-family:system-ui,Segoe UI,Roboto,Arial;padding:24px;background:#0b1220;color:#e2e8f0">
          Conectado com sucesso.
          <script>(function(){try{if(window.opener)window.opener.postMessage('st:linked','*')}catch(e){};setTimeout(function(){location.href=${JSON.stringify(toUrl)}},300)})();</script>
        </body>`);
    } catch (e) { res.status(500).send('Falha ao conectar SmartThings'); }
  });

  router.post('/auth/smartthings/unlink', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try { await dbApi.deleteLinkedAccount(user.id, 'smartthings'); res.status(204).end(); }
    catch (e) { res.status(500).json({ ok: false, error: 'unlink failed' }); }
  });

  router.get('/auth/smartthings/status', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const row = await dbApi.getLinkedAccount(user.id, 'smartthings');
    res.json({ ok: true, connected: !!row, expires_at: row?.expires_at || null, scopes: row?.scopes || '' });
  });

  async function ensureStAccess(user) {
    const row = await dbApi.getLinkedAccount(user.id, 'smartthings');
    if (!row) throw Object.assign(new Error('not linked'), { code: 'NOT_LINKED' });
    let access = dec(row.access_token || '');
    const refresh = dec(row.refresh_token || '');
    const now = Date.now();
    if (!access || now >= Number(row.expires_at || 0) - 5000) {
      const tok = await stTokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
      access = String(tok.access_token || '');
      const newRefresh = String(tok.refresh_token || refresh || '');
      const expiresIn = Number(tok.expires_in || 0);
      const expires_at = Date.now() + Math.max(0, expiresIn - 30) * 1000;
      await dbApi.upsertLinkedAccount({ user_id: user.id, vendor: 'smartthings', access_token: enc(access), refresh_token: enc(newRefresh), expires_at, scopes: row.scopes, meta: { refreshed_at: Date.now() } });
    }
    return access;
  }

  router.get('/smartthings/devices', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const token = await ensureStAccess(user);
      const apiBase = (process.env.ST_API_BASE || 'https://api.smartthings.com/v1').replace(/\/$/, '');
      const r = await fetch(`${apiBase}/devices`, { headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json(j);
      const list = Array.isArray(j?.items) ? j.items : [];
      const norm = list.map(d => ({
        id: String(d?.deviceId || d?.device_id || ''),
        name: String(d?.label || d?.name || ''),
        roomId: d?.roomId || null,
        locationId: d?.locationId || null,
        manufacturer: d?.manufacturerName || null,
        profileId: d?.profileId || null,
        deviceTypeName: d?.deviceTypeName || d?.type || null,
        vendor: 'smartthings',
        components: d?.components || [],
        raw: d,
      }));
      res.json({ ok: true, items: norm, total: norm.length, ts: Date.now() });
    } catch (e) {
      if (String(e?.code) === 'NOT_LINKED') return res.status(401).json({ ok: false, error: 'not linked' });
      res.status(500).json({ ok: false, error: 'failed to fetch devices' });
    }
  });

  router.get('/smartthings/rooms', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const token = await ensureStAccess(user);
      const apiBase = (process.env.ST_API_BASE || 'https://api.smartthings.com/v1').replace(/\/$/, '');
      let locationIds = [];
      const qLoc = String(req.query.locationId || '').trim();
      if (qLoc) { locationIds = [qLoc]; } else {
        try {
          const r = await fetch(`${apiBase}/devices`, { headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
          const j = await r.json();
          const list = Array.isArray(j?.items) ? j.items : [];
          locationIds = Array.from(new Set(list.map(d => d?.locationId).filter(Boolean)));
        } catch { }
      }
      const rooms = [];
      for (const loc of locationIds) {
        try {
          const r = await fetch(`${apiBase}/locations/${encodeURIComponent(loc)}/rooms`, { headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
          const j = await r.json();
          const items = Array.isArray(j?.items) ? j.items : [];
          for (const it of items) rooms.push({ id: it?.roomId || it?.id, name: it?.name || it?.label || '', locationId: loc });
        } catch { }
      }
      res.json({ ok: true, items: rooms });
    } catch (e) {
      if (String(e?.code) === 'NOT_LINKED') return res.status(401).json({ ok: false, error: 'not linked' });
      res.status(500).json({ ok: false, error: 'failed to fetch rooms' });
    }
  });

  router.get('/smartthings/device/:id/status', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const token = await ensureStAccess(user);
      const apiBase = (process.env.ST_API_BASE || 'https://api.smartthings.com/v1').replace(/\/$/, '');
      const id = encodeURIComponent(String(req.params.id || ''));
      const r = await fetch(`${apiBase}/devices/${id}/status`, { headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
      const j = await r.json().catch(() => null);
      if (!r.ok) return res.status(r.status).json(j || { ok: false });
      res.json({ ok: true, status: j, ts: Date.now() });
    } catch (e) {
      if (String(e?.code) === 'NOT_LINKED') return res.status(401).json({ ok: false, error: 'not linked' });
      res.status(500).json({ ok: false, error: 'failed to fetch device status' });
    }
  });

  router.post('/smartthings/commands', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const token = await ensureStAccess(user);
      const apiBase = (process.env.ST_API_BASE || 'https://api.smartthings.com/v1').replace(/\/$/, '');
      const body = req.body || {};
      const deviceId = String(body.deviceId || '');
      let payload = null;
      if (Array.isArray(body.commands)) payload = { commands: body.commands };
      else if (body.capability && body.command) payload = { commands: [{ component: body.component || 'main', capability: body.capability, command: body.command, arguments: body.arguments || [] }] };
      else if (body.action === 'on' || body.action === 'off') payload = { commands: [{ component: 'main', capability: 'switch', command: body.action }] };
      if (!deviceId || !payload) return res.status(422).json({ ok: false, error: 'invalid payload (deviceId + commands/capability/command)' });
      const r = await fetch(`${apiBase}/devices/${encodeURIComponent(deviceId)}/commands`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
      const j = await r.json().catch(() => null);
      if (!r.ok) return res.status(r.status).json(j || { ok: false });
      res.json({ ok: true, result: j });
    } catch (e) {
      const code = String(e?.code || '');
      if (code === 'NOT_LINKED') return res.status(401).json({ ok: false, error: 'not linked' });
      res.status(500).json({ ok: false, error: 'failed to send command' });
    }
  });

  router.post('/smartthings/device/:id/:action', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const token = await ensureStAccess(user);
      const apiBase = (process.env.ST_API_BASE || 'https://api.smartthings.com/v1').replace(/\/$/, '');
      const id = String(req.params.id || '');
      const action = String(req.params.action || '').toLowerCase();
      if (action !== 'on' && action !== 'off') return res.status(400).json({ ok: false, error: 'action must be on/off' });
      const payload = { commands: [{ component: 'main', capability: 'switch', command: action }] };
      const r = await fetch(`${apiBase}/devices/${encodeURIComponent(id)}/commands`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
      const j = await r.json().catch(() => null);
      if (!r.ok) return res.status(r.status).json(j || { ok: false });
      res.json({ ok: true });
    } catch (e) { if (String(e?.code) === 'NOT_LINKED') return res.status(401).json({ ok: false, error: 'not linked' }); res.status(500).json({ ok: false, error: 'failed to send command' }); }
  });
}

