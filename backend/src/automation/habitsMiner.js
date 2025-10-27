import { getDbEngine, getAnyUser, upsertHabitPattern, insertHabitLog, setHabitPatternState, getDeviceMetaMap, listActiveHabitPatternsForTrigger } from '../db.js';

function toDate(d){ return (d instanceof Date)? d : new Date(String(d)); }
function hourPeriod(ts){ try{ const h = toDate(ts).getHours(); return (h>=6 && h<18)? 'day':'night' }catch{ return 'unknown' } }

export function startHabitMiner({ helpers }){
  const { deriveBaseUrl } = helpers;
  const engine = getDbEngine();
  const windowSec = Math.max(30, Number(process.env.HABIT_WINDOW_SEC || 180));
  const lookbackMin = Math.max(10, Number(process.env.HABIT_LOOKBACK_MIN || 60));
  const tickMs = Math.max(15_000, Number(process.env.HABIT_MINER_INTERVAL_MS || 60_000));
  let stop = false;
  let lastTs = Date.now() - lookbackMin*60*1000;

  async function fetchDeviceHistorySince(sinceTs){
    const since = new Date(sinceTs);
    try{
      if (engine.type === 'pg'){
        const r = await engine.pgPool.query(
          `SELECT vendor, device_id, name, room, ts, state_on FROM device_history WHERE ts >= $1 ORDER BY vendor, device_id, ts ASC`,
          [since]
        );
        return r.rows;
      } else {
        return engine.sqliteDb.prepare(
          `SELECT vendor, device_id, name, room, ts, state_on FROM device_history WHERE ts >= ? ORDER BY vendor, device_id, ts ASC`
        ).all(since.toISOString());
      }
    } catch { return []; }
  }

  async function ensureUser(){
    try { const u = await getAnyUser(); return u; } catch { return null }
  }

  function detectTransitions(rows){
    // rows sorted by vendor, device_id, ts
    const out = [];
    let prevKey = null; let prevOn = null; let prevTs = null;
    for (const r of rows){
      const key = `${r.vendor}|${r.device_id}`;
      const on = (r.state_on===true || r.state_on===1);
      const ts = toDate(r.ts);
      if (prevKey !== key){ prevKey = key; prevOn = on; prevTs = ts; continue; }
      if (on !== prevOn){
        out.push({ vendor: r.vendor, device_id: r.device_id, ts, event: on? 'on':'off', name: r.name||'', room: r.room||'' });
        prevOn = on; prevTs = ts;
      } else {
        prevTs = ts;
      }
    }
    // flatten and sort by time for global matching
    return out.sort((a,b)=> toDate(a.ts) - toDate(b.ts));
  }

  async function execAction({ base, token, vendor, device_id, action, user }){
    const headers = { 'Authorization': `Bearer ${token}` };
    try {
      // Respect essential and high priority
      try {
        const meta = await getDeviceMetaMap(user.id);
        const m = meta[`${vendor}|${device_id}`];
        if (m && (m.essential === true || Number(m.priority)>=3)) return false;
      } catch {}
      if (vendor==='smartthings'){
        const r = await fetch(`${base}/smartthings/device/${encodeURIComponent(device_id)}/${action}`, { method:'POST', headers, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS||30000)) });
        return r.ok;
      }
      if (vendor==='tuya'){
        const r = await fetch(`${base}/tuya/device/${encodeURIComponent(device_id)}/${action}`, { method:'POST', headers, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS||30000)) });
        return r.ok;
      }
    } catch {}
    return false;
  }

  async function mine(){
    const user = await ensureUser();
    if (!user) return;
    const base = (process.env.BASE_URL||'').replace(/\/$/, '') || (`http://127.0.0.1:${process.env.PORT||3000}`);
    const apiBase = base + '/api';
    const svcToken = process.env.ASSIST_TOKEN || '';

    const rows = await fetchDeviceHistorySince(lastTs - 60*1000); // small overlap to avoid gaps
    const transitions = detectTransitions(rows);
    const now = Date.now();
    // Build quick index for next events within window
    for (let i=0;i<transitions.length;i++){
      const a = transitions[i];
      const t0 = toDate(a.ts).getTime();
      if (t0 <= lastTs) continue; // only new
      // find partner event within window on a different device
      let found = null; let delayS = null;
      for (let j=i+1;j<transitions.length; j++){
        const b = transitions[j];
        const t1 = toDate(b.ts).getTime();
        if (t1 - t0 > windowSec*1000) break;
        if (b.vendor === a.vendor && b.device_id === a.device_id) continue;
        // simple association: any on/off that happens shortly after
        found = b; delayS = Math.round((t1 - t0)/100)/10; // one decimal
        break;
      }
      const ctx = hourPeriod(a.ts);
      try {
        const res = await upsertHabitPattern({
          user_id: user.id,
          trigger_vendor: a.vendor,
          trigger_device_id: String(a.device_id),
          trigger_event: a.event,
          action_vendor: found? found.vendor : a.vendor,
          action_device_id: found? String(found.device_id) : String(a.device_id),
          action_event: found? found.event : a.event,
          context_key: ctx,
          delay_s: (found? delayS : null)
        });
        await insertHabitLog({ pattern_id: res.id, user_id: user.id, event: found? 'pair':'trigger', meta: { t0, t1: found? toDate(found.ts).getTime(): null } });
        // 1) If we DETECT a pair and this pattern is active, we can log auto_action (mostly for reinforcement)
        if (found && svcToken){
          // try to execute only for patterns that are 'active'
          // Light DB check
          // read minimal row
          const eng = getDbEngine();
          let stateRow = null;
          if (eng.type==='pg'){
            const r = await eng.pgPool.query('SELECT state FROM habit_patterns WHERE id=$1', [res.id]); stateRow = r.rows[0]||null;
          } else {
            stateRow = eng.sqliteDb.prepare('SELECT state FROM habit_patterns WHERE id=?').get(res.id);
          }
          if (stateRow && stateRow.state === 'active'){
            const ok = await execAction({ base: apiBase, token: svcToken, vendor: found.vendor, device_id: found.device_id, action: found.event, user });
            await insertHabitLog({ pattern_id: res.id, user_id: user.id, event: 'auto_action', meta: { ok } });
          }
        }

        // 2) Execute any ACTIVE manual/learned patterns that match the TRIGGER 'a'
        if (svcToken){
          try{
            const match = await listActiveHabitPatternsForTrigger({ user_id: user.id, trigger_vendor: a.vendor, trigger_device_id: a.device_id, trigger_event: a.event, context_key: ctx });
            for (const p of (match||[])){
              const delay = Number(p.avg_delay_s||0);
              const run = async ()=>{
                const ok = await execAction({ base: apiBase, token: svcToken, vendor: p.action_vendor, device_id: p.action_device_id, action: p.action_event, user });
                try{ await insertHabitLog({ pattern_id: p.id, user_id: user.id, event: 'auto_action_from_pattern', meta: { ok } }) } catch {}
              };
              if (delay>0){ setTimeout(run, Math.round(delay*1000)); } else { run().catch(()=>{}) }
            }
          } catch {}
        }
      } catch {}
      lastTs = Math.max(lastTs, t0);
    }
  }

  const id = setInterval(()=> { if (!stop) mine().catch(()=>{}) }, tickMs);
  // initial
  mine().catch(()=>{});
  return { stop: ()=> { stop = true; clearInterval(id); } };
}
