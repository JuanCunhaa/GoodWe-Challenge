import { listHabitPatternsByUser, setHabitPatternState, incHabitUndo, insertHabitLog, listHabitLogsByUser } from '../db.js';

export function registerHabitsRoutes(router, { helpers }){
  const { requireUser } = helpers;

  router.get('/habits', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const items = await listHabitPatternsByUser(user.id);
      res.json({ ok:true, items });
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
