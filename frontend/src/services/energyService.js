import { goodweApi } from './goodweApi.js'
import { dayCache } from './dayCache.js'

function parseHM(hm){ try{ const [h,m]=String(hm).split(':').map(Number); return h*60+m }catch{return null} }
function integrateSeries(xy){ if(!xy||xy.length<2) return 0; let kwh=0; for(let i=1;i<xy.length;i++){ const a=xy[i-1], b=xy[i]; const m0=parseHM(a.x), m1=parseHM(b.x); if(m0==null||m1==null) continue; const dtH=Math.max(0,(m1-m0)/60); const y=Number(a.y)||0; kwh+=(y*dtH)/1000; } return kwh; }
function integrateFiltered(xy, predicate){ if(!xy||xy.length<2) return 0; let kwh=0; for(let i=1;i<xy.length;i++){ const a=xy[i-1], b=xy[i]; const m0=parseHM(a.x), m1=parseHM(b.x); if(m0==null||m1==null) continue; const dtH=Math.max(0,(m1-m0)/60); const y=Number(a.y)||0; if(predicate(y)) kwh+=(Math.abs(y)*dtH)/1000; } return kwh; }

async function fetchDayFromAPI(token, plantId, date){
  const r = await goodweApi.powerChartDay(token, plantId, date)
  if(String(r?.code)!=='0') throw new Error(r?.msg||'Falha ao consultar gráfico')
  const lines = r?.data?.lines||[]
  const byKey = Object.fromEntries(lines.map(l=>[l.key, l]))
  const sPV = byKey['PCurve_Power_PV']?.xy||[]
  const sLoad = byKey['PCurve_Power_Load']?.xy||[]
  const sBatt = byKey['PCurve_Power_Battery']?.xy||[]
  const sGrid = byKey['PCurve_Power_Meter']?.xy||[]
  const sSOC  = byKey['PCurve_Power_SOC']?.xy||[]
  const energy = {
    pv:   integrateSeries(sPV),
    load: integrateSeries(sLoad),
    batt: integrateSeries(sBatt.map(p=>({...p,y:Math.abs(Number(p.y)||0)}))),
    grid: integrateSeries(sGrid.map(p=>({...p,y:Math.abs(Number(p.y)||0)}))),
    gridImp: integrateFiltered(sGrid, y=> y>0),
    gridExp: integrateFiltered(sGrid, y=> y<0),
    battDis: integrateFiltered(sBatt, y=> y>0),
    battChg: integrateFiltered(sBatt, y=> y<0)
  }
  return { series: [ {label:'PV',xy:sPV}, {label:'Load',xy:sLoad}, {label:'Grid',xy:sGrid} ], soc: sSOC, energy }
}

