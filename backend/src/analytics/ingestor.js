import { initHistoryRepo } from './historyRepo.js';
import { createGoodWeCollector } from './collector.js';

function toDateStr(d){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}` }

export async function startIngestor({ gw, dbApi }){
  const enabled = String(process.env.ANALYTICS_INGESTOR_ENABLED || 'true') === 'true';
  if (!enabled) { console.log('[ingestor] disabled by env'); return { stop: () => {} } }
  if (!process.env.GOODWE_EMAIL || !process.env.GOODWE_PASSWORD){ console.warn('[ingestor] missing GOODWE_EMAIL/PASSWORD; not starting'); return { stop: () => {} } }

  const repo = await initHistoryRepo();
  const collector = createGoodWeCollector(repo);

  async function getPlantIds(){
    const manual = (process.env.INGEST_PLANT_IDS || process.env.PLANT_ID || '').trim();
    if (manual) return manual.split(',').map(s=>s.trim()).filter(Boolean);
    try { const items = await dbApi.listPowerstations(); return (items||[]).map(x=> x.id).filter(Boolean); } catch { return [] }
  }

  async function ingestDay(plant_id, date){
    try {
      const payload = { id: plant_id, date, full_script: true };
      const j = await gw.postJson('v2/Charts/GetPlantPowerChart', payload);
      await collector.onResponse('power-chart', { plant_id, date, response: j });
      return true;
    } catch (e) { console.warn('[ingestor] ingestDay failed', plant_id, date, e?.message||e); return false }
  }

  async function ingestRealtime(plant_id){
    try { const j = await gw.postJson('v2/PowerStation/GetPowerflow', { PowerStationId: plant_id }); await collector.onResponse('powerflow', { plant_id, response: j }); }
    catch (e) { /* silent */ }
  }

  async function initialBackfill(){
    const days = Math.min(30, Math.max(1, Number(process.env.ANALYTICS_BACKFILL_DAYS || 7)));
    const pids = await getPlantIds();
    if (!pids.length) { console.warn('[ingestor] no plant ids to backfill'); return }
    const today = new Date(); today.setHours(0,0,0,0);
    for (const pid of pids){
      for (let k=days; k>=1; k--){
        const d = new Date(today.getTime() - k*86400000);
        await ingestDay(pid, toDateStr(d));
      }
      // today too
      await ingestDay(pid, toDateStr(today));
    }
  }

  const rtIntervalMs = Math.max(30_000, Number(process.env.ANALYTICS_REALTIME_INTERVAL_MS || 60_000));
  const dayIntervalMs = Math.max(300_000, Number(process.env.ANALYTICS_DAY_REFRESH_MS || 15*60_000));

  let stop = false;
  const timers = [];

  // Kickoff
  initialBackfill().catch(()=>{});

  // Realtime powerflow poll loop
  (async function loopRealtime(){
    while(!stop){
      const pids = await getPlantIds();
      for (const pid of pids){ await ingestRealtime(pid) }
      await new Promise(r => setTimeout(r, rtIntervalMs));
    }
  })();

  // Refresh today curves periodically
  (async function loopDay(){
    while(!stop){
      const pids = await getPlantIds();
      const today = toDateStr(new Date());
      for (const pid of pids){ await ingestDay(pid, today) }
      await new Promise(r => setTimeout(r, dayIntervalMs));
    }
  })();

  return { stop: () => { stop = true; timers.forEach(t=> clearInterval(t)) } };
}

