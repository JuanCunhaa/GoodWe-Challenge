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
      const data = await getRecommendations({ plant_id, fetchWeather: async () => {
        try { return await gw.postForm('v3/PowerStation/GetWeather', { powerStationId: plant_id }); } catch { return null }
      }});
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

  // Devices overview (SmartThings + Tuya), with basic status and metrics when available
  router.get('/ai/devices/overview', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const authHeader = req.headers['authorization'] || '';
    const base = helpers.deriveBaseUrl(req).replace(/\/$/, '') + '/api';
    async function api(path){
      const r = await fetch(base + path, { headers: { 'Authorization': authHeader }, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
      const j = await r.json().catch(()=>null); if (!r.ok) throw new Error(j?.error || `${r.status}`); return j;
    }
    const items = [];
    // SmartThings
    try {
      const st = await api('/smartthings/devices');
      const list = Array.isArray(st?.items) ? st.items : [];
      const lim = Math.min(list.length, 30);
      for (let i=0; i<lim; i++){
        const d = list[i]; const id = d.id;
        let status = null; try { status = await api(`/smartthings/device/${encodeURIComponent(id)}/status`); } catch {}
        const c = status?.status?.components?.main || {};
        const sw = c?.switch?.switch?.value || '';
        const power = Number(c?.powerMeter?.power?.value ?? NaN);
        const energy = Number(c?.energyMeter?.energy?.value ?? NaN);
        items.push({ vendor:'smartthings', id, name: d.name, roomName: d.roomName||'', on: sw==='on', power_w: Number.isFinite(power)? power : null, energy_kwh: Number.isFinite(energy)? energy : null });
      }
    } catch {}
    // Tuya
    try {
      const tu = await api('/tuya/devices');
      const list = Array.isArray(tu?.items) ? tu.items : [];
      const lim = Math.min(list.length, 30);
      for (let i=0; i<lim; i++){
        const d = list[i]; const id = d.id || d.device_id || d.devId || '';
        let status = null; try { status = await api(`/tuya/device/${encodeURIComponent(id)}/status`); } catch {}
        // normalized -> components.main.switch.switch.value OR raw map with possible power codes
        let on = null; let power_w = null; let energy_kwh = null;
        const comp = status?.status?.components?.main;
        if (comp && comp.switch?.switch?.value) on = String(comp.switch.switch.value) === 'on';
        const map = (comp? null : (status?.status && typeof status.status === 'object' ? status.status : null)) || {};
        const powerCandidates = ['cur_power','power','power_w','pwr','va_power'];
        for (const k of powerCandidates){ if (map && map[k]!=null && Number.isFinite(Number(map[k]))) { power_w = Number(map[k]); break; } }
        const energyCandidates = ['add_ele','energy','kwh','elec_total'];
        for (const k of energyCandidates){ if (map && map[k]!=null && Number.isFinite(Number(map[k]))) { energy_kwh = Number(map[k]); break; } }
        items.push({ vendor:'tuya', id, name: d.name, roomName: d.roomName||'', on, power_w, energy_kwh });
      }
    } catch {}
    res.json({ ok: true, items });
  });
}
