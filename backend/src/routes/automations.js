import { upsertAutomation, deleteAutomation, listAutomationsByUser, setAutomationState, getAutomationState } from '../db.js';

export function registerAutomationsRoutes(router, { helpers }){
  const { requireUser } = helpers;

  router.get('/automations', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try { const items = await listAutomationsByUser(user.id); res.json({ ok:true, items }); }
    catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  router.post('/automations', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const { name, enabled=true, kind, schedule={}, conditions=null, actions={} } = req.body || {};
      if (!name || !kind) return res.status(422).json({ ok:false, error:'name and kind required' });
      const it = await upsertAutomation(user.id, { name, enabled, kind, schedule, conditions, actions });
      res.status(201).json({ ok:true, item: it });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  router.put('/automations/:id', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const id = Number(req.params.id||0); if (!id) return res.status(422).json({ ok:false, error:'invalid id' });
      const { name, enabled, kind, schedule, conditions, actions } = req.body || {};
      const it = await upsertAutomation(user.id, { id, name, enabled, kind, schedule, conditions, actions });
      res.json({ ok:true, item: it });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  router.delete('/automations/:id', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try { const id = Number(req.params.id||0); await deleteAutomation(user.id, id); res.status(204).end(); }
    catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  // Manual run marker (for dashboards)
  router.post('/automations/:id/run', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try { const id = Number(req.params.id||0); await setAutomationState(id, { last_state: 'manual-run', last_at: new Date() }); const st = await getAutomationState(id); res.json({ ok:true, state: st }); }
    catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });
}

