// Lightweight learning engine for Adaptive Routines (JS with JSDoc types)
// Keeps compatibility with current Node/Express ESM setup. No breaking changes.

import fs from 'node:fs';
import path from 'node:path';
import { getDbEngine } from '../db.js';

const LOG_DIR = path.resolve(process.cwd(), 'src', 'logs');
const ADAPTIVE_LOG = path.join(LOG_DIR, 'adaptive.log');
fs.mkdirSync(LOG_DIR, { recursive: true });

function logAdaptive(evt) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...evt }) + '\n';
    fs.appendFileSync(ADAPTIVE_LOG, line, 'utf-8');
  } catch {}
}

/**
 * Integrates a power series (kW) over time into kWh
 * rows = { prev, list }, fields selected by pick(r)
 */
function integrateSeries(rows, start, end, pick) {
  const pts = [];
  const s = new Date(start), e = new Date(end);
  if (rows.prev) pts.push({ ts: s, val: pick(rows.prev) || 0 });
  for (const r of (rows.list || rows.rows || [])) {
    const ts = new Date(r.ts || r.timestamp);
    if (!(ts instanceof Date) || Number.isNaN(+ts)) continue;
    if (ts < s) continue;
    if (ts > e) break;
    pts.push({ ts, val: pick(r) || 0 });
  }
  if ((rows.list && rows.list.length) || (rows.rows && rows.rows.length)) {
    const last = (rows.list ? rows.list[rows.list.length - 1] : rows.rows[rows.rows.length - 1]);
    const lastVal = pick(last) || 0;
    pts.push({ ts: e, val: lastVal });
  } else if (!pts.length) {
    pts.push({ ts: s, val: 0 });
    pts.push({ ts: e, val: 0 });
  }
  let kwh = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dtH = Math.max(0, (b.ts - a.ts) / 3600000);
    kwh += (a.val || 0) * dtH;
  }
  return kwh;
}

function parseSchedule(sched) {
  try {
    const days = Array.isArray(sched?.days) ? sched.days.map(Number) : [0,1,2,3,4,5,6];
    const [sh, sm] = String(sched?.start || '00:00').split(':').map(n => Number(n || 0));
    const [eh, em] = String(sched?.end || '23:59').split(':').map(n => Number(n || 0));
    return { days, startH: sh || 0, startM: sm || 0, endH: eh || 23, endM: em || 59 };
  } catch {
    return { days:[0,1,2,3,4,5,6], startH:0, startM:0, endH:23, endM:59 };
  }
}

function dayWindow(date, sch) {
  const d = new Date(date); d.setSeconds(0,0);
  const start = new Date(d); start.setHours(sch.startH, sch.startM, 0, 0);
  const end = new Date(d); end.setHours(sch.endH, sch.endM, 59, 999);
  return { start, end };
}

async function fetchGridRows(plant_id, start, end) {
  const eng = getDbEngine();
  if (eng.type === 'pg') {
    const prev = await eng.pgPool
      .query('SELECT timestamp, import_kw, export_kw FROM grid_history WHERE plant_id=$1 AND timestamp < $2 ORDER BY timestamp DESC LIMIT 1', [plant_id, start])
      .then(r => r.rows[0] || null).catch(() => null);
    const list = await eng.pgPool
      .query('SELECT timestamp, import_kw, export_kw FROM grid_history WHERE plant_id=$1 AND timestamp >= $2 AND timestamp <= $3 ORDER BY timestamp ASC', [plant_id, start, end])
      .then(r => r.rows).catch(() => []);
    return { prev, list };
  } else {
    const prev = eng.sqliteDb
      .prepare('SELECT timestamp, import_kw, export_kw FROM grid_history WHERE plant_id=? AND timestamp < ? ORDER BY timestamp DESC LIMIT 1')
      .get(plant_id, new Date(start).toISOString()) || null;
    const list = eng.sqliteDb
      .prepare('SELECT timestamp, import_kw, export_kw FROM grid_history WHERE plant_id=? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC')
      .all(plant_id, new Date(start).toISOString(), new Date(end).toISOString());
    return { prev, list };
  }
}