export const energyService = {
  async getDayAggregatesCached(token, plantId, date){
    const now = Date.now();
    const todayStr = new Date().toISOString().slice(0,10);
    const ttlMs = Number(import.meta.env.VITE_DAY_CACHE_TTL_MS || 60000);
    const cached = dayCache.getEnergy(plantId, date);
    const isToday = date === todayStr;
    const fresh = cached && (now - (cached._ts || 0) < ttlMs);
    if (cached && !isToday && fresh) return { energy: cached };
    // Prefer DB-backed aggregates for speed
    try {
      const API_BASE = import.meta.env.VITE_API_BASE || '/api';
      const r = await fetch(`${API_BASE}/energy/day-aggregates?date=${encodeURIComponent(date)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(15000)
      });
      const j = await r.json().catch(()=>null);
      if (r.ok && j && j.ok && j.energy){
        dayCache.setEnergy(plantId, date, j.energy);
        return { energy: j.energy };
      }
    } catch {}
    // Fallback to GoodWe API if DB not available
    const { energy } = await fetchDayFromAPI(token, plantId, date);
    dayCache.setEnergy(plantId, date, energy);
    return { energy };
  },
  async getDayCurvesCached(token, plantId, date){
    const now = Date.now();
    const todayStr = new Date().toISOString().slice(0,10);
    const ttlMs = Number(import.meta.env.VITE_DAY_CACHE_TTL_MS || 60000);
    const c = dayCache.getCurve(plantId, date);
    const e = dayCache.getEnergy(plantId, date) || {};
    const isToday = date === todayStr;
    const freshCurve = c && (now - (c._ts || 0) < ttlMs);
    const freshEnergy = e && (now - (e._ts || 0) < ttlMs);
    if (c && !isToday && freshCurve && freshEnergy){
      return { series: c.series, soc: c.soc, energy: e };
    }
    const data = await fetchDayFromAPI(token, plantId, date);
    dayCache.setCurve(plantId, date, { series: data.series, soc: data.soc });
    dayCache.setEnergy(plantId, date, data.energy);
    return data;
  },
  async backfillDays({ token, plantId, days = 365, onProgress }){
    const today = new Date();
    let completed = 0; const total = Math.max(1, Number(days||0));
    for (let i=1; i<=total; i++){
      const d = new Date(today); d.setDate(today.getDate()-i); const ds = d.toISOString().slice(0,10)
      if (!dayCache.getEnergy(plantId, ds)){
        try{ const { energy } = await fetchDayFromAPI(token, plantId, ds); dayCache.setEnergy(plantId, ds, energy) }catch{}
        await new Promise(r=> setTimeout(r, Number(import.meta.env.VITE_BACKFILL_DELAY_MS||200)))
      }
      completed++;
      if (typeof onProgress==='function'){
        try{ onProgress({ completed, total, date: ds }) }catch{}
      }
    }
    return { completed, total }
  }
}

// ---------- Seeding + Incremental Maintenance ----------
function toDateStr(d){
  const dt = (d instanceof Date) ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,'0');
  const day = String(dt.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function addDays(dateStr, n){ const dt = new Date(dateStr+'T00:00:00'); dt.setDate(dt.getDate()+n); return toDateStr(dt); }

energyService.getBackfillMeta = (plantId) => {
  return dayCache.getMeta(plantId) || {};
};

energyService.ensureSeeded = async ({ token, plantId }) => {
  let meta = dayCache.getMeta(plantId) || {};
  if (meta.seeded) return meta;
  const seedDays = Number(import.meta.env.VITE_BACKFILL_SEED_DAYS || import.meta.env.VITE_BACKFILL_DAYS || 365);
  const today = new Date();
  const yesterday = toDateStr(new Date(today.getFullYear(), today.getMonth(), today.getDate()-1));
  const rangeStart = toDateStr(new Date(today.getFullYear(), today.getMonth(), today.getDate()-seedDays));
  await energyService.backfillDays({ token, plantId, days: seedDays });
  meta = { seeded: true, rangeStart, rangeEnd: yesterday, lastUpdatedAt: new Date().toISOString() };
  dayCache.setMeta(plantId, meta);
  return meta;
};

energyService.incrementalUpdate = async ({ token, plantId }) => {
  const auto = String(import.meta.env.VITE_AUTO_INCREMENTAL || 'true') === 'true';
  if (!auto) return { completed: 0 };
  const meta = dayCache.getMeta(plantId) || {};
  if (!meta.seeded || !meta.rangeEnd) return { completed: 0 };
  const today = toDateStr(new Date());
  const yesterday = addDays(today, -1);
  let cur = addDays(meta.rangeEnd, 1);
  if (cur > yesterday) return { completed: 0 };
  const limit = Number(import.meta.env.VITE_INCREMENTAL_MAX_DAYS || 7);
  let completed = 0;
  for (let i=0; i<limit && cur <= yesterday; i++){
    try{ await energyService.getDayAggregatesCached(token, plantId, cur); }catch{}
    completed++;
    meta.rangeEnd = cur;
    cur = addDays(cur, 1);
  }
  meta.lastUpdatedAt = new Date().toISOString();
  dayCache.setMeta(plantId, meta);
  return { completed };
};

// ---------- Prewarm (login/bootstrap) ----------
// Prepara cache para: hoje (curvas), semana (últimos 7 dias), mês (últimos 30 dias)
// Sem bloquear a UI; usa pequena concorrência para acelerar sem sobrecarregar

async function runPool(items, limit, worker){
  let i = 0; const results = [];
  const run = async () => {
    const idx = i++; if (idx >= items.length) return;
    try { results[idx] = await worker(items[idx], idx); } catch { results[idx] = null }
    return run();
  };
  const runners = Array.from({ length: Math.max(1, limit) }, run);
  await Promise.all(runners);
  return results;
}

energyService.prewarm = async ({ token, plantId, weekDays = 7, monthDays = 30, concurrency = 3 }) => {
  try {
    const today = toDateStr(new Date());
    // 1) Hoje (curvas + energia)
    try { await energyService.getDayCurvesCached(token, plantId, today) } catch {}

    // 2) Semana: últimos (weekDays-1) dias + hoje
    const w = Math.max(1, Number(weekDays||7));
    const start = addDays(today, -(w-1));
    const weekList = []; {
      const base = new Date(start+'T00:00:00');
      for (let k=0;k<w;k++){ const d=new Date(base); d.setDate(base.getDate()+k); weekList.push(d.toISOString().slice(0,10)) }
    }
    await runPool(weekList, concurrency, async (ds)=> {
      const has = dayCache.getEnergy(plantId, ds);
      if (!has) { try { await energyService.getDayAggregatesCached(token, plantId, ds) } catch {} }
    });

    // 3) Mês: últimos monthDays
    const M = Math.max(1, Number(monthDays||30));
    const monthList = []; {
      const base = new Date(today+'T00:00:00');
      for (let k=1;k<=M;k++){ const d=new Date(base); d.setDate(base.getDate()-k); monthList.push(d.toISOString().slice(0,10)) }
    }
    await runPool(monthList, concurrency, async (ds)=> {
      const has = dayCache.getEnergy(plantId, ds);
      if (!has) { try { await energyService.getDayAggregatesCached(token, plantId, ds) } catch {} }
    });
    return { ok: true };
  } catch (e) { return { ok:false, error: String(e) } }
};
