import { getForecast, getRecommendations } from '../analytics/service.js';
import { initHistoryRepo } from '../analytics/historyRepo.js';
import { createGoodWeCollector } from '../analytics/collector.js';

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

  // Debug/status endpoint to help verify ingestion
  router.get('/ai/status', async (req, res) => {
    try {
      const user = await requireUser(req, res); if (!user) return;
      const plant_id = user.powerstation_id;
      // lazy import to avoid circulars
      const { createRepo } = await import('../analytics/historyRepo.js');
      const repo = createRepo();
      const gen = await repo.getTableStats('GenerationHistory');
      const con = await repo.getTableStats('ConsumptionHistory');
      const bat = await repo.getTableStats('BatteryHistory');
      const grd = await repo.getTableStats('GridHistory');
      const { getDbEngine } = await import('../db.js');
      const eng = getDbEngine();
      res.json({ ok: true, engine: eng.type, plant_id, stats: { generation: gen, consumption: con, battery: bat, grid: grd } });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  // Backfill helper: fetch past N days and store history (uses GoodWe charts)
  router.post('/ai/backfill', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const plant_id = user.powerstation_id;
    const days = Math.min(90, Math.max(1, Number(req.query.days || req.body?.days || 7)));
    const startStr = String(req.query.start || req.body?.start || '').slice(0,10) || null;
    function toDateStr(d){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}` }
    const today = new Date(); today.setHours(0,0,0,0);
    const startDate = startStr ? new Date(startStr+'T00:00:00') : new Date(today.getTime() - (days-1)*86400000);
    const repo = await initHistoryRepo();
    const collector = createGoodWeCollector(repo);
    let completed = 0; const errors = [];
    for (let i=0;i<days;i++){
      const d = new Date(startDate.getTime() + i*86400000);
      const date = toDateStr(d);
      try {
        const payload = { id: plant_id, date, full_script: true };
        const j = await gw.postJson('v2/Charts/GetPlantPowerChart', payload);
        await collector.onResponse('power-chart', { plant_id, date, response: j });
        completed++;
      } catch (e) { errors.push({ date, error: String(e) }); }
    }
    res.json({ ok: true, completed, days, errors });
  });
}