async function latestTopConsumers(minutes = 60) {
  const eng = getDbEngine();
  const since = new Date(Date.now() - minutes * 60 * 1000);
  if (eng.type === 'pg') {
    const sql = `SELECT DISTINCT ON (vendor, device_id) vendor, device_id, name, room, ts, state_on, power_w
                 FROM device_history WHERE ts >= $1 ORDER BY vendor, device_id, ts DESC`;
    return eng.pgPool.query(sql, [since]).then(r => r.rows).catch(() => []);
  } else {
    const all = eng.sqliteDb
      .prepare('SELECT vendor, device_id, name, room, ts, state_on, power_w FROM device_history WHERE ts >= ? ORDER BY vendor, device_id, ts ASC')
      .all(since.toISOString());
    const map = new Map();
    for (const r of all) { const key = r.vendor + '|' + r.device_id; map.set(key, r); }
    return Array.from(map.values());
  }
}

function get(obj, pathStr) {
  try {
    const parts = String(pathStr).replace(/\[(\d+)\]/g, '.$1').split('.');
    let cur = obj; for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
    return cur;
  } catch { return undefined; }
}
function set(obj, pathStr, val) {
  const parts = String(pathStr).replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]; if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = val;
}

export async function evaluateRoutine(routine, store, windows) {
  // Evaluate savings by comparing last N days vs previous N days during routine schedule window
  const N = Number(windows?.days || 7);
  const sched = parseSchedule(routine?.schedule || routine?.learning?.schedule || {});
  const plant_id = routine?.plant_id || store?.plant_id || null;
  if (!plant_id) return { ok: false, error: 'plant_id required' };

  const today = new Date(); today.setHours(0,0,0,0);
  async function sumWindow(startDayOffset) {
    let kwh = 0; let days = 0;
    for (let i = 0; i < N; i++) {
      const d = new Date(today.getTime() - (startDayOffset + i) * 86400000);
      const dow = d.getDay();
      if (!sched.days.includes(dow)) continue;
      const { start, end } = dayWindow(d, sched);
      const rows = await fetchGridRows(plant_id, start, end);
      const impKWh = integrateSeries(rows, start, end, (r) => Number(r.import_kw || 0));
      kwh += impKWh; days++;
    }
    return { kwh, days };
  }
  // Execute sequentially to keep code simple
  const cur = await sumWindow(0);
  const prev = await sumWindow(N);
  const avgCur = cur.days ? cur.kwh / cur.days : null;
  const avgPrev = prev.days ? prev.kwh / prev.days : null;
  const savings_pct = (avgPrev && avgCur != null) ? ((avgPrev - avgCur) / (avgPrev || 1)) * 100 : null;
  const savings_wh = (avgPrev && avgCur != null) ? Math.round((avgPrev - avgCur) * 1000) : null;

  // Discomfort proxy: user-provided overrides in store or 0
  const overrides = Number(store?.get?.('overrides:' + (routine?.id || '')) || 0);
  const comfort_penalty = Math.min(1, overrides / Math.max(1, cur.days));

  const out = { ok: true, savings_pct, savings_wh, days_cur: cur.days, days_prev: prev.days, comfort_penalty };
  logAdaptive({ type: 'adaptive-train', routine_id: routine?.id || null, details: out });
  return out;
}

export async function simulateRoutine(routine, dataSources = {}, opts = {}) {
  // Estimate potential savings by summing low/medium priority consumers for the scheduled window
  const sched = parseSchedule(routine?.schedule || {});
  const durationH = ((sched.endH * 60 + sched.endM) - (sched.startH * 60 + sched.startM)) / 60;
  const eng = getDbEngine();
  let consumers = [];
  if (Array.isArray(dataSources?.devices) && dataSources.devices.length) {
    consumers = dataSources.devices;
  } else {
    consumers = await latestTopConsumers(90);
  }
  // Meta map (priority/essential) is optional
  let metaMap = {};
  try {
    const user_id = opts?.user_id || null;
    if (user_id && getDbEngine) {
      // reuse db util if available via dynamic import
      const { getDeviceMetaMap } = await import('../db.js');
      metaMap = await getDeviceMetaMap(user_id);
    }
  } catch {}
  function prioOf(vendor, id) {
    const m = metaMap[`${vendor}|${id}`];
    return m?.priority || 1;
  }
  function isEssential(vendor, id, name) {
    const m = metaMap[`${vendor}|${id}`];
    const nm = String(name || '').toLowerCase();
    return (m?.essential === true) || ['geladeira','fridge','refrigerador','freezer'].some(x => nm.includes(x));
  }
  const targetPriorities = new Set([1,2]); // low/medium controllable windows
  const affected = consumers.filter(d => targetPriorities.has(prioOf(d.vendor, d.device_id || d.id)) && !isEssential(d.vendor, d.device_id || d.id, d.name));
  const totalW = affected.reduce((acc, d) => acc + (Number(d.power_w) || 0), 0);
  const est_kwh = (totalW / 1000) * Math.max(0, durationH);

  // Baseline: grid import in recent similar windows (best-effort)
  const plant_id = routine?.plant_id || opts?.plant_id || null;
  let baseline_kwh = null;
  if (plant_id) {
    const { start, end } = dayWindow(new Date(), sched);
    const rows = await fetchGridRows(plant_id, start, end);
    baseline_kwh = integrateSeries(rows, start, end, (r) => Number(r.import_kw || 0));
  }
  const predicted_savings_pct = baseline_kwh ? Math.max(0, Math.min(100, (est_kwh / (baseline_kwh || 1)) * 100)) : null;
  const res = { ok: true, predicted_savings_kwh: +est_kwh.toFixed(3), predicted_savings_pct, baseline_kwh };
  logAdaptive({ type: 'simulate', routine_id: routine?.id || null, details: res });
  return res;
}

