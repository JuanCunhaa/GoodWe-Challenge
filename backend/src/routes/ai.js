import { getForecast, getRecommendations } from '../analytics/service.js';

export function registerAiRoutes(router, { gw, helpers }){
  const { requireUser } = helpers;

  router.get('/ai/forecast', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const plant_id = user.powerstation_id;
    const hours = Number(req.query.hours || 24);
    try {
      const data = await getForecast({ plant_id, hours, fetchWeather: async () => {
        try { return await gw.postForm('v3/PowerStation/GetWeather', { powerStationId: plant_id }); } catch { return null }
      }});
      res.json({ ok: true, ...data });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  router.get('/ai/recommendations', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const plant_id = user.powerstation_id;
    try {
      const data = await getRecommendations({ plant_id });
      res.json({ ok: true, ...data });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });
}

