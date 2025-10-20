import { getDbEngine } from '../db.js';

function toDate(d){ return (d instanceof Date)? d : new Date(String(d)); }

function dayRange(dateStr){
  const start = new Date(String(dateStr)+'T00:00:00');
  const end = new Date(String(dateStr)+'T23:59:59.999');
  return { start, end };
}

function integrateSeries(rows, start, end, pick){
  // rows: sorted by ts asc; pick(row) -> numeric value
  const pts = [];
  const s = toDate(start), e = toDate(end);
  // Seed with previous value at start (if provided as rows.prev)
  if (rows.prev){ pts.push({ ts: s, val: pick(rows.prev) || 0 }); }
  for (const r of rows.list){
    const ts = toDate(r.ts || r.timestamp || r.time);
    if (!Number.isFinite(+ts)) continue;
    if (ts < s) continue;
    if (ts > e) break;
    pts.push({ ts, val: pick(r) || 0 });
  }
  if (rows.list && rows.list.length){
    const last = rows.list[rows.list.length-1];
    const lastVal = pick(last) || 0;
    pts.push({ ts: e, val: lastVal });
  } else if (!pts.length){
    // no samples; assume zero
    pts.push({ ts: s, val: 0 });
    pts.push({ ts: e, val: 0 });
  }
  let wh = 0;
  for (let i=1;i<pts.length;i++){
    const a = pts[i-1], b = pts[i];
    const dtH = Math.max(0, (b.ts - a.ts) / 3600000);
    wh += (a.val || 0) * dtH; // left rectangle integration
  }
  return wh; // in watt-hours if val is W, else kW*hour if val is kW
}

