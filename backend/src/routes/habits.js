import { listHabitPatternsByUser, setHabitPatternState, incHabitUndo, insertHabitLog, listHabitLogsByUser, upsertHabitPattern, deleteHabitPattern, getHabitPatternById, getDbEngine } from '../db.js';

export function registerHabitsRoutes(router, { helpers }){
  const { requireUser } = helpers;

  router.get('/habits', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      let items = await listHabitPatternsByUser(user.id);
      // Filter out degenerate patterns: same device and same event (ex.: TV ON -> TV ON)
      items = (Array.isArray(items)? items: []).filter(it => {
        const sameDevice = String(it.trigger_vendor||'').toLowerCase() === String(it.action_vendor||'').toLowerCase()
          && String(it.trigger_device_id||'') === String(it.action_device_id||'');
        const sameEvent = String(it.trigger_event||'').toLowerCase() === String(it.action_event||'').toLowerCase();
        // Allow same device only if events differ (ex.: ON -> OFF). Block same device + same event.
        return !(sameDevice && sameEvent);
      });
      res.json({ ok:true, items });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  // Create or update a habit pattern manually (admin/helper)
  router.post('/habits/manual', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const {
        trigger_vendor, trigger_device_id, trigger_event,
        action_vendor, action_device_id, action_event,
        context_key = 'global', delay_s = null,
      } = req.body || {};
      const reqFields = [trigger_vendor, trigger_device_id, trigger_event, action_vendor, action_device_id, action_event];
      if (reqFields.some(v => v == null || String(v).trim() === '')) return res.status(422).json({ ok:false, error:'missing fields' });
      // Reject degenerate patterns: same device and same event
      const sameDevice = String(trigger_vendor).toLowerCase() === String(action_vendor).toLowerCase()
        && String(trigger_device_id) === String(action_device_id);
      const sameEvent = String(trigger_event).toLowerCase() === String(action_event).toLowerCase();
      if (sameDevice && sameEvent) return res.status(422).json({ ok:false, error:'invalid pattern: trigger equals action (same device and event)' });
      const payload = {
        user_id: user.id,
        trigger_vendor: String(trigger_vendor).toLowerCase(),
        trigger_device_id: String(trigger_device_id),
        trigger_event: String(trigger_event).toLowerCase(),
        action_vendor: String(action_vendor).toLowerCase(),
        action_device_id: String(action_device_id),
        action_event: String(action_event).toLowerCase(),
        context_key: String(context_key || 'global'),
        delay_s: (delay_s!=null ? Number(delay_s) : null),
      };
      const r = await upsertHabitPattern(payload);
      // Manual criação deve entrar em produção imediatamente
      try { await setHabitPatternState(r.id, 'active'); } catch {}
      await insertHabitLog({ pattern_id: r.id, user_id: user.id, event: 'manual_create', meta: payload });
      res.json({ ok:true, id: r.id, pattern: { ...payload, id: r.id, state: 'active' } });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  router.put('/habits/:id/state', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const id = Number(req.params.id||0); const state = String(req.body?.state||'');
      await setHabitPatternState(id, state);
      await insertHabitLog({ pattern_id: id, user_id: user.id, event: state, meta: {} });
      res.json({ ok:true });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  router.post('/habits/:id/undo', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const id = Number(req.params.id||0);
      await incHabitUndo(id);
      await insertHabitLog({ pattern_id: id, user_id: user.id, event: 'undo', meta: {} });
      res.json({ ok:true });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  // Delete a habit pattern
  router.delete('/habits/:id', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const id = Number(req.params.id||0);
      // Optional: log before deletion
      try { await insertHabitLog({ pattern_id: id, user_id: user.id, event: 'delete', meta: {} }); } catch {}
      await deleteHabitPattern(id);
      res.json({ ok:true });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  // Timeline (logs)
  router.get('/habits/logs', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const limit = Number(req.query.limit||50);
      const pid = req.query.pattern_id ? Number(req.query.pattern_id) : null;
      const items = await listHabitLogsByUser(user.id, { limit, pattern_id: pid });
      res.json({ ok:true, items });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  // Manual test: trigger a habit action now (for debug)
  router.post('/habits/:id/test', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const id = Number(req.params.id||0);
      const row = await getHabitPatternById(id);
      if (!row || Number(row.user_id)!==Number(user.id)) return res.status(404).json({ ok:false, error:'not found' });

      const eng = getDbEngine();
      async function getFriendlyName(vendor, device_id){
        try{
          if (eng.type==='pg'){
            const r = await eng.pgPool.query('SELECT name, room FROM device_history WHERE vendor=$1 AND device_id=$2 ORDER BY ts DESC LIMIT 1', [String(vendor), String(device_id)]);
            const rr = r.rows?.[0];
            const n = rr?.name || String(device_id);
            const room = rr?.room || '';
            return room? `${n} (${room})` : n;
          } else {
            const rr = eng.sqliteDb.prepare('SELECT name, room FROM device_history WHERE vendor=? AND device_id=? ORDER BY ts DESC LIMIT 1').get(String(vendor), String(device_id));
            const n = rr?.name || String(device_id);
            const room = rr?.room || '';
            return room? `${n} (${room})` : n;
          }
        } catch { return `${vendor}:${device_id}` }
      }

      const base = (process.env.BASE_URL||'').replace(/\/$/, '') || (`http://127.0.0.1:${process.env.PORT||3000}`);
      const apiBase = base + '/api';
      const authHeader = req.headers['authorization'] || '';
      const svcToken = process.env.ASSIST_TOKEN || '';
      const useAssistant = !!(process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY);
      let method = 'direct';
      let answer = null; let steps = null; let ok = false; let resp = null;

      if (useAssistant) {
        method = 'assistant';
        const name = await getFriendlyName(row.action_vendor, row.action_device_id);
        const verb = String(row.action_event||'').toLowerCase()==='off' ? 'desliga' : 'liga';
        const input = `${verb} ${name}`;
        const url = `${apiBase}/assistant/chat${svcToken? ('?powerstation_id='+ encodeURIComponent(user.powerstation_id||'')) : ''}`;
        const headers = { 'Content-Type': 'application/json', 'Authorization': svcToken? ('Bearer '+svcToken) : authHeader };
        const r = await fetch(url, { method:'POST', headers, body: JSON.stringify({ input }), signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS||30000)) });
        resp = await r.json().catch(()=>null);
        ok = !!resp?.ok;
        answer = resp?.answer || null;
        steps = resp?.steps || null;
      } else {
        const headers = { 'Authorization': authHeader };
        if (row.action_vendor==='smartthings'){
          const r = await fetch(`${apiBase}/smartthings/device/${encodeURIComponent(row.action_device_id)}/${encodeURIComponent(row.action_event)}`, { method:'POST', headers, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS||30000)) });
          resp = await r.json().catch(()=>null);
          ok = r.ok;
        } else if (row.action_vendor==='tuya'){
          const r = await fetch(`${apiBase}/tuya/device/${encodeURIComponent(row.action_device_id)}/${encodeURIComponent(row.action_event)}`, { method:'POST', headers, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS||30000)) });
          resp = await r.json().catch(()=>null);
          ok = r.ok;
        } else {
          resp = { error: 'unsupported vendor' };
          ok = false;
        }
      }

      try{ await insertHabitLog({ pattern_id: id, user_id: user.id, event: 'manual_test', meta: { method, ok, resp: resp||null } }) } catch {}
      res.json({ ok:true, method, result_ok: ok, answer, steps, resp });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });
}
