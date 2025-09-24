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
    // tuning knobs
    authTtlMs = 15 * 60 * 1000,
    maxConcurrent = 3,
    minIntervalMs = 150,
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
    this.authTtlMs = authTtlMs;

    // throttling / caching / inflight dedupe
    this._activeCalls = 0;
    this._lastStartAt = 0;
    this.maxConcurrent = maxConcurrent;
    this.minIntervalMs = minIntervalMs;
    this._inflight = new Map();
    this._cache = new Map();
    this._loginInflight = null;

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
    if (this._loginInflight) return this._loginInflight;
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

  async ensureAuthFresh() {
    const now = Date.now();
    const ts = Number(this.auth?.timestamp || 0);
    if (this.auth && now - ts < this.authTtlMs) return;
    if (this._loginInflight) return this._loginInflight;
    this._loginInflight = this.crossLogin().finally(() => { this._loginInflight = null; });
    return this._loginInflight;
  }

  // ---------- Throttle / cache / inflight helpers ----------
  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async _throttleStart() {
    while (this._activeCalls >= this.maxConcurrent) {
      await this._sleep(10);
    }
    const now = Date.now();
    const gap = now - this._lastStartAt;
    if (gap < this.minIntervalMs) await this._sleep(this.minIntervalMs - gap);
    this._activeCalls++;
    this._lastStartAt = Date.now();
  }
  _throttleEnd() {
    this._activeCalls = Math.max(0, this._activeCalls - 1);
  }

  _endpointTtl(endpointOrUrl) {
    const s = String(endpointOrUrl || '');
    const p = (() => {
      try { return s.startsWith('http') ? new URL(s).pathname.replace(/^\/+/, '') : s.replace(/^\/+/, ''); } catch { return s; }
    })();
    const map = new Map([
      ['v2/PowerStation/GetPowerflow', 5_000],
      ['v3/PowerStation/GetInverterAllPoint', 15_000],
      ['v3/PowerStation/GetPlantDetailByPowerstationId', 60_000],
      ['v2/Charts/GetChartByPlant', 600_000],
      ['v2/Charts/GetPlantPowerChart', 60_000],
      ['warning/PowerstationWarningsQuery', 30_000],
      ['v4/EvCharger/GetEvChargerCountByPwId', 60_000],
      ['PowerStationMonitor/QueryPowerStationMonitor', 30_000],
    ]);
    for (const [k, ttl] of map.entries()) {
      if (p.endsWith(k)) return ttl;
    }
    return 0;
  }

  _cacheGet(key) {
    const it = this._cache.get(key);
    if (!it) return null;
    if (Date.now() >= it.exp) { this._cache.delete(key); return null; }
    return it.data;
  }
  _cacheSet(key, data, ttlMs) {
    if (ttlMs > 0) this._cache.set(key, { data, exp: Date.now() + ttlMs });
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
    await this.ensureAuthFresh();
    const url = this.baseUrlJoin(endpoint);
    const payload = JSON.stringify(body || {});
    const key = `POST|${url}|${payload}`;
    const ttl = this._endpointTtl(endpoint);
    const cached = this._cacheGet(key);
    if (cached) return cached;
    if (this._inflight.has(key)) return this._inflight.get(key);
    const doCall = async () => {
      const url = this.baseUrlJoin(endpoint);
      await this._throttleStart();
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
        body: payload,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!r.ok) { this._throttleEnd(); throw new Error(`HTTP ${r.status}`); }
      this._updateCookiesFromResponse(r);
      const j = await r.json();
      this._throttleEnd();
      return j;
    };
    const promise = (async () => {
      let j = await doCall();
      if (j && (String(j.code) === '100001' || j.msg?.toLowerCase().includes('log in'))) {
        await this.crossLogin();
        j = await doCall();
      }
      this._cacheSet(key, j, ttl);
      return j;
    })().finally(() => this._inflight.delete(key));
    this._inflight.set(key, promise);
    return promise;
  }

  async postForm(endpoint, form) {
    await this.ensureAuthFresh();
    const url = this.baseUrlJoin(endpoint);
    const params = new URLSearchParams();
    Object.entries(form || {}).forEach(([k, v]) => params.append(k, v ?? ''));
    const payload = params.toString();
    const key = `POST|${url}|${payload}`;
    const ttl = this._endpointTtl(endpoint);
    const cached = this._cacheGet(key);
    if (cached) return cached;
    if (this._inflight.has(key)) return this._inflight.get(key);
    const doCall = async () => {
      const url = this.baseUrlJoin(endpoint);
      const params = new URLSearchParams();
      Object.entries(form || {}).forEach(([k, v]) => params.append(k, v ?? ''));
      await this._throttleStart();
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
      if (!r.ok) { this._throttleEnd(); throw new Error(`HTTP ${r.status}`); }
      this._updateCookiesFromResponse(r);
      const j = await r.json();
      this._throttleEnd();
      return j;
    };
    const promise = (async () => {
      let j = await doCall();
      if (j && (String(j.code) === '100001' || j.msg?.toLowerCase().includes('log in'))) {
        await this.crossLogin();
        j = await doCall();
      }
      this._cacheSet(key, j, ttl);
      return j;
    })().finally(() => this._inflight.delete(key));
    this._inflight.set(key, promise);
    return promise;
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
    await this.ensureAuthFresh();
    const payload = JSON.stringify(body || {});
    const key = `POST|${url}|${payload}`;
    const ttl = this._endpointTtl(url);
    const cached = this._cacheGet(key);
    if (cached) return cached;
    if (this._inflight.has(key)) return this._inflight.get(key);
    const doCall = async () => {
      await this._throttleStart();
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
        body: payload,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!r.ok) { this._throttleEnd(); throw new Error(`HTTP ${r.status}`); }
      this._updateCookiesFromResponse(r);
      const j = await r.json();
      this._throttleEnd();
      return j;
    };
    const promise = (async () => {
      let j = await doCall();
      if (j && (String(j.code) === '100001' || j.msg?.toLowerCase().includes('log in'))) {
        await this.crossLogin();
        j = await doCall();
      }
      this._cacheSet(key, j, ttl);
      return j;
    })().finally(() => this._inflight.delete(key));
    this._inflight.set(key, promise);
    return promise;
  }

  async postAbsoluteForm(url, form) {
    await this.ensureAuthFresh();
    const params = new URLSearchParams();
    Object.entries(form || {}).forEach(([k, v]) => params.append(k, v ?? ''));
    const payload = params.toString();
    const key = `POST|${url}|${payload}`;
    const ttl = this._endpointTtl(url);
    const cached = this._cacheGet(key);
    if (cached) return cached;
    if (this._inflight.has(key)) return this._inflight.get(key);
    const doCall = async () => {
      const params = new URLSearchParams();
      Object.entries(form || {}).forEach(([k, v]) => params.append(k, v ?? ''));
      await this._throttleStart();
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
      if (!r.ok) { this._throttleEnd(); throw new Error(`HTTP ${r.status}`); }
      this._updateCookiesFromResponse(r);
      const j = await r.json();
      this._throttleEnd();
      return j;
    };
    const promise = (async () => {
      let j = await doCall();
      if (j && (String(j.code) === '100001' || j.msg?.toLowerCase().includes('log in'))) {
        await this.crossLogin();
        j = await doCall();
      }
      this._cacheSet(key, j, ttl);
      return j;
    })().finally(() => this._inflight.delete(key));
    this._inflight.set(key, promise);
    return promise;
  }
}