export function registerEnergyRoutes(router, { helpers }){
  const { requireUser } = helpers;

  router.get('/energy/day-aggregates', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const date = String(req.query.date || '').slice(0,10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(422).json({ ok:false, error:'invalid date' });
      const { start, end } = dayRange(date);
      const plant_id = user.powerstation_id;
      const eng = getDbEngine();

      // Generation/Consumption: sum of kWh intervals
      let gen = 0, load = 0;
      if (eng.type === 'pg'){
        const g = await eng.pgPool.query('SELECT COALESCE(SUM(kwh),0) AS s FROM generation_history WHERE plant_id=$1 AND timestamp >= $2 AND timestamp <= $3', [plant_id, start, end]);
        const c = await eng.pgPool.query('SELECT COALESCE(SUM(kwh),0) AS s FROM consumption_history WHERE plant_id=$1 AND timestamp >= $2 AND timestamp <= $3', [plant_id, start, end]);
        gen = Number(g.rows[0]?.s||0); load = Number(c.rows[0]?.s||0);
      } else {
        const g = eng.sqliteDb.prepare('SELECT COALESCE(SUM(kwh),0) AS s FROM generation_history WHERE plant_id=? AND timestamp >= ? AND timestamp <= ?').get(plant_id, start.toISOString(), end.toISOString());
        const c = eng.sqliteDb.prepare('SELECT COALESCE(SUM(kwh),0) AS s FROM consumption_history WHERE plant_id=? AND timestamp >= ? AND timestamp <= ?').get(plant_id, start.toISOString(), end.toISOString());
        gen = Number(g?.s||0); load = Number(c?.s||0);
      }

      // Grid import/export integration from instantaneous samples
      let gridImpKWh = 0, gridExpKWh = 0;
      {
        let list = [];
        let prev = null;
        if (eng.type === 'pg'){
          const pr = await eng.pgPool.query('SELECT timestamp, import_kw, export_kw FROM grid_history WHERE plant_id=$1 AND timestamp < $2 ORDER BY timestamp DESC LIMIT 1', [plant_id, start]);
          prev = pr.rows[0] || null;
          const rr = await eng.pgPool.query('SELECT timestamp, import_kw, export_kw FROM grid_history WHERE plant_id=$1 AND timestamp >= $2 AND timestamp <= $3 ORDER BY timestamp ASC', [plant_id, start, end]);
          list = rr.rows;
        } else {
          prev = eng.sqliteDb.prepare('SELECT timestamp, import_kw, export_kw FROM grid_history WHERE plant_id=? AND timestamp < ? ORDER BY timestamp DESC LIMIT 1').get(plant_id, start.toISOString()) || null;
          list = eng.sqliteDb.prepare('SELECT timestamp, import_kw, export_kw FROM grid_history WHERE plant_id=? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC').all(plant_id, start.toISOString(), end.toISOString());
        }
        const rows = { prev, list };
        const impWh = integrateSeries(rows, start, end, (r)=> Number(r.import_kw||0));
        const expWh = integrateSeries(rows, start, end, (r)=> Number(r.export_kw||0));
        gridImpKWh = +(impWh).toFixed(3); // since import_kw is kW, integrate gives kWh
        gridExpKWh = +(expWh).toFixed(3);
      }

      // Battery charge/discharge energy (approx) from power_kw samples
      let battKWh = 0;
      {
        let list = [];
        let prev = null;
        if (eng.type === 'pg'){
          const pr = await eng.pgPool.query('SELECT timestamp, power_kw FROM battery_history WHERE plant_id=$1 AND timestamp < $2 AND power_kw IS NOT NULL ORDER BY timestamp DESC LIMIT 1', [plant_id, start]);
          prev = pr.rows[0] || null;
          const rr = await eng.pgPool.query('SELECT timestamp, power_kw FROM battery_history WHERE plant_id=$1 AND timestamp >= $2 AND timestamp <= $3 AND power_kw IS NOT NULL ORDER BY timestamp ASC', [plant_id, start, end]);
          list = rr.rows;
        } else {
          prev = eng.sqliteDb.prepare('SELECT timestamp, power_kw FROM battery_history WHERE plant_id=? AND timestamp < ? AND power_kw IS NOT NULL ORDER BY timestamp DESC LIMIT 1').get(plant_id, start.toISOString()) || null;
          list = eng.sqliteDb.prepare('SELECT timestamp, power_kw FROM battery_history WHERE plant_id=? AND timestamp >= ? AND timestamp <= ? AND power_kw IS NOT NULL ORDER BY timestamp ASC').all(plant_id, start.toISOString(), end.toISOString());
        }
        const absWh = integrateSeries({ prev, list }, start, end, (r)=> Math.abs(Number(r.power_kw||0)));
        battKWh = +absWh.toFixed(3);
      }

      const energy = { pv: +gen.toFixed(3), load: +load.toFixed(3), grid: +(gridImpKWh + gridExpKWh).toFixed(3), batt: battKWh, gridExp: gridExpKWh };
      res.json({ ok:true, date, energy });
    } catch (e) {
      res.status(500).json({ ok:false, error: String(e) });
    }
  });

  router.get('/energy/daily-aggregates', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const startStr = String(req.query.start || '').slice(0,10);
      const endStr = String(req.query.end || '').slice(0,10) || startStr;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endStr)) return res.status(422).json({ ok:false, error:'invalid start/end' });
      const startDate = new Date(startStr+'T00:00:00');
      const endDate = new Date(endStr+'T00:00:00');
      if (endDate < startDate) return res.status(422).json({ ok:false, error:'end < start' });
      const plant_id = user.powerstation_id;
      const items = [];
      const days = Math.round((endDate - startDate)/86400000) + 1;
      for (let i=0;i<days;i++){
        const d = new Date(startDate.getTime() + i*86400000);
        const ds = d.toISOString().slice(0,10);
        // reuse day-aggregates logic by calling directly (dup logic for speed)
        const req2 = { query: { date: ds } };
        const res2 = { json: (j)=> j };
        // inline compute instead of invoking HTTP; replicate above minimal
        const { start, end } = dayRange(ds);
        const eng = getDbEngine();
        let gen=0, load=0;
        if (eng.type==='pg'){
          const g = await eng.pgPool.query('SELECT COALESCE(SUM(kwh),0) AS s FROM generation_history WHERE plant_id=$1 AND timestamp >= $2 AND timestamp <= $3', [plant_id, start, end]);
          const c = await eng.pgPool.query('SELECT COALESCE(SUM(kwh),0) AS s FROM consumption_history WHERE plant_id=$1 AND timestamp >= $2 AND timestamp <= $3', [plant_id, start, end]);
          gen = Number(g.rows[0]?.s||0); load = Number(c.rows[0]?.s||0);
        } else {
          const g = eng.sqliteDb.prepare('SELECT COALESCE(SUM(kwh),0) AS s FROM generation_history WHERE plant_id=? AND timestamp >= ? AND timestamp <= ?').get(plant_id, start.toISOString(), end.toISOString());
          const c = eng.sqliteDb.prepare('SELECT COALESCE(SUM(kwh),0) AS s FROM consumption_history WHERE plant_id=? AND timestamp >= ? AND timestamp <= ?').get(plant_id, start.toISOString(), end.toISOString());
          gen = Number(g?.s||0); load = Number(c?.s||0);
        }
        let gridImpKWh=0, gridExpKWh=0;
        {
          let list=[], prev=null; const eng2 = getDbEngine();
          if (eng2.type==='pg'){
            const pr = await eng2.pgPool.query('SELECT timestamp, import_kw, export_kw FROM grid_history WHERE plant_id=$1 AND timestamp < $2 ORDER BY timestamp DESC LIMIT 1', [plant_id, start]);
            prev = pr.rows[0] || null;
            const rr = await eng2.pgPool.query('SELECT timestamp, import_kw, export_kw FROM grid_history WHERE plant_id=$1 AND timestamp >= $2 AND timestamp <= $3 ORDER BY timestamp ASC', [plant_id, start, end]);
            list = rr.rows;
          } else {
            prev = eng2.sqliteDb.prepare('SELECT timestamp, import_kw, export_kw FROM grid_history WHERE plant_id=? AND timestamp < ? ORDER BY timestamp DESC LIMIT 1').get(plant_id, start.toISOString()) || null;
            list = eng2.sqliteDb.prepare('SELECT timestamp, import_kw, export_kw FROM grid_history WHERE plant_id=? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC').all(plant_id, start.toISOString(), end.toISOString());
          }
          const impWh = integrateSeries({ prev, list }, start, end, (r)=> Number(r.import_kw||0));
          const expWh = integrateSeries({ prev, list }, start, end, (r)=> Number(r.export_kw||0));
          gridImpKWh = +(impWh).toFixed(3); gridExpKWh = +(expWh).toFixed(3);
        }
        let battKWh=0; {
          let list=[], prev=null; const eng2 = getDbEngine();
          if (eng2.type==='pg'){
            const pr = await eng2.pgPool.query('SELECT timestamp, power_kw FROM battery_history WHERE plant_id=$1 AND timestamp < $2 AND power_kw IS NOT NULL ORDER BY timestamp DESC LIMIT 1', [plant_id, start]);
            prev = pr.rows[0] || null;
            const rr = await eng2.pgPool.query('SELECT timestamp, power_kw FROM battery_history WHERE plant_id=$1 AND timestamp >= $2 AND timestamp <= $3 AND power_kw IS NOT NULL ORDER BY timestamp ASC', [plant_id, start, end]);
            list = rr.rows;
          } else {
            prev = eng2.sqliteDb.prepare('SELECT timestamp, power_kw FROM battery_history WHERE plant_id=? AND timestamp < ? AND power_kw IS NOT NULL ORDER BY timestamp DESC LIMIT 1').get(plant_id, start.toISOString()) || null;
            list = eng2.sqliteDb.prepare('SELECT timestamp, power_kw FROM battery_history WHERE plant_id=? AND timestamp >= ? AND timestamp <= ? AND power_kw IS NOT NULL ORDER BY timestamp ASC').all(plant_id, start.toISOString(), end.toISOString());
          }
          const absWh = integrateSeries({ prev, list }, start, end, (r)=> Math.abs(Number(r.power_kw||0)));
          battKWh = +absWh.toFixed(3);
        }
        items.push({ date: ds, energy: { pv:+gen.toFixed(3), load:+load.toFixed(3), grid:+(gridImpKWh+gridExpKWh).toFixed(3), batt:battKWh, gridExp:gridExpKWh } });
      }
      res.json({ ok:true, items });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });
}

