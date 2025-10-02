import { getDbEngine } from '../db.js';

function parseWindow(q){
  const m = String(q||'').trim();
  if (!m) return 60; // minutes
  const num = parseFloat(m);
  if (isNaN(num)) return 60;
  if (m.toLowerCase().includes('h')) return Math.max(1, Math.round(num*60));
  if (m.toLowerCase().includes('d')) return Math.max(1, Math.round(num*60*24));
  return Math.max(1, Math.round(num));
}

export function registerIoTRoutes(router, { helpers }){
  const { requireUser } = helpers;
  const engine = getDbEngine();

  async function fetchDeviceRows({ vendor, device_id, since, until }){
    if (engine.type === 'pg'){
      const prev = await engine.pgPool.query(
        'SELECT vendor, device_id, name, room, ts, state_on, power_w, energy_wh FROM device_history WHERE vendor=$1 AND device_id=$2 AND ts < $3 ORDER BY ts DESC LIMIT 1',
        [vendor, device_id, since]
      ).then(r=> r.rows);
      const cur = await engine.pgPool.query(
        'SELECT vendor, device_id, name, room, ts, state_on, power_w, energy_wh FROM device_history WHERE vendor=$1 AND device_id=$2 AND ts >= $3 AND ts <= $4 ORDER BY ts ASC',
        [vendor, device_id, since, until]
      ).then(r=> r.rows);
      return { prev: prev[0] || null, rows: cur };
    } else {
      const prev = engine.sqliteDb.prepare(
        'SELECT vendor, device_id, name, room, ts, state_on, power_w, energy_wh FROM device_history WHERE vendor=? AND device_id=? AND ts < ? ORDER BY ts DESC LIMIT 1'
      ).get(vendor, device_id, new Date(since).toISOString());
      const cur = engine.sqliteDb.prepare(
        'SELECT vendor, device_id, name, room, ts, state_on, power_w, energy_wh FROM device_history WHERE vendor=? AND device_id=? AND ts >= ? AND ts <= ? ORDER BY ts ASC'
      ).all(vendor, device_id, new Date(since).toISOString(), new Date(until).toISOString());
      return { prev: prev || null, rows: cur };
    }
  }

  router.get('/iot/device/:vendor/:id/uptime', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const vendor = String(req.params.vendor || '').toLowerCase();
      const device_id = String(req.params.id || '');
      const minutes = parseWindow(req.query.window || req.query.minutes || '60');
      const until = new Date();
      const since = new Date(until.getTime() - minutes*60*1000);

      const { prev, rows } = await fetchDeviceRows({ vendor, device_id, since, until });
      const seq = [];
      if (prev) seq.push(prev);
      for (const r of rows) seq.push(r);
      // Normalize time values
      const norm = (r)=> ({ ts: new Date(r.ts), on: (r.state_on===true || r.state_on===1), power_w: (r.power_w!=null? Number(r.power_w): null), name: r.name||'', room: r.room||'' });
      const samples = seq.map(norm).sort((a,b)=> a.ts - b.ts);
      // If no sample, return zero
      if (!samples.length){
        return res.json({ ok:true, vendor, device_id, since: since.toISOString(), until: until.toISOString(), total_on_minutes: 0, intervals: [], on_now: null });
      }
      // Ensure first sample at >= since
      if (samples[0].ts < since){ samples[0].ts = since; }
      const intervals = [];
      let totalOnMs = 0;
      for (let i=0; i<samples.length; i++){
        const cur = samples[i];
        const t0 = cur.ts;
        const t1 = (i+1 < samples.length) ? samples[i+1].ts : until;
        const a = t0 < since ? since : t0;
        const b = t1 > until ? until : t1;
        if (b <= a) continue;
        const ms = b - a;
        if (cur.on){ totalOnMs += ms; intervals.push({ from: a.toISOString(), to: b.toISOString(), minutes: +(ms/60000).toFixed(2) }); }
      }
      const on_now = samples.length ? samples[samples.length-1].on : null;
      res.json({ ok:true, vendor, device_id, since: since.toISOString(), until: until.toISOString(), total_on_minutes: +(totalOnMs/60000).toFixed(2), intervals, on_now });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  router.get('/iot/top-consumers', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const minutes = parseWindow(req.query.window || req.query.minutes || '60');
      const since = new Date(Date.now() - minutes*60*1000);
      let rows = [];
      if (engine.type === 'pg'){
        // latest sample per device since window
        const sql = `
          SELECT DISTINCT ON (vendor, device_id) vendor, device_id, name, room, ts, state_on, power_w
          FROM device_history
          WHERE ts >= $1
          ORDER BY vendor, device_id, ts DESC`;
        rows = await engine.pgPool.query(sql, [since]).then(r=> r.rows);
      } else {
        const all = engine.sqliteDb.prepare('SELECT vendor, device_id, name, room, ts, state_on, power_w FROM device_history WHERE ts >= ? ORDER BY vendor, device_id, ts ASC').all(since.toISOString());
        const map = new Map();
        for (const r of all){ const key = r.vendor+'|'+r.device_id; map.set(key, r); }
        rows = Array.from(map.values());
      }
      const items = rows.map(r=> ({ vendor: r.vendor, device_id: r.device_id, name: r.name||'', room: r.room||'', on: (r.state_on===true || r.state_on===1), power_w: (r.power_w!=null? Number(r.power_w): null), ts: new Date(r.ts).toISOString() }))
        .filter(d=> d.power_w!=null)
        .sort((a,b)=> (b.power_w||0)-(a.power_w||0))
        .slice(0, 10);
      res.json({ ok:true, window_minutes: minutes, items });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });
}

