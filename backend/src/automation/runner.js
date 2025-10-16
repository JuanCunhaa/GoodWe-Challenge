// Simple automation runner that evaluates user-defined routines and executes actions
import { listAutomationsUsers, listAutomationsByUser, getAutomationState, setAutomationState } from '../db.js';

export function startAutomationRunner({ helpers }){
  const { deriveBaseUrl } = helpers;
  let stop = false;

  async function execTogglePriority({ apiBase, authHeader, priority, action }){
    try {
      const r = await fetch(`${apiBase}/ai/devices/toggle-priority`, { method:'POST', headers: { 'Authorization': authHeader, 'Content-Type':'application/json' }, body: JSON.stringify({ action, priority }), signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS||30000)) });
      return await r.json().catch(()=>null);
    } catch (e) { return { ok:false, error:String(e) } }
  }

  function withinWindow(now, sched){
    try {
      const d = new Date(now);
      const h = d.getHours(); const m = d.getMinutes(); const dow = d.getDay();
      const inDays = Array.isArray(sched.days) ? sched.days.includes(dow) : true;
      const [sh, sm] = String(sched.start||'00:00').split(':').map(Number);
      const [eh, em] = String(sched.end||'23:59').split(':').map(Number);
      const mins = h*60 + m; const smins = (sh||0)*60 + (sm||0); const emins = (eh||0)*60 + (em||0);
      return inDays && mins >= smins && mins <= emins;
    } catch { return false }
  }

  async function tick(){
    try {
      const base = (process.env.BASE_URL || '').replace(/\/$/, '');
      const apiBase = base ? (base + '/api') : ('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api');
      const svcToken = process.env.ASSIST_TOKEN || '';
      if (!svcToken) return;
      const headers = { 'Authorization': `Bearer ${svcToken}` };
      const users = await listAutomationsUsers();
      const now = new Date();
      for (const uid of users){
        try {
          const items = await listAutomationsByUser(uid);
          for (const a of items){
            if (!a?.enabled) continue;
            let schedule = {}; try { schedule = JSON.parse(a.schedule_json||'{}') } catch {}
            let conditions = null; try { conditions = a.conditions_json? JSON.parse(a.conditions_json): null } catch {}
            let actions = {}; try { actions = JSON.parse(a.actions_json||'{}') } catch {}

            const inWin = withinWindow(now, schedule);
            const st = await getAutomationState(a.id) || {};
            const lastState = st.last_state || 'idle';
            // Basic kinds
            if (a.kind === 'peak_saver'){
              if (inWin && lastState !== 'active'){
                // Turn off low/medium priorities
                if (actions.low !== false) await execTogglePriority({ apiBase, authHeader: headers.Authorization, priority:'low', action:'off' });
                if (actions.medium) await execTogglePriority({ apiBase, authHeader: headers.Authorization, priority:'medium', action:'off' });
                await setAutomationState(a.id, { last_state:'active', last_at: now });
              } else if (!inWin && lastState === 'active'){
                // End window; optionally turn on low/medium
                if (actions.restore_on) {
                  if (actions.low !== false) await execTogglePriority({ apiBase, authHeader: headers.Authorization, priority:'low', action:'on' });
                  if (actions.medium) await execTogglePriority({ apiBase, authHeader: headers.Authorization, priority:'medium', action:'on' });
                }
                await setAutomationState(a.id, { last_state:'idle', last_at: now });
              }
            }
            else if (a.kind === 'sleep'){
              if (inWin && lastState !== 'active'){
                if (actions.low !== false) await execTogglePriority({ apiBase, authHeader: headers.Authorization, priority:'low', action:'off' });
                if (actions.medium) await execTogglePriority({ apiBase, authHeader: headers.Authorization, priority:'medium', action:'off' });
                await setAutomationState(a.id, { last_state:'active', last_at: now });
              } else if (!inWin && lastState === 'active'){
                if (actions.restore_on) {
                  if (actions.low !== false) await execTogglePriority({ apiBase, authHeader: headers.Authorization, priority:'low', action:'on' });
                  if (actions.medium) await execTogglePriority({ apiBase, authHeader: headers.Authorization, priority:'medium', action:'on' });
                }
                await setAutomationState(a.id, { last_state:'idle', last_at: now });
              }
            }
            else if (a.kind === 'custom'){
              // Evaluate simple on/off at fixed times or within window
              if (inWin && lastState !== 'active'){
                if (actions.priority && actions.action){
                  await execTogglePriority({ apiBase, authHeader: headers.Authorization, priority:String(actions.priority), action:String(actions.action) });
                }
                await setAutomationState(a.id, { last_state:'active', last_at: now });
              } else if (!inWin && lastState === 'active'){
                if (actions.restore_on && actions.priority){
                  await execTogglePriority({ apiBase, authHeader: headers.Authorization, priority:String(actions.priority), action:'on' });
                }
                await setAutomationState(a.id, { last_state:'idle', last_at: now });
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  const id = setInterval(()=> { if (!stop) tick() }, Math.max(30_000, Number(process.env.AUTOMATION_INTERVAL_MS || 60_000)));
  tick();
  return { stop: () => { stop = true; clearInterval(id); } };
}

