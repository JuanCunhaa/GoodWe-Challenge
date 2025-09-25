import { Router } from 'express';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function createRoutes(gw, dbApi) {
  const router = Router();

  // Resolve env paths (supports relative like ../piper/..., strips quotes)
  function resolveEnvPath(name) {
    let p = process.env[name] || '';
    if (!p) return '';
    // strip wrapping quotes if present
    p = p.replace(/^"|^'|"$|'$/g, '');
    if (path.isAbsolute(p)) return p;
    try {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const base = path.resolve(here, '..');
      return path.resolve(base, p);
    } catch { return p; }
  }

  // -------- Helpers (dedupe token + params) --------
  const getBearerToken = (req) => {
    const auth = String(req.headers['authorization'] || '');
    return auth.startsWith('Bearer ') ? auth.slice(7) : null;
  };
  const tryGetUser = (req) => {
    try {
      const token = getBearerToken(req);
      if (!token) return null;
      const sess = dbApi.getSession(token);
      if (!sess) return null;
      const user = dbApi.getUserById(sess.user_id);
      return user || null;
    } catch { return null; }
  };
  const requireUser = (req, res) => {
    const token = getBearerToken(req);
    if (!token) { res.status(401).json({ ok:false, error:'missing token' }); return null; }
    const sess = dbApi.getSession(token);
    if (!sess) { res.status(401).json({ ok:false, error:'invalid token' }); return null; }
    const user = dbApi.getUserById(sess.user_id);
    if (!user) { res.status(401).json({ ok:false, error:'invalid token' }); return null; }
    return user;
  };
  const getPsId = (req) => {
    const user = tryGetUser(req);
    return (
      req.query.powerStationId ||
      req.query.powerstation_id ||
      req.query.pw_id ||
      user?.powerstation_id ||
      ''
    );
  };

  // Health
  router.get('/health', (req, res) => res.json({ ok: true }));

  // Powerstations (local DB)
  router.get('/powerstations', (req, res) => {
    res.json({ items: dbApi.listPowerstations() });
  });
  router.post('/powerstations/:id/name', (req, res) => {
    const { id } = req.params;
    const { name } = req.body || {};
    dbApi.upsertBusinessName(id, name || null);
    res.json({ ok: true });
  });

  // GoodWe API wrappers
  // Debug helpers (no secrets)
  router.get('/debug/auth', (req, res) => {
    const auth = gw.auth || null;
    const cookies = Object.keys(gw.cookies || {});
    const tokenHeader = gw.tokenHeaderValue || null;
    const mask = (s) => (typeof s === 'string' && s.length > 12) ? `${s.slice(0, 8)}...${s.slice(-4)}` : s;
    res.json({
      hasAuth: !!auth,
      api_base: auth?.api_base || null,
      uid: auth?.uid || null,
      token_present: !!auth?.token,
      timestamp: auth?.timestamp || null,
      cookies,
      token_header_length: tokenHeader ? tokenHeader.length : 0,
      token_header_preview: tokenHeader ? tokenHeader.slice(0, 64) + '...' : null,
      token_mask: auth?.token ? mask(auth.token) : null,
    });
  });

  // ---------------- Assistant (LLM + Tools) ----------------
  // TTS (Node): usa Piper TTS se configurado; fallback para servidor Python se TTS_SERVER_URL estiver definido
  // --------- Simple in-memory TTS cache (speeds up repeated phrases) ---------
  const TTS_CACHE_MAX = Math.max(0, Number(process.env.TTS_CACHE_MAX || 100));
  const TTS_CACHE_TTL_MS = Math.max(0, Number(process.env.TTS_CACHE_TTL_MS || 24 * 60 * 60 * 1000));
  const ttsCache = new Map(); // key -> { buf: Buffer, exp: number }
  const inflight = new Map(); // key -> Promise<Buffer>
  // Global concurrency limiter (avoid spawning many pipers at once)
  const TTS_MAX_CONCURRENT = Math.max(1, Number(process.env.TTS_MAX_CONCURRENT || 1));
  let activeSlots = 0;
  const waiters = [];
  function acquireSlot(){
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (activeSlots < TTS_MAX_CONCURRENT){ activeSlots++; resolve(); }
        else waiters.push(tryAcquire);
      };
      tryAcquire();
    });
  }
  function releaseSlot(){
    activeSlots = Math.max(0, activeSlots - 1);
    const next = waiters.shift(); if (next) next();
  }
  function cacheKey(text) {
    const PIPER_PATH = resolveEnvPath('PIPER_PATH') || '';
    const PIPER_VOICE = resolveEnvPath('PIPER_VOICE') || '';
    const PIPER_VOICE_JSON = resolveEnvPath('PIPER_VOICE_JSON') || '';
    const PIPER_SPEAKER = process.env.PIPER_SPEAKER || '';
    const PIPER_LENGTH_SCALE = process.env.PIPER_LENGTH_SCALE || '';
    const PIPER_NOISE_SCALE = process.env.PIPER_NOISE_SCALE || '';
    const PIPER_NOISE_W = process.env.PIPER_NOISE_W || '';
    const sig = JSON.stringify({ PIPER_PATH, PIPER_VOICE, PIPER_VOICE_JSON, PIPER_SPEAKER, PIPER_LENGTH_SCALE, PIPER_NOISE_SCALE, PIPER_NOISE_W });
    return crypto.createHash('sha1').update(text + '|' + sig).digest('hex');
  }
  function cacheGet(key){
    if (!TTS_CACHE_MAX) return null;
    const it = ttsCache.get(key);
    if (!it) return null;
    if (Date.now() >= it.exp) { ttsCache.delete(key); return null; }
    return it.buf;
  }
  function cacheSet(key, buf){
    if (!TTS_CACHE_MAX || !buf) return;
    ttsCache.set(key, { buf, exp: Date.now() + TTS_CACHE_TTL_MS });
    if (ttsCache.size > TTS_CACHE_MAX){
      const firstKey = ttsCache.keys().next().value;
      if (firstKey) ttsCache.delete(firstKey);
    }
  }

  router.all('/tts', async (req, res) => {
    const raw = req.method === 'GET'
      ? String(req.query?.text || '')
      : String(req.body?.text || '');
    const text = (raw && typeof raw.normalize === 'function') ? raw.normalize('NFC').trim() : String(raw).trim();
    if (!text) return res.status(400).json({ ok: false, error: 'text is required' });

    const key = cacheKey(text);
    const cached = cacheGet(key);
    if (cached) {
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(cached);
    }
    if (inflight.has(key)){
      try{
        const buf = await inflight.get(key);
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Cache-Control', 'no-store');
        return res.send(buf);
      }catch(e){ return res.status(500).json({ ok:false, error:String(e) }) }
    }

    // 1) Tentativa com Piper (Node) se variáveis estiverem configuradas
    const PIPER_PATH = resolveEnvPath('PIPER_PATH') || '';
    const PIPER_VOICE = resolveEnvPath('PIPER_VOICE') || '';
    const PIPER_VOICE_JSON = resolveEnvPath('PIPER_VOICE_JSON') || '';
    const PIPER_SPEAKER = process.env.PIPER_SPEAKER || '';
    const PIPER_LENGTH_SCALE = process.env.PIPER_LENGTH_SCALE || '';
    const PIPER_NOISE_SCALE = process.env.PIPER_NOISE_SCALE || '';
    const PIPER_NOISE_W = process.env.PIPER_NOISE_W || '';

    const canUsePiper = !!(PIPER_PATH && PIPER_VOICE);
    if (canUsePiper) {
      // Opcional: verificação de existência ajuda a detectar path relativo inválido
      try {
        await fs.access(PIPER_PATH);
        await fs.access(PIPER_VOICE);
        if (PIPER_VOICE_JSON) { await fs.access(PIPER_VOICE_JSON).catch(()=>{}); }
      } catch (e) {
        // Se o caminho não existe, não tente spawn; cai para fallback/erro
        // console.warn('[tts] invalid path', e);
      }
      const outPath = path.join(os.tmpdir(), `tts-${crypto.randomUUID()}.wav`);
      // Piper recebe o texto via STDIN. Flags curtas são mais compatíveis (-m, -c, -f, -s, -l, -p, -r)
      const args = ['-m', PIPER_VOICE, '-f', outPath];
      if (PIPER_VOICE_JSON) { args.push('-c', PIPER_VOICE_JSON); }
      if (PIPER_SPEAKER) { args.push('-s', String(PIPER_SPEAKER)); }
      if (PIPER_LENGTH_SCALE) { args.push('-l', String(PIPER_LENGTH_SCALE)); }
      if (PIPER_NOISE_SCALE) { args.push('-p', String(PIPER_NOISE_SCALE)); }
      if (PIPER_NOISE_W) { args.push('-r', String(PIPER_NOISE_W)); }

      try {
        await acquireSlot();
        await new Promise((resolve, reject) => {
          const child = spawn(PIPER_PATH, args, { stdio: ['pipe', 'ignore', 'pipe'] });
          let stderr = '';
          child.stderr.on('data', (d) => { stderr += d.toString(); });
          child.on('error', (e) => { releaseSlot(); reject(e) });
          child.on('close', (code) => {
            releaseSlot();
            if (code === 0) resolve(0);
            else reject(new Error(`piper exited with code ${code}: ${stderr.slice(0, 500)}`));
          });
          try { child.stdin.setDefaultEncoding('utf8'); child.stdin.write(text + "\n"); child.stdin.end(); } catch {}
        });
        // Tenta ler o arquivo (com pequeno retry em caso de latência no FS)
        let buf = await fs.readFile(outPath).catch(() => null);
        if (!buf) {
          await new Promise(r => setTimeout(r, 50));
          buf = await fs.readFile(outPath).catch(() => null);
        }
        try { await fs.unlink(outPath).catch(()=>{}); } catch {}
        if (!buf) return res.status(500).json({ ok: false, error: 'piper: missing output file' });
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Cache-Control', 'no-store');
        return res.send(buf);
      } catch (e) {
        // cai para fallback
      }
    }

    // 2) Fallback: servidor HTTP externo (Piper/Coqui), se configurado
    const TTS_URL = process.env.PIPER_HTTP_URL || process.env.TTS_SERVER_URL || '';
    if (TTS_URL) {
      try {
        const p = (async () => {
          const r = await fetch(TTS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
            signal: AbortSignal.timeout(Number(process.env.TTS_TIMEOUT_MS || 60000)),
          });
          const buf = Buffer.from(await r.arrayBuffer());
          if (!r.ok) {
            const msg = buf.toString('utf8');
            throw new Error(`TTS server HTTP ${r.status}: ${msg.slice(0, 200)}`);
          }
          cacheSet(key, buf);
          return buf;
        })();
        inflight.set(key, p);
        const buf = await p.finally(()=> inflight.delete(key));
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Cache-Control', 'no-store');
        return res.send(buf);
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e) });
      }
    }

    // 3) Sem TTS disponível
    return res.status(501).json({ ok: false, error: 'TTS not configured. Set PIPER_PATH and PIPER_VOICE, or PIPER_HTTP_URL/TTS_SERVER_URL.' });
  });

  router.post('/assistant/chat', async (req, res) => {
    try {
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || '';
      if (!OPENAI_API_KEY) return res.status(501).json({ ok: false, error: 'assistant unavailable: missing OPENAI_API_KEY' });

      const user = requireUser(req, res); if (!user) return;

      const input = String(req.body?.input || '').trim();
      const prev = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const psId = user.powerstation_id;

      // Tool registry
      const tools = {
        async get_income_today() {
          const body = { powerstation_id: psId, key: '', orderby: '', powerstation_type: '', powerstation_status: '', page_index: 1, page_size: 14, adcode: '', org_id: '', condition: '' };
          const j = await gw.postJson('PowerStationMonitor/QueryPowerStationMonitor', body);
          const it = j?.data?.list?.[0] || {};
          const income = Number(it?.eday_income || 0);
          const currency = String(it?.currency || 'BRL');
          const date = new Date().toISOString().slice(0, 10);
          return { income, currency, date, source: '/api/monitor' };
        },
        async get_total_income() {
          const det = await gw.postForm('v3/PowerStation/GetPlantDetailByPowerstationId', { powerStationId: psId });
          const income = Number(det?.data?.kpi?.total_income || 0);
          const currency = String(det?.data?.kpi?.currency || 'BRL');
          return { income, currency, source: '/api/plant-detail' };
        },
        async get_generation({ range }) {
          const today = new Date();
          const pad = (n) => String(n).padStart(2, '0');
          const dateLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          const norm = (s) => String(s || '')
            .toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '');
          const mapXY = (arr) => { const m = new Map(); (arr || []).forEach(p => { const k = String(p?.x || ''); if (k) m.set(k, Number(p?.y) || 0) }); return m };
          const parseGenFromChart = async (refDate) => {
            const body = { id: psId, date: dateLocal(refDate), range: 2, chartIndexId: '8', isDetailFull: false };
            const j = await gw.postJson('v2/Charts/GetChartByPlant', body);
            const lines = j?.data?.lines || [];
            const by = {}; for (const l of lines) { by[norm(l.label || l.name)] = l.xy || [] }
            let genArr = by['generationkwh'] || by['generatekwh'] || by['pvgenerationkwh'] || by['pvkwh'] || null;
            if (!genArr) {
              const k = Object.keys(by).find(k => k.includes('generation'));
              if (k) genArr = by[k];
            }
            const genMap = genArr ? mapXY(genArr) : new Map();
            const inHouseMap = mapXY(by['inhousekwh'] || by['selfusekwh'] || []);
            const gridSellMap = mapXY(by['gridkwhsell'] || by['gridwkwhsell'] || by['gridsellkwh'] || by['sellkwh'] || []);
            return { genMap, inHouseMap, gridSellMap };
          };

          if (range === 'total') {
            const det = await gw.postForm('v3/PowerStation/GetPlantDetailByPowerstationId', { powerStationId: psId });
            const etotal = Number(det?.data?.kpi?.etotal ?? det?.data?.info?.etotal ?? 0);
            return { kwh: etotal, period: 'total', source: '/api/plant-detail' };
          }

          if (range === 'this_month') {
            const { genMap, inHouseMap, gridSellMap } = await parseGenFromChart(today);
            const ym = dateLocal(today).slice(0, 7);
            let sum = 0;
            for (const [k, v] of genMap.entries()) {
              if (k.startsWith(ym)) sum += Number(v) || 0;
            }
            // fallback: soma inHouse + gridSell se não houver genMap
            if (sum === 0) {
              for (const [k, v] of inHouseMap.entries()) {
                if (k.startsWith(ym)) sum += Number(v) || 0;
              }
              for (const [k, v] of gridSellMap.entries()) {
                if (k.startsWith(ym)) sum += Number(v) || 0;
              }
            }
            return { kwh: sum, period: 'this_month', source: '/api/chart-by-plant?range=2' };
          }

          if (range === 'this_week') {
            const { genMap, inHouseMap, gridSellMap } = await parseGenFromChart(today);
            // calcula início da semana (domingo) e fim (sábado)
            const base = new Date(today);
            const day = base.getDay();
            const startD = new Date(base); startD.setDate(base.getDate() - day);
            const endD = new Date(startD); endD.setDate(startD.getDate() + 6);
            let sum = 0;
            for (const [k, v] of genMap.entries()) {
              const d = new Date(k + 'T00:00:00');
              if (d >= startD && d <= endD) sum += Number(v) || 0;
            }
            if (sum === 0) {
              for (const [k, v] of inHouseMap.entries()) {
                const d = new Date(k + 'T00:00:00');
                if (d >= startD && d <= endD) sum += Number(v) || 0;
              }
              for (const [k, v] of gridSellMap.entries()) {
                const d = new Date(k + 'T00:00:00');
                if (d >= startD && d <= endD) sum += Number(v) || 0;
              }
            }
            return { kwh: sum, period: 'this_week', source: '/api/chart-by-plant?range=2' };
          }

          if (range === 'yesterday') {
            const { genMap, inHouseMap, gridSellMap } = await parseGenFromChart(today);
            const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
            const yKey = dateLocal(yesterday);
            let val = Number(genMap.get(yKey)) || 0;
            if (!val) val = (Number(inHouseMap.get(yKey)) || 0) + (Number(gridSellMap.get(yKey)) || 0);
            return { kwh: val, period: 'yesterday', date: yKey, source: '/api/chart-by-plant?range=2' };
          }

          if (range === 'today') {
            // Usa o endpoint correto para geração do dia
            const body = { powerstation_id: psId, key: '', orderby: '', powerstation_type: '', powerstation_status: '', page_index: 1, page_size: 14, adcode: '', org_id: '', condition: '' };
            const j = await gw.postJson('PowerStationMonitor/QueryPowerStationMonitor', body);
            // Como só vem a planta certa, pega o primeiro item
            const it = j?.data?.list?.[0] || {};
            const kwh = Number(it?.eday ?? it?.eday_kwh ?? 0);
            const today = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const dateLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            return { kwh, period: 'today', date: dateLocal(today), source: '/api/monitor' };
          }

          return { kwh: 0, period: range, note: 'unsupported range' };
        },
        async eval_code({ language, code, timeout_ms }) {
          const lang = String(language || '').toLowerCase();
          if (lang && !['js', 'javascript', 'node'].includes(lang)) {
            return { ok: false, error: `language not supported: ${language}` };
          }
          const vm = await import('node:vm');
          const output = [];
          const sandbox = { console: { log: (...a) => output.push(a.join(' ')) } };
          try {
            const script = new vm.Script(String(code || ''));
            const ctx = vm.createContext(sandbox);
            script.runInContext(ctx, { timeout: Math.min(Number(timeout_ms || 1000), 5000) });
            return { ok: true, stdout: output.join('\n'), stderr: '', exit_code: 0 };
          } catch (e) {
            return { ok: false, stdout: output.join('\n'), stderr: String(e), exit_code: 1 };
          }
        },
        async get_monitor({ page_index = 1, page_size = 14, key = '', orderby = '', powerstation_type = '', powerstation_status = '', adcode = '', org_id = '', condition = '' } = {}) {
          const body = { powerstation_id: psId, key, orderby, powerstation_type, powerstation_status, page_index: Number(page_index), page_size: Number(page_size), adcode, org_id, condition };
          const j = await gw.postJson('PowerStationMonitor/QueryPowerStationMonitor', body);
          return j;
        },
        async get_inverters() {
          const j = await gw.postForm('v3/PowerStation/GetInverterAllPoint', { powerStationId: psId });
          return j;
        },
        async get_weather() {
          const j = await gw.postForm('v3/PowerStation/GetWeather', { powerStationId: psId });
          return j;
        },
        async get_powerflow() {
          const j = await gw.postJson('v2/PowerStation/GetPowerflow', { PowerStationId: psId });
          return j;
        },
        async get_evcharger_count() {
          const j = await gw.postJson('v4/EvCharger/GetEvChargerCountByPwId', { PowerStationId: psId });
          return j;
        },
        async get_plant_detail() {
          const j = await gw.postForm('v3/PowerStation/GetPlantDetailByPowerstationId', { powerStationId: psId });
          return j;
        },
        async get_chart_by_plant({ date = '', range = 2, chartIndexId = '8', isDetailFull = false } = {}) {
          const body = { id: psId, date, range: Number(range), chartIndexId: String(chartIndexId), isDetailFull: !!isDetailFull };
          const j = await gw.postJson('v2/Charts/GetChartByPlant', body);
          return j;
        },
        async get_power_chart({ date = '', full_script = true } = {}) {
          const body = { id: psId, date, full_script: !!full_script };
          const j = await gw.postJson('v2/Charts/GetPlantPowerChart', body);
          return j;
        },
        async get_warnings() {
          let j = await gw.postForm('warning/PowerstationWarningsQuery', { pw_id: psId });
          if (String(j?.code) !== '0') {
            try { j = await gw.postAbsoluteForm('https://eu.semsportal.com/api/warning/PowerstationWarningsQuery', { pw_id: psId }); } catch { }
            if (String(j?.code) !== '0') j = await gw.postAbsoluteForm('https://us.semsportal.com/api/warning/PowerstationWarningsQuery', { pw_id: psId });
          }
          return j;
        },
        async get_monitor_abs({ url, key = '', orderby = '', powerstation_type = '', powerstation_status = '', page_index = 1, page_size = 14, adcode = '', org_id = '', condition = '' } = {}) {
          if (!url) return { ok: false, error: 'url is required' };
          const body = { powerstation_id: psId, key, orderby, powerstation_type, powerstation_status, page_index: Number(page_index), page_size: Number(page_size), adcode, org_id, condition };
          const j = await gw.postAbsoluteJson(url, body);
          return j;
        },
        async list_powerstations() {
          return { items: dbApi.listPowerstations() };
        },
        async set_powerstation_name({ id, name }) {
          if (!id) return { ok: false, error: 'id required' };
          dbApi.upsertBusinessName(id, name || null);
          return { ok: true };
        },
        async debug_auth() {
          const auth = gw.auth || null;
          const cookies = Object.keys(gw.cookies || {});
          const tokenHeader = gw.tokenHeaderValue || null;
          const mask = (s) => (typeof s === 'string' && s.length > 12) ? `${s.slice(0, 8)}...${s.slice(-4)}` : s;
          return {
            hasAuth: !!auth,
            api_base: auth?.api_base || null,
            uid: auth?.uid || null,
            token_present: !!auth?.token,
            timestamp: auth?.timestamp || null,
            cookies,
            token_header_length: tokenHeader ? tokenHeader.length : 0,
            token_header_preview: tokenHeader ? tokenHeader.slice(0, 64) + '...' : null,
            token_mask: auth?.token ? mask(auth.token) : null,
          };
        },
        async cross_login() {
          const a = await gw.crossLogin();
          return { api_base: a.api_base, uid: a.uid, timestamp: a.timestamp };
        },
        async cross_login_raw({ version = 'auto' } = {}) {
          const raw = await gw.crossLoginRaw({ version: String(version) });
          return raw;
        },
      };

      const toolSchemas = [
        { name: 'get_income_today', description: 'Retorna a renda agregada de hoje.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_total_income', description: 'Retorna a renda total acumulada da planta.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_generation', description: 'Retorna a geração para um intervalo padrão.', parameters: { type: 'object', properties: { range: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month', 'total'] } }, required: ['range'], additionalProperties: false } },
        { name: 'eval_code', description: 'Executa código JS em sandbox e retorna stdout/stderr/exit_code.', parameters: { type: 'object', properties: { language: { type: 'string' }, code: { type: 'string' }, timeout_ms: { type: 'number' } }, required: ['code'], additionalProperties: false } },
        { name: 'get_monitor', description: 'QueryPowerStationMonitor', parameters: { type: 'object', properties: { page_index: { type: 'number' }, page_size: { type: 'number' }, key: { type: 'string' }, orderby: { type: 'string' }, powerstation_type: { type: 'string' }, powerstation_status: { type: 'string' }, adcode: { type: 'string' }, org_id: { type: 'string' }, condition: { type: 'string' } }, additionalProperties: false } },
        { name: 'get_inverters', description: 'GetInverterAllPoint', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_weather', description: 'GetWeather', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_powerflow', description: 'GetPowerflow', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_evcharger_count', description: 'GetEvChargerCountByPwId', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_plant_detail', description: 'GetPlantDetailByPowerstationId', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_chart_by_plant', description: 'Charts/GetChartByPlant', parameters: { type: 'object', properties: { date: { type: 'string' }, range: { type: 'number' }, chartIndexId: { type: 'string' }, isDetailFull: { type: 'boolean' } }, additionalProperties: false } },
        { name: 'get_power_chart', description: 'Charts/GetPlantPowerChart', parameters: { type: 'object', properties: { date: { type: 'string' }, full_script: { type: 'boolean' } }, additionalProperties: false } },
        { name: 'get_warnings', description: 'warning/PowerstationWarningsQuery', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_monitor_abs', description: 'Absolute monitor via components.api port', parameters: { type: 'object', properties: { url: { type: 'string' }, key: { type: 'string' }, orderby: { type: 'string' }, powerstation_type: { type: 'string' }, powerstation_status: { type: 'string' }, page_index: { type: 'number' }, page_size: { type: 'number' }, adcode: { type: 'string' }, org_id: { type: 'string' }, condition: { type: 'string' } }, required: ['url'], additionalProperties: false } },
        { name: 'list_powerstations', description: 'Lista powerstations locais', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'set_powerstation_name', description: 'Define nome comercial local para powerstation', parameters: { type: 'object', properties: { id: { type: 'string' }, name: { type: ['string', 'null'] } }, required: ['id'], additionalProperties: false } },
        { name: 'debug_auth', description: 'Info de autenticação GoodWe no servidor (token/cookies mascarados)', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'cross_login', description: 'Executa CrossLogin GoodWe', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'cross_login_raw', description: 'Retorna JSON cru do CrossLogin SEMS', parameters: { type: 'object', properties: { version: { type: 'string' } }, additionalProperties: false } },
      ];

      const SYSTEM_PROMPT = `Você é o Assistente Virtual deste painel. Siga as regras:
Use ferramentas registradas sempre que a pergunta demandar dados reais (renda, geração, métricas, status, etc.).
Não invente valores. Se faltar permissão/credencial, peça para o usuário conectar/entrar.
Ao responder métricas, informe apenas o período (ex.: Hoje, Ontem, Esta Semana, Este Mês, Total), sem incluir a data por extenso ou o local/origem dos dados (não cite endpoints, APIs ou fontes técnicas).
Seja breve, direto e útil. Liste passos acionáveis quando fizer sentido.
Idioma padrão: pt-BR; use o tom do produto; não exponha segredos.
Nunca utilize o caractere ** em nenhuma resposta.
Se qualquer valor de renda ou preço vier em moeda diferente de BRL, sempre converta e informe também o valor equivalente em BRL usando as seguintes cotações fixas:
USD para BRL: 5.50
EUR para BRL: 6.00
GBP para BRL: 7.00
CNY para BRL: 0.80
Exemplo: " US$ 10 = R$ 55,00"`;
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...prev.filter(m => m && m.role && m.content),
        input ? { role: 'user', content: input } : null,
      ].filter(Boolean);

      const steps = [];
      let assistantMsg = null;
      let attempts = 0;
      while (attempts < 3) {
        attempts++;
        const payload = {
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages,
          tools: toolSchemas.map(t => ({ type: 'function', function: t })),
          tool_choice: 'auto',
          temperature: 0.2,
        };
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)),
        });
        if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}`);
        const data = await r.json();
        const msg = data?.choices?.[0]?.message;
        if (!msg) throw new Error('OpenAI: missing message');
        if (msg.tool_calls && msg.tool_calls.length) {
          // Record assistant msg with tool calls
          messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
          for (const call of msg.tool_calls) {
            const name = call.function?.name;
            let args = {};
            try { args = JSON.parse(call.function?.arguments || '{}'); } catch { }
            let result;
            try {
              if (typeof tools[name] !== 'function') throw new Error('unknown tool');
              const started = Date.now();
              result = await tools[name](args || {});
              steps.push({ name, args, ok: true, ms: Date.now() - started });
            } catch (e) {
              result = { ok: false, error: String(e) };
              steps.push({ name, args, ok: false, error: String(e) });
            }
            messages.push({ role: 'tool', tool_call_id: call.id, name, content: JSON.stringify(result) });
          }
          continue; // loop again with tool results
        }
        assistantMsg = msg;
        break;
      }

      const answer = assistantMsg?.content || '';
      res.json({ ok: true, answer, steps });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });
  router.get('/assistant/health', (req, res) => {
    res.json({ ok: true, hasKey: !!(process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY) });
  });
  // App Auth (register/login/me)
  router.post('/auth/register', (req, res) => {
    try {
      const { email, password, powerstation_id } = req.body || {};
      if (!email || !password || !powerstation_id) return res.status(400).json({ ok: false, error: 'email, password, powerstation_id required' });
      // scrypt hash
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(password, salt, 64).toString('hex');
      const password_hash = `scrypt:${salt}:${hash}`;
      const user = dbApi.createUser({ email, password_hash, powerstation_id });
      const token = crypto.randomUUID();
      dbApi.createSession(user.id, token);
      res.json({ ok: true, token, user: { id: user.id, email: user.email, powerstation_id: user.powerstation_id } });
    } catch (e) {
      const msg = String(e).includes('UNIQUE') ? 'email already exists' : String(e);
      res.status(400).json({ ok: false, error: msg });
    }
  });

  router.post('/auth/login', (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ ok: false, error: 'email, password required' });
      const user = dbApi.getUserByEmail(email);
      if (!user) return res.status(401).json({ ok: false, error: 'invalid credentials' });
      const [scheme, salt, hash] = String(user.password_hash || '').split(':');
      if (scheme !== 'scrypt' || !salt || !hash) return res.status(500).json({ ok: false, error: 'invalid password scheme' });
      const verify = crypto.scryptSync(password, salt, 64).toString('hex');
      if (verify !== hash) return res.status(401).json({ ok: false, error: 'invalid credentials' });
      const token = crypto.randomUUID();
      dbApi.createSession(user.id, token);
      res.json({ ok: true, token, user: { id: user.id, email: user.email, powerstation_id: user.powerstation_id } });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  router.get('/auth/me', (req, res) => {
    const user = requireUser(req, res); if (!user) return;
    res.json({ ok: true, user: { id: user.id, email: user.email, powerstation_id: user.powerstation_id } });
  });

  // Change password (requires Bearer token)
  router.post('/auth/change-password', (req, res) => {
    try {
      const user = requireUser(req, res); if (!user) return;

      const { old_password, new_password } = req.body || {};
      if (!old_password || !new_password) return res.status(400).json({ ok: false, error: 'old_password and new_password required' });
      if (String(new_password).length < 6) return res.status(400).json({ ok: false, error: 'new password must be at least 6 characters' });

      const [scheme, salt, hash] = String(user.password_hash || '').split(':');
      if (scheme !== 'scrypt' || !salt || !hash) return res.status(500).json({ ok: false, error: 'invalid password scheme' });
      const verify = crypto.scryptSync(old_password, salt, 64).toString('hex');
      if (verify !== hash) return res.status(401).json({ ok: false, error: 'invalid old password' });

      const newSalt = crypto.randomBytes(16).toString('hex');
      const newHash = crypto.scryptSync(new_password, newSalt, 64).toString('hex');
      const password_hash = `scrypt:${newSalt}:${newHash}`;
      dbApi.updateUserPassword(user.id, password_hash);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // GoodWe API wrappers
  router.post('/auth/crosslogin', async (req, res) => {
    try {
      const auth = await gw.crossLogin();
      res.json({ ok: true, auth: { api_base: auth.api_base, uid: auth.uid, timestamp: auth.timestamp } });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Raw CrossLogin response (exactly as SEMS returns)
  router.post('/auth/crosslogin/raw', async (req, res) => {
    try {
      const ver = (req.query.ver || req.body?.ver || 'auto');
      const raw = await gw.crossLoginRaw({ version: String(ver) });
      res.json(raw);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // QueryPowerStationMonitor (JSON)
  router.get('/monitor', async (req, res) => {
    const body = {
      powerstation_id: getPsId(req),
      key: req.query.key || '',
      orderby: req.query.orderby || '',
      powerstation_type: req.query.powerstation_type || '',
      powerstation_status: req.query.powerstation_status || '',
      page_index: Number(req.query.page_index || 1),
      page_size: Number(req.query.page_size || 14),
      adcode: req.query.adcode || '',
      org_id: req.query.org_id || '',
      condition: req.query.condition || '',
    };
    try {
      const j = await gw.postJson('PowerStationMonitor/QueryPowerStationMonitor', body);
      res.json(j);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // GetInverterAllPoint (form)
  router.get('/inverters', async (req, res) => {
    const psId = getPsId(req);
    try {
      const j = await gw.postForm('v3/PowerStation/GetInverterAllPoint', { powerStationId: psId });
      res.json(j);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Absolute monitor (for debugging ports 82/85 provided by components.api)
  router.get('/monitor-abs', async (req, res) => {
    const url = req.query.url;
    const powerstation_id = req.query.powerstation_id || req.query.pw_id || '';
    if (!url) return res.status(400).json({ ok: false, error: 'url is required' });
    try {
      const j = await gw.postAbsoluteJson(url, {
        powerstation_id,
        key: req.query.key || '',
        orderby: req.query.orderby || '',
        powerstation_type: req.query.powerstation_type || '',
        powerstation_status: req.query.powerstation_status || '',
        page_index: Number(req.query.page_index || 1),
        page_size: Number(req.query.page_size || 14),
        adcode: req.query.adcode || '',
        org_id: req.query.org_id || '',
        condition: req.query.condition || '',
      });
      res.json(j);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // GetWeather (form)
  router.get('/weather', async (req, res) => {
    const psId = getPsId(req);
    try {
      const j = await gw.postForm('v3/PowerStation/GetWeather', { powerStationId: psId });
      res.json(j);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Powerflow (JSON)
  router.get('/powerflow', async (req, res) => {
    const psId = getPsId(req);
    try {
      const j = await gw.postJson('v2/PowerStation/GetPowerflow', { PowerStationId: psId });
      res.json(j);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // EV Chargers - count by PowerStation (JSON)
  router.get('/evchargers/count', async (req, res) => {
    const psId = getPsId(req);
    try {
      const j = await gw.postJson('v4/EvCharger/GetEvChargerCountByPwId', { PowerStationId: psId });
      res.json(j);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Charts/GetChartByPlant (JSON) -> agregados rápidos (dia/semana/mês/ano)
  router.get('/chart-by-plant', async (req, res) => {
    const user = tryGetUser(req);
    const id = req.query.id || req.query.plant_id || user?.powerstation_id || '';
    const date = req.query.date || '';
    const range = req.query.range || '2'; // 1: day/rolling? 2: month, 4: year (observado)
    const chartIndexId = req.query.chartIndexId || '8'; // energy statistics
    try {
      const body = { id, date, range: Number(range), chartIndexId: String(chartIndexId), isDetailFull: false };
      const j = await gw.postJson('v2/Charts/GetChartByPlant', body);
      res.json(j);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // GetPlantDetailByPowerstationId (form) -> total_income, currency, KPIs
  router.get('/plant-detail', async (req, res) => {
    const psId = getPsId(req);
    try {
      const j = await gw.postForm('v3/PowerStation/GetPlantDetailByPowerstationId', { powerStationId: psId });
      res.json(j);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // GetPlantPowerChart (JSON) — support day/week/month aggregation client-side later if needed
  router.get('/power-chart', async (req, res) => {
    const user = tryGetUser(req);
    const id = req.query.plant_id || req.query.id || user?.powerstation_id || '';
    const date = req.query.date || '';
    const full_script = String(req.query.full_script || 'true') === 'true';
    const payload = { id, date, full_script };
    try {
      const j = await gw.postJson('v2/Charts/GetPlantPowerChart', payload);
      res.json(j);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // PowerstationWarningsQuery (form) -> alerts per inverter
  router.get('/warnings', async (req, res) => {
    const pwId = getPsId(req);
    try {
      // Try region-aware first
      let j = await gw.postForm('warning/PowerstationWarningsQuery', { pw_id: pwId });
      if (String(j?.code) !== '0') {
        // Fallback to absolute EU/US as some accounts resolve warnings in different hosts
        try { j = await gw.postAbsoluteForm('https://eu.semsportal.com/api/warning/PowerstationWarningsQuery', { pw_id: pwId }); } catch { }
        if (String(j?.code) !== '0') {
          j = await gw.postAbsoluteForm('https://us.semsportal.com/api/warning/PowerstationWarningsQuery', { pw_id: pwId });
        }
      }
      res.json(j);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // -------- Assistant utility endpoints --------
  router.get('/assistant/tools', (req, res) => {
    try {
      const items = [
        { name: 'get_income_today', description: 'Retorna a renda agregada de hoje.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_total_income', description: 'Retorna a renda total acumulada da planta.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_generation', description: 'Retorna a geração para um intervalo padrão.', parameters: { type: 'object', properties: { range: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month', 'total'] } }, required: ['range'], additionalProperties: false } },
        { name: 'get_monitor', description: 'QueryPowerStationMonitor', parameters: { type: 'object', properties: { page_index: { type: 'number' }, page_size: { type: 'number' }, key: { type: 'string' }, orderby: { type: 'string' }, powerstation_type: { type: 'string' }, powerstation_status: { type: 'string' }, adcode: { type: 'string' }, org_id: { type: 'string' }, condition: { type: 'string' } }, additionalProperties: false } },
        { name: 'get_inverters', description: 'GetInverterAllPoint', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_weather', description: 'GetWeather', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_powerflow', description: 'GetPowerflow', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_evcharger_count', description: 'GetEvChargerCountByPwId', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_plant_detail', description: 'GetPlantDetailByPowerstationId', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_chart_by_plant', description: 'Charts/GetChartByPlant', parameters: { type: 'object', properties: { date: { type: 'string' }, range: { type: 'number' }, chartIndexId: { type: 'string' }, isDetailFull: { type: 'boolean' } }, additionalProperties: false } },
        { name: 'get_power_chart', description: 'Charts/GetPlantPowerChart', parameters: { type: 'object', properties: { date: { type: 'string' }, full_script: { type: 'boolean' } }, additionalProperties: false } },
        { name: 'get_warnings', description: 'warning/PowerstationWarningsQuery', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'list_powerstations', description: 'Lista powerstations locais', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'set_powerstation_name', description: 'Define nome comercial local para powerstation', parameters: { type: 'object', properties: { id: { type: 'string' }, name: { type: ['string', 'null'] } }, required: ['id'], additionalProperties: false } },
        { name: 'debug_auth', description: 'Info de autenticação GoodWe no servidor (token/cookies mascarados)', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'cross_login', description: 'Executa CrossLogin GoodWe', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'cross_login_raw', description: 'Retorna JSON cru do CrossLogin SEMS', parameters: { type: 'object', properties: { version: { type: 'string' } }, additionalProperties: false } },
      ];
      res.json({ items });
    } catch (e) { res.status(500).json({ ok:false, error:String(e) }) }
  });

  router.get('/assistant/help', (req, res) => {
    const SYSTEM_PROMPT = `Você é o Assistente Virtual deste painel. Regras:
1) Use ferramentas para dados reais (renda, geração, métricas, status).
2) Não invente valores; se faltar permissão, peça login/conexão.
3) Métricas: cite só o período (Hoje/Ontem/Esta Semana/Este Mês/Total).
4) Seja curto e prático; use listas quando ajudar.
5) Idioma: pt-BR; não exponha segredos.`;
    res.json({ system_prompt: SYSTEM_PROMPT });
  });

  router.get('/assistant/ping', (req, res) => {
    const auth = gw.auth || null;
    res.json({ ok:true, hasAuth: !!auth, api_base: auth?.api_base || null, ts: Date.now() });
  });

  return router;
}