export function mutateRoutine(routine, k = 3, policy = null) {
  const r = JSON.parse(JSON.stringify(routine || {}));
  const learning = r.learning || {};
  const mut = learning.mutation || policy || {};
  const fields = Array.isArray(mut.fields) ? mut.fields : [];
  const stepPct = Number(mut.step_pct || 0.1);
  const bounds = mut.bounds || {};
  const variants = [];

  function clampField(pathStr, val) {
    // Support a couple of named bounds
    if (pathStr.includes('power') && bounds.power_gte) {
      const [lo, hi] = bounds.power_gte.map(Number);
      return Math.max(lo, Math.min(hi, val));
    }
    if (pathStr.includes('delta') && bounds.delta_temp_c) {
      const [lo, hi] = bounds.delta_temp_c.map(Number);
      return Math.max(lo, Math.min(hi, val));
    }
    return val;
  }

  for (let i = 0; i < Math.max(1, k); i++) {
    const copy = JSON.parse(JSON.stringify(r));
    for (const f of fields) {
      const cur = Number(get(copy, f));
      if (!Number.isFinite(cur)) continue;
      const delta = cur * stepPct * (Math.random() < 0.5 ? -1 : 1);
      const next = clampField(f, +(cur + delta).toFixed(2));
      set(copy, f, next);
    }
    variants.push(copy);
  }
  logAdaptive({ type: 'mutate', routine_id: routine?.id || null, details: { variants: variants.length } });
  return variants;
}

// Minimal in-memory bandit store if none is provided
class MemoryBanditStore {
  constructor() { this.m = new Map(); }
  get(key) { return this.m.get(key); }
  set(key, val) { this.m.set(key, val); }
}

export function banditTick(experiment, store) {
  const st = store || new MemoryBanditStore();
  const key = 'bandit:' + (experiment?.id || 'default');
  const state = st.get(key) || { variants: {} };
  const vs = experiment?.variants || [];

  // Thompson Sampling with Beta priors (success = improvement, failure = regression)
  let best = null; let bestScore = -Infinity;
  for (let i = 0; i < vs.length; i++) {
    const id = String(i);
    const rec = state.variants[id] || { a: 1, b: 1 }; // Beta(a,b)
    const sample = betaSample(rec.a, rec.b);
    if (sample > bestScore) { bestScore = sample; best = { index: i, rec }; }
  }
  st.set(key, state);
  return { selected: best?.index ?? 0 };
}

function betaSample(a, b) {
  // Quick-and-dirty Beta sampling via Gamma using Marsaglia-Tsang for k>1 approximation
  // For simplicity and determinism-lite, fallback to a/(a+b) when not feasible
  if (!(a > 0 && b > 0)) return 0.5;
  try {
    const x = gammaSample(a); const y = gammaSample(b);
    return x / (x + y);
  } catch { return a / (a + b); }
}
function gammaSample(k) {
  // Only a basic approximation for k>=1
  if (k < 1) k = 1 + k; // rough boost
  const d = k - 1/3; const c = 1 / Math.sqrt(9*d);
  while (true) {
    let x, v;
    do { x = normal01(); v = 1 + c * x; } while (v <= 0);
    v = v*v*v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x*x) * (x*x)) return d * v;
    if (Math.log(u) < 0.5 * x*x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function normal01() {
  // Box-Muller
  const u = Math.random() || 1e-6; const v = Math.random() || 1e-6;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export default {
  evaluateRoutine,
  simulateRoutine,
  mutateRoutine,
  banditTick,
};
