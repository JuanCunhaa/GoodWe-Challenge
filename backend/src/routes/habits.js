import { listHabitPatternsByUser, setHabitPatternState, incHabitUndo, insertHabitLog, listHabitLogsByUser, upsertHabitPattern } from '../db.js';

export function registerHabitsRoutes(router, { helpers }){
  const { requireUser } = helpers;

  router.get('/habits', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const items = await listHabitPatternsByUser(user.id);
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
      await insertHabitLog({ pattern_id: r.id, user_id: user.id, event: 'manual_create', meta: payload });
      res.json({ ok:true, id: r.id, pattern: { ...payload, id: r.id } });
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
}
