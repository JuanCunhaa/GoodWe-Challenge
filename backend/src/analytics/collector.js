// Collector that inspects GoodWe route responses and persists normalized history

function parseHM(baseDateStr, hm){
  try { const [h,m] = String(hm).split(':').map(Number); const d = new Date(baseDateStr + 'T00:00:00'); d.setHours(h||0, m||0, 0, 0); return d; } catch { return null }
}

function integrateToIntervals(xy, baseDateStr){
  // Converts a power curve (W at HH:mm) into interval energy samples (kWh) per segment
  const out = [];
  if (!Array.isArray(xy) || xy.length < 2) return out;
  for (let i=1;i<xy.length;i++){
    const a = xy[i-1], b = xy[i];
    const t0 = parseHM(baseDateStr, a.x); const t1 = parseHM(baseDateStr, b.x);
    if (!t0 || !t1) continue;
    const dtH = Math.max(0, (t1 - t0) / 3600000);
    const y = Number(a.y) || 0; // use left value for the slice
    const kwh = (Math.abs(y) * dtH) / 1000;
    out.push({ timestamp: t1.toISOString(), kwh });
  }
  return out;
}

function safeNumber(v, d = null){ const n = Number(v); return Number.isFinite(n) ? n : d; }

export function createGoodWeCollector(repo){
  function firstXY(byKey, keys){
    for (const k of keys){
      const xy = byKey[String(k).toLowerCase()]?.xy;
      if (Array.isArray(xy) && xy.length) return xy;
    }
    return [];
  }
  async function handlePowerChart({ plant_id, date, response }){
    try {
      const lines = response?.data?.lines || [];
      const byKey = Object.fromEntries(lines.map(l => [String(l?.key||'').toLowerCase(), l]));
      const pv = firstXY(byKey, ['pcurve_power_pv','pcurve_power_pvtotal']);
      const load = firstXY(byKey, ['pcurve_power_load','pcurve_power_user','pcurve_power_house','pcurve_power_household']);
      const batt = firstXY(byKey, ['pcurve_power_battery','pcurve_power_batt']);
      const grid = firstXY(byKey, ['pcurve_power_meter','pcurve_power_grid','pcurve_power_pgrid','pcurve_power_pmeter']);
      const soc = firstXY(byKey, ['pcurve_power_soc','pcurve_soc']);

      const genInts = integrateToIntervals(pv, date);
      const loadInts = integrateToIntervals(load, date);
      if (genInts.length) await repo.insertGenerationBatch(genInts.map(s => ({ plant_id, ...s })));
      if (loadInts.length) await repo.insertConsumptionBatch(loadInts.map(s => ({ plant_id, ...s })));

      // Battery SOC series (optional) and power series from chart: write multiple samples across the day
      if (Array.isArray(soc) && soc.length){
        for (const pt of soc){
          const ts = parseHM(date, pt.x);
          const socPct = safeNumber(pt.y);
          if (ts && socPct != null) await repo.insertBatterySample({ plant_id, timestamp: ts, soc: socPct, power_kw: null });
        }
      }
      if (Array.isArray(batt) && batt.length){
        for (const pt of batt){
          const ts = parseHM(date, pt.x);
          const p = safeNumber(pt.y, 0) / 1000; // W -> kW
          if (ts) await repo.insertBatterySample({ plant_id, timestamp: ts, soc: null, power_kw: p });
        }
      }
      // Grid instantaneous (import/export sign by convention: >0 import, <0 export)
      if (Array.isArray(grid) && grid.length){
        for (const pt of grid){
          const ts = parseHM(date, pt.x);
          const w = safeNumber(pt.y, 0);
          if (!ts || !Number.isFinite(w)) continue;
          const power_kw = Math.abs(w)/1000;
          const import_kw = w > 0 ? Math.abs(w)/1000 : 0;
          const export_kw = w < 0 ? Math.abs(w)/1000 : 0;
          await repo.insertGridSample({ plant_id, timestamp: ts, power_kw, import_kw, export_kw });
        }
      }
    } catch (e) {
      console.warn('[collector] handlePowerChart failed:', e?.message || e);
    }
  }

  async function handlePowerflow({ plant_id, response }){
    try {
      const d = response?.data || response?.Data || {};
      const now = new Date();
      const soc = safeNumber(d?.BatterySOC ?? d?.batterySOC ?? d?.soc);
      const battW = safeNumber(d?.BatteryPower ?? d?.batteryPower ?? d?.pbattery) || 0;
      const gridW = safeNumber(d?.GridPower ?? d?.gridPower ?? d?.pmeter) || 0;
      // write battery
      if (soc != null || battW != null) await repo.insertBatterySample({ plant_id, timestamp: now, soc, power_kw: battW!=null ? (battW/1000) : null });
      // write grid
      const power_kw = Math.abs(gridW)/1000; const import_kw = gridW>0?Math.abs(gridW)/1000:0; const export_kw = gridW<0?Math.abs(gridW)/1000:0;
      await repo.insertGridSample({ plant_id, timestamp: now, power_kw, import_kw, export_kw });
    } catch (e) {
      console.warn('[collector] handlePowerflow failed:', e?.message || e);
    }
  }

  return {
    async onResponse(routeName, ctx){
      const plant_id = ctx.plant_id || '';
      if (!plant_id) return;
      if (routeName === 'power-chart') {
        const date = String(ctx?.date || '').slice(0,10) || new Date().toISOString().slice(0,10);
        return handlePowerChart({ plant_id, date, response: ctx.response });
      }
      if (routeName === 'chart-by-plant') {
        const date = String(ctx?.date || '').slice(0,10) || new Date().toISOString().slice(0,10);
        return handlePowerChart({ plant_id, date, response: ctx.response });
      }
      if (routeName === 'powerflow') {
        return handlePowerflow({ plant_id, response: ctx.response });
      }
    }
  };
}
