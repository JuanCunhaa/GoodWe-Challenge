import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

export function registerTtsRoutes(router, { helpers }) {
  const { resolveEnvPath } = helpers;

  const TTS_CACHE_MAX = Math.max(0, Number(process.env.TTS_CACHE_MAX || 100));
  const TTS_CACHE_TTL_MS = Math.max(0, Number(process.env.TTS_CACHE_TTL_MS || 24 * 60 * 60 * 1000));
  const ttsCache = new Map();
  const inflight = new Map();
  const TTS_MAX_CONCURRENT = Math.max(1, Number(process.env.TTS_MAX_CONCURRENT || 1));
  let activeSlots = 0;
  const waiters = [];
  function acquireSlot() { return new Promise((resolve) => { const tryAcquire = () => { if (activeSlots < TTS_MAX_CONCURRENT) { activeSlots++; resolve(); } else waiters.push(tryAcquire); }; tryAcquire(); }); }
  function releaseSlot() { activeSlots = Math.max(0, activeSlots - 1); const next = waiters.shift(); if (next) next(); }
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
  function cacheGet(key) { if (!TTS_CACHE_MAX) return null; const it = ttsCache.get(key); if (!it) return null; if (Date.now() >= it.exp) { ttsCache.delete(key); return null; } return it.buf; }
  function cacheSet(key, buf) { if (!TTS_CACHE_MAX || !buf) return; ttsCache.set(key, { buf, exp: Date.now() + TTS_CACHE_TTL_MS }); if (ttsCache.size > TTS_CACHE_MAX) { const firstKey = ttsCache.keys().next().value; if (firstKey) ttsCache.delete(firstKey); } }

  router.all('/tts', async (req, res) => {
    const raw = req.method === 'GET' ? String(req.query?.text || '') : String(req.body?.text || '');
    const text = (raw && typeof raw.normalize === 'function') ? raw.normalize('NFC').trim() : String(raw).trim();
    if (!text) return res.status(400).json({ ok: false, error: 'text is required' });

    const key = cacheKey(text);
    const cached = cacheGet(key);
    if (cached) { res.setHeader('Content-Type', 'audio/wav'); res.setHeader('Cache-Control', 'no-store'); return res.send(cached); }
    if (inflight.has(key)) {
      try { const buf = await inflight.get(key); res.setHeader('Content-Type', 'audio/wav'); res.setHeader('Cache-Control', 'no-store'); return res.send(buf); }
      catch (e) { return res.status(500).json({ ok: false, error: String(e) }); }
    }

    const PIPER_PATH = resolveEnvPath('PIPER_PATH') || '';
    const PIPER_VOICE = resolveEnvPath('PIPER_VOICE') || '';
    const PIPER_VOICE_JSON = resolveEnvPath('PIPER_VOICE_JSON') || '';
    const PIPER_SPEAKER = process.env.PIPER_SPEAKER || '';
    const PIPER_LENGTH_SCALE = process.env.PIPER_LENGTH_SCALE || '';
    const PIPER_NOISE_SCALE = process.env.PIPER_NOISE_SCALE || '';
    const PIPER_NOISE_W = process.env.PIPER_NOISE_W || '';

    const canUsePiper = !!(PIPER_PATH && PIPER_VOICE);
    if (canUsePiper) {
      try {
        await fs.access(PIPER_PATH);
        await fs.access(PIPER_VOICE);
        if (PIPER_VOICE_JSON) { await fs.access(PIPER_VOICE_JSON).catch(() => { }); }
      } catch {}
      const outPath = path.join(os.tmpdir(), `tts-${crypto.randomUUID()}.wav`);
      const args = ['-m', PIPER_VOICE, '-f', outPath];
      if (PIPER_VOICE_JSON) { args.push('-c', PIPER_VOICE_JSON); }
      if (PIPER_SPEAKER) { args.push('-s', String(PIPER_SPEAKER)); }
      if (PIPER_LENGTH_SCALE) { args.push('-l', String(PIPER_LENGTH_SCALE)); }
      if (PIPER_NOISE_SCALE) { args.push('-p', String(PIPER_NOISE_SCALE)); }
      if (PIPER_NOISE_W) { args.push('-r', String(PIPER_NOISE_W)); }

      try {
        await acquireSlot();
        await new Promise((resolve, reject) => {
          const piperDir = path.dirname(PIPER_PATH);
          const env = { ...process.env };
          if (process.platform !== 'win32') { env.LD_LIBRARY_PATH = [piperDir, process.env.LD_LIBRARY_PATH || ''].filter(Boolean).join(path.delimiter); }
          const child = spawn(PIPER_PATH, args, { stdio: ['pipe', 'ignore', 'pipe'], env, cwd: piperDir });
          let stderr = '';
          child.stderr.on('data', (d) => { stderr += d.toString(); });
          child.on('error', (e) => { releaseSlot(); reject(e) });
          child.on('close', (code) => { releaseSlot(); if (code === 0) resolve(0); else reject(new Error(`piper exited with code ${code}: ${stderr.slice(0, 500)}`)); });
          try { child.stdin.setDefaultEncoding('utf8'); child.stdin.write(text + "\n"); child.stdin.end(); } catch {}
        });
        let buf = await fs.readFile(outPath).catch(() => null);
        if (!buf) { await new Promise(r => setTimeout(r, 50)); buf = await fs.readFile(outPath).catch(() => null); }
        try { await fs.unlink(outPath).catch(() => { }); } catch {}
        if (!buf) return res.status(500).json({ ok: false, error: 'piper: missing output file' });
        res.setHeader('Content-Type', 'audio/wav'); res.setHeader('Cache-Control', 'no-store');
        return res.send(buf);
      } catch {}
    }

    const TTS_URL = process.env.PIPER_HTTP_URL || process.env.TTS_SERVER_URL || '';
    if (TTS_URL) {
      try {
        const p = (async () => {
          const r = await fetch(TTS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(Number(process.env.TTS_TIMEOUT_MS || 60000)) });
          const buf = Buffer.from(await r.arrayBuffer());
          if (!r.ok) { const msg = buf.toString('utf8'); throw new Error(`TTS server HTTP ${r.status}: ${msg.slice(0, 200)}`); }
          cacheSet(key, buf); return buf;
        })();
        inflight.set(key, p);
        const buf = await p.finally(() => inflight.delete(key));
        res.setHeader('Content-Type', 'audio/wav'); res.setHeader('Cache-Control', 'no-store');
        return res.send(buf);
      } catch (e) { return res.status(500).json({ ok: false, error: String(e) }); }
    }

    return res.status(501).json({ ok: false, error: 'TTS not configured. Set PIPER_PATH and PIPER_VOICE, or PIPER_HTTP_URL/TTS_SERVER_URL.' });
  });
}

