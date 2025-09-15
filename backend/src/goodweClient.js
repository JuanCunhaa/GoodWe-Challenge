import fs from 'node:fs';
import path from 'node:path';

const CROSSLOGIN_URLS = [
  'https://www.semsportal.com/api/v1/Common/CrossLogin',
  'https://www.semsportal.com/api/v2/Common/CrossLogin',
  'https://www.semsportal.com/api/v3/Common/CrossLogin'
];

const DEFAULT_CLIENT = 'web';
const DEFAULT_VERSION = 'v2.1.0';
const DEFAULT_LANG = 'en';

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function writeJSON(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf-8');
}

export class GoodWeClient {
  constructor({
    account,
    password,
    client = DEFAULT_CLIENT,
    version = DEFAULT_VERSION,
    language = DEFAULT_LANG,
    tokenCachePath = '.cache/goodwe_token.json',
    timeoutMs = 30000,
  }) {
    if (!globalThis.fetch) {
      throw new Error('Node 18+ required (global fetch).');
    }
    this.account = account;
    this.password = password;
    this.client = client;
    this.version = version;
    this.language = language;
    this.timeoutMs = timeoutMs;
    this.tokenCachePath = tokenCachePath;

    this.auth = null; // { uid, token, timestamp, api, client, version, language }
    this.cookies = {}; // simple jar: name -> value (for *.semsportal.com)

    if (this.tokenCachePath && fs.existsSync(this.tokenCachePath)) {
      const cached = readJSON(this.tokenCachePath);
      if (cached && cached.uid && cached.token && cached.api_base) {
        this.auth = cached;
      }
    }
  }

  get tokenHeaderValue() {
    if (!this.auth) return null;
    return JSON.stringify({
      uid: this.auth.uid,
      timestamp: String(this.auth.timestamp),
      token: this.auth.token,
      client: this.client,
      version: this.version,
      language: this.language,
    });
  }

  async crossLogin() {
    const minimalToken = JSON.stringify({ client: this.client, version: this.version, language: this.language });
    const body = { account: this.account, pwd: this.password };

    let lastErr;
    for (const url of CROSSLOGIN_URLS) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Token': minimalToken,
            'User-Agent': 'goodwe-node/0.1',
            'Origin': 'https://www.semsportal.com',
            'Referer': 'https://www.semsportal.com/',
            ...(this._cookieHeaderForUrl(url) ? { 'Cookie': this._cookieHeaderForUrl(url) } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs)
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        this._updateCookiesFromResponse(r);
        const data = await r.json();
        const d = data && data.data ? data.data : null;
        const ok = d && d.uid && d.token && (String(data.code) === '0' || data.hasError === false);
        if (!ok) { lastErr = new Error(`CrossLogin fail or missing token/uid: ${JSON.stringify({ code: data?.code, hasError: data?.hasError, hasData: !!d })}`); continue; }
        const apiBase = data.api || (data.components && data.components.api);
        if (!apiBase) throw new Error("CrossLogin OK, but missing 'api' base");
        this.auth = {
          uid: d.uid,
          token: d.token,
          timestamp: Number(d.timestamp || Date.now()),
          api_base: apiBase,
          client: this.client,
          version: this.version,
          language: this.language,
        };
        if (this.tokenCachePath) writeJSON(this.tokenCachePath, this.auth);
        return this.auth;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(`CrossLogin not completed. Last error: ${lastErr}`);
  }

  async ensureAuth() {
    if (!this.auth) {
      await this.crossLogin();
    }
  }

