// Meta-Routines Engine: discover patterns and propose new composite routines
import fs from 'node:fs';
import path from 'node:path';
import { getDbEngine } from '../db.js';
import { simulateRoutine } from './learningEngine.js';

const LOG_DIR = path.resolve(process.cwd(), 'src', 'logs');
const META_LOG = path.join(LOG_DIR, 'meta.log');
fs.mkdirSync(LOG_DIR, { recursive: true });

function logMeta(evt) {
  try { fs.appendFileSync(META_LOG, JSON.stringify({ ts: new Date().toISOString(), ...evt }) + '\n', 'utf-8'); } catch {}
}

export async function detectCooccurrence(deviceA, deviceB, { minutes = 10, lookbackDays = 30 } = {}) {
  const eng = getDbEngine();
  const since = new Date(Date.now() - lookbackDays * 86400000);
  function norm(r) { return { ts: new Date(r.ts), on: (r.state_on === true || r.state_on === 1) } }

  async function rows(vendor, id) {
    if (eng.type === 'pg') {
      const sql = 'SELECT ts, state_on FROM device_history WHERE vendor=$1 AND device_id=$2 AND ts >= $3 ORDER BY ts ASC';
      return eng.pgPool.query(sql, [vendor, id, since]).then(r => r.rows.map(norm)).catch(() => []);
    } else {
      const sql = 'SELECT ts, state_on FROM device_history WHERE vendor=? AND device_id=? AND ts >= ? ORDER BY ts ASC';
      return eng.sqliteDb.prepare(sql).all(deviceA.vendor, deviceA.id, since.toISOString()).map(norm);
    }
  }
  const a = await rows(deviceA.vendor, deviceA.id);
  const b = await rows(deviceB.vendor, deviceB.id);
  if (!a.length || !b.length) return { corr: 0, pairs: 0 };
  let pairs = 0; let co = 0; const winMs = minutes * 60 * 1000;
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    if (!a[i].on) continue;
    const t0 = a[i].ts.getTime();
    while (j < b.length && b[j].ts.getTime() < t0 - winMs) j++;
    let k = j; let hit = false;
    while (k < b.length && b[k].ts.getTime() <= t0 + winMs) {
      if (b[k].on) { hit = true; break; }
      k++;
    }
    pairs++; if (hit) co++;
  }
  const corr = pairs ? (co / pairs) : 0;
  return { corr, pairs };
}

export async function detectTrends({ plant_id, windowMin = 180 } = {}) {
  if (!plant_id) return { slope: 0, points: 0 };
  const eng = getDbEngine();
  const since = new Date(Date.now() - windowMin * 60 * 1000);
  let rows = [];
  if (eng.type === 'pg') {
    rows = await eng.pgPool.query('SELECT extract(epoch from timestamp) as t, import_kw FROM grid_history WHERE plant_id=$1 AND timestamp >= $2 ORDER BY timestamp ASC', [plant_id, since])
      .then(r => r.rows).catch(() => []);
  } else {
    const all = eng.sqliteDb.prepare('SELECT timestamp as t, import_kw FROM grid_history WHERE plant_id=? AND timestamp >= ? ORDER BY timestamp ASC')
      .all(plant_id, since.toISOString());
    rows = all.map(r => ({ t: new Date(r.t).getTime() / 1000, import_kw: r.import_kw }));
  }
  const xs = []; const ys = [];
  for (const r of rows) { const y = Number(r.import_kw || 0); if (!Number.isFinite(y)) continue; xs.push(Number(r.t)); ys.push(y); }
  if (xs.length < 2) return { slope: 0, points: xs.length };
  const n = xs.length; const sumX = xs.reduce((a,b)=>a+b,0); const sumY = ys.reduce((a,b)=>a+b,0);
  const sumXY = xs.reduce((acc, x, i)=> acc + x*ys[i], 0);
  const sumXX = xs.reduce((acc, x)=> acc + x*x, 0);
  const slope = (n*sumXY - sumX*sumY) / Math.max(1e-6, (n*sumXX - sumX*sumX));
  return { slope, points: n };
}

export async function generateMetaRoutine({ basePattern, plant_id, user_id }) {
  // Build a minimal custom automation-like JSON with learning block
  const now = new Date();
  const name = `Meta: ${basePattern?.name || 'Nova Rotina'}`;
  const routine = {
    name,
    kind: 'custom',
    enabled: false, // start experimental
    schedule: basePattern?.schedule || { days: [1,2,3,4,5], start: '18:00', end: '21:00' },
    actions: basePattern?.actions || { priority: 'low', action: 'off', restore_on: true },
    learning: {
      enabled: true,
      exploration_rate: 0.1,
      mutation: {
        fields: ['then[0].value.delta'],
        bounds: { delta_temp_c: [1, 3] },
        step_pct: 0.15,
      }
    },
    plant_id,
  };
  // Simulate
  const sim = await simulateRoutine(routine, {}, { plant_id, user_id });
  logMeta({ type: 'meta-create', routine_id: null, details: { predicted_savings_pct: sim?.predicted_savings_pct || null } });
  return { routine, simulation: sim };
}

export default {
  detectCooccurrence,
  detectTrends,
  generateMetaRoutine,
};
