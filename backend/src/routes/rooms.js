export function registerRoomsRoutes(router, { dbApi, helpers }){
  const { requireUser } = helpers;

  router.get('/rooms', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const items = await dbApi.listRoomsByUser(user.id);
      res.json({ ok:true, items });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  router.post('/rooms', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ ok:false, error:'name is required' });
      const it = await dbApi.createRoom(user.id, name);
      res.status(201).json({ ok:true, item: it });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  router.delete('/rooms/:id', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try { await dbApi.deleteRoom(user.id, Number(req.params.id)); res.status(204).end(); }
    catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  router.get('/device-meta', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try { const map = await dbApi.getDeviceMetaMap(user.id); res.json({ ok:true, items: map }); }
    catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  router.put('/device-meta', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const { vendor, device_id, room_id=null, essential=false, type=null, priority=null } = req.body || {};
      if (!vendor || !device_id) return res.status(422).json({ ok:false, error:'vendor and device_id required' });
      const it = await dbApi.upsertDeviceMeta(user.id, { vendor, device_id, room_id, essential, type, priority });
      res.json({ ok:true, item: it });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });
}