  baseUrlJoin(endpoint) {
    const base = this.auth.api_base.endsWith('/') ? this.auth.api_base : (this.auth.api_base + '/');
    return base + endpoint.replace(/^\//, '');
  }

  // Returns raw SEMS CrossLogin JSON (no auth state change guaranteed)
  async crossLoginRaw({ version = 'auto' } = {}) {
    const minimalToken = JSON.stringify({ client: this.client, version: this.version, language: this.language });
    const body = { account: this.account, pwd: this.password };
    const urls = (version === 'v1' || version === 'v2' || version === 'v3')
      ? [
          'https://www.semsportal.com/api/' + version + '/Common/CrossLogin'
        ]
      : [...CROSSLOGIN_URLS];

    let lastErr;
    for (const url of urls) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Token': minimalToken,
            'User-Agent': 'goodwe-node/0.1',
            'Origin': 'https://www.semsportal.com',
            'Referer': 'https://www.semsportal.com/',
            ...(this._cookieHeaderForUrl(url) ? { 'Cookie': this._cookieHeaderForUrl(url) } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs)
        });
        if (!r.ok) {
          lastErr = new Error(`HTTP ${r.status}`);
          continue;
        }
        this._updateCookiesFromResponse(r);
        const data = await r.json();
        return data; // return raw JSON exactly as SEMS sent
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(`CrossLogin raw failed. Last error: ${lastErr}`);
  }

  async postJson(endpoint, body) {
    // CrossLogin em toda chamada para garantir sessão válida
    await this.crossLogin();
    const doCall = async () => {
      const url = this.baseUrlJoin(endpoint);
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'goodwe-node/0.1',
          'Token': this.tokenHeaderValue,
          'X-Requested-With': 'XMLHttpRequest',
          'Accept-Language': 'en-US,en;q=0.9',
          'Origin': 'https://www.semsportal.com',
          'Referer': 'https://www.semsportal.com/',
          ...(this._cookieHeaderForUrl(url) ? { 'Cookie': this._cookieHeaderForUrl(url) } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this._updateCookiesFromResponse(r);
      return r.json();
    };
    let j = await doCall();
    if (j && (String(j.code) === '100001' || j.msg?.toLowerCase().includes('log in'))) {
      // token expirado/invalidado -> reloga e tenta 1x
      await this.crossLogin();
      j = await doCall();
    }
    return j;
  }

  async postForm(endpoint, form) {
    await this.crossLogin();
    const doCall = async () => {
      const url = this.baseUrlJoin(endpoint);
      const params = new URLSearchParams();
      Object.entries(form || {}).forEach(([k, v]) => params.append(k, v ?? ''));
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'goodwe-node/0.1',
          'Token': this.tokenHeaderValue,
          'X-Requested-With': 'XMLHttpRequest',
          'Accept-Language': 'en-US,en;q=0.9',
          'Origin': 'https://www.semsportal.com',
          'Referer': 'https://www.semsportal.com/',
          ...(this._cookieHeaderForUrl(url) ? { 'Cookie': this._cookieHeaderForUrl(url) } : {}),
        },
        body: params.toString(),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this._updateCookiesFromResponse(r);
      return r.json();
    };
    let j = await doCall();
    if (j && (String(j.code) === '100001' || j.msg?.toLowerCase().includes('log in'))) {
      await this.crossLogin();
      j = await doCall();
    }
    return j;
  }

  // ---------- Cookie helpers ----------
  _updateCookiesFromResponse(res) {
    try {
      const h = res.headers;
      const list = typeof h.getSetCookie === 'function' ? h.getSetCookie() : (h.get('set-cookie') ? [h.get('set-cookie')] : []);
      for (const c of list) {
        if (!c) continue;
        const first = String(c).split(';')[0];
        const eq = first.indexOf('=');
        if (eq > 0) {
          const name = first.slice(0, eq).trim();
          const val = first.slice(eq + 1).trim();
          if (name && val) this.cookies[name] = val;
        }
      }
    } catch {}
  }

  _cookieHeaderForUrl(url) {
    try {
      const u = new URL(url);
      if (!u.hostname.endsWith('semsportal.com')) return '';
      const parts = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`);
      return parts.length ? parts.join('; ') : '';
    } catch { return ''; }
  }

  async postAbsoluteJson(url, body) {
    await this.crossLogin();
    const doCall = async () => {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'goodwe-node/0.1',
          'Token': this.tokenHeaderValue,
          'X-Requested-With': 'XMLHttpRequest',
          'Accept-Language': 'en-US,en;q=0.9',
          'Origin': 'https://www.semsportal.com',
          'Referer': 'https://www.semsportal.com/',
          ...(this._cookieHeaderForUrl(url) ? { 'Cookie': this._cookieHeaderForUrl(url) } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this._updateCookiesFromResponse(r);
      return r.json();
    };
    let j = await doCall();
    if (j && (String(j.code) === '100001' || j.msg?.toLowerCase().includes('log in'))) {
      await this.crossLogin();
      j = await doCall();
    }
    return j;
  }

  async postAbsoluteForm(url, form) {
    await this.crossLogin();
    const doCall = async () => {
      const params = new URLSearchParams();
      Object.entries(form || {}).forEach(([k, v]) => params.append(k, v ?? ''));
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'goodwe-node/0.1',
          'Token': this.tokenHeaderValue,
          'X-Requested-With': 'XMLHttpRequest',
          'Accept-Language': 'en-US,en;q=0.9',
          'Origin': 'https://www.semsportal.com',
          'Referer': 'https://www.semsportal.com/',
          ...(this._cookieHeaderForUrl(url) ? { 'Cookie': this._cookieHeaderForUrl(url) } : {}),
        },
        body: params.toString(),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this._updateCookiesFromResponse(r);
      return r.json();
    };
    let j = await doCall();
    if (j && (String(j.code) === '100001' || j.msg?.toLowerCase().includes('log in'))) {
      await this.crossLogin();
      j = await doCall();
    }
    return j;
  }
}
