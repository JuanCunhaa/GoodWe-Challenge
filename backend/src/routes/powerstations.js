export function registerPowerstationRoutes(router, { dbApi }) {
  router.get('/powerstations', async (req, res) => {
    const items = await dbApi.listPowerstations();
    res.json({ items });
  });

  router.post('/powerstations/:id/name', async (req, res) => {
    const { id } = req.params;
    const { name } = req.body || {};
    await dbApi.upsertBusinessName(id, name || null);
    res.json({ ok: true });
  });
}

