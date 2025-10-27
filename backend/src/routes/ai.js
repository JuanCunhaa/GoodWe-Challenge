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

  function parseWindow(q){
    const m = String(q||'').trim().toLowerCase();
    if (!m) return 60; // minutes
    const num = parseFloat(m);
    if (isNaN(num)) return 60;
    if (m.includes('h')) return Math.max(1, Math.round(num*60));
    if (m.includes('d')) return Math.max(1, Math.round(num*60*24));
    return Math.max(1, Math.round(num));
  }

  // Aggregate: forecast + actionable recommendations + devices overview
  router.get('/ai/suggestions', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const plant_id = user.powerstation_id;
    try {
      const hours = Number(req.query.hours || 24);
      const topWindow = String(req.query.topWindow || '60');
      const tariff = (req.query.tariff!=null) ? Number(req.query.tariff) : (process.env.TARIFF_BRL_PER_KWH!=null ? Number(process.env.TARIFF_BRL_PER_KWH) : undefined);

      // Forecast (with weather adjustment)
      const forecast = await getForecast({ plant_id, hours, fetchWeather: async () => {
        try { return await gw.postForm('v3/PowerStation/GetWeather', { powerStationId: plant_id }); } catch { return null }
      }}).catch(()=> null);

      // Devices overview (SmartThings + Tuya + local meta)
      const authHeader = req.headers['authorization'] || '';
      const base = helpers.deriveBaseUrl(req).replace(/\/$/, '') + '/api';
      const api = async (path) => {
        const r = await fetch(base + path, { headers: { 'Authorization': authHeader }, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS||30000)) });
        const j = await r.json().catch(()=>null); if (!r.ok) throw new Error(j?.error || `${r.status}`); return j;
      };
      const devices = await api('/ai/devices/overview').catch(()=> ({ items: [] }));
      const items = Array.isArray(devices?.items) ? devices.items : [];

      // Build actionable, device-specific suggestions
      const { getDeviceUsageByHour } = await import('../analytics/service.js');
      const recs = [];
      const minutes24h = 24*60;
      for (const d of items.slice(0, 30)){
        // Skip essential loads
        if (d.essential === true) continue;
        // Fetch last 24h usage breakdown per hour
        let usage = null;
        try { usage = await getDeviceUsageByHour({ vendor: d.vendor, device_id: d.id, minutes: minutes24h }); } catch { usage = null }
        const hoursArr = Array.isArray(usage?.hours) ? usage.hours : [];
        if (!hoursArr.length) continue;
        // Find a 2-hour window with highest energy
        let best = { idx: 0, sum: 0 };
        for (let i=0; i<hoursArr.length; i++){
          const e0 = Number(hoursArr[i]?.energy_kwh||0);
          const e1 = Number(hoursArr[(i+1)%hoursArr.length]?.energy_kwh||0);
          const s = e0 + e1;
          if (s > best.sum) best = { idx: i, sum: s };
        }
        const estKwh = best.sum;
        if (estKwh < 0.08) continue; // ignore very low impact
        const h0 = hoursArr[best.idx]?.hour ?? 0;
        const h1 = (h0+2) % 24;
        function hhmm(h){ return `${String(h).padStart(2,'0')}:00`; }
        const start = hhmm(h0); const end = hhmm(h1);
        const nm = d.roomName ? `${d.name} (${d.roomName})` : d.name;
        const brl = (typeof tariff==='number' && !Number.isNaN(tariff)) ? +(estKwh*tariff).toFixed(2) : null;
        const costText = (brl!=null) ? ` (~R$ ${brl.toFixed(2)})` : '';
        const text = `Sugestão: desligar ${nm} entre ${start} e ${end}. Motivo: consumo de ~${estKwh.toFixed(2)} kWh nesse período nas últimas 24h${costText}.`;
        recs.push({ text, device: { vendor: d.vendor, device_id: d.id, name: d.name, roomName: d.roomName||'' }, window: { start, end }, est_savings_kwh: +estKwh.toFixed(3), est_savings_brl: (brl!=null? brl: undefined) });
      }

      // Sort by estimated savings desc and cap
      recs.sort((a,b)=> (Number(b.est_savings_kwh||0) - Number(a.est_savings_kwh||0)));
      const topRecs = recs.slice(0, 8);

      res.json({ ok:true, forecast, recommendations: topRecs, devices: items });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  async function devicesOverviewInternal(req, helpers){
    const authHeader = req.headers['authorization'] || '';
    const base = helpers.deriveBaseUrl(req).replace(/\/$/, '') + '/api';
    async function api(path){
      const r = await fetch(base + path, { headers: { 'Authorization': authHeader }, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
      const j = await r.json().catch(()=>null); if (!r.ok) throw new Error(j?.error || `${r.status}`); return j;
    }
    const items = [];
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
    try {
      const tu = await api('/tuya/devices');
      const list = Array.isArray(tu?.items) ? tu.items : [];
      const lim = Math.min(list.length, 30);
      for (let i=0; i<lim; i++){
        const d = list[i]; const id = d.id || d.device_id || d.devId || '';
        let status = null; try { status = await api(`/tuya/device/${encodeURIComponent(id)}/status`); } catch {}
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
    // Enrich with local device meta (priority/essential/room) and local rooms
    try {
      const metaResp = await api('/device-meta');
      const metaMap = (metaResp && metaResp.items) ? metaResp.items : (metaResp || {});
      const roomsResp = await api('/rooms');
      const roomsArr = Array.isArray(roomsResp?.items) ? roomsResp.items : [];
      const roomNameById = new Map(); for (const r of roomsArr){ roomNameById.set(Number(r.id), String(r.name||'')); }
      for (const d of items){
        const key = `${d.vendor||''}|${d.id||''}`;
        const mm = metaMap[key] || {};
        const roomId = (mm.room_id!=null) ? Number(mm.room_id) : null;
        const localRoomName = roomId ? (roomNameById.get(roomId) || '') : '';
        d.priority = (mm.priority!=null) ? Number(mm.priority) : null;
        d.essential = (mm.essential === true || mm.essential === 1) ? true : false;
        d.roomId = roomId;
        if (localRoomName) d.roomName = localRoomName; // prefer local mapping
      }
    } catch {}
    return { ok: true, items };
  }

  router.get('/ai/recommendations', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const plant_id = user.powerstation_id;
    try {
      const tariff = (req.query.tariff!=null) ? Number(req.query.tariff) : (process.env.TARIFF_BRL_PER_KWH!=null ? Number(process.env.TARIFF_BRL_PER_KWH) : undefined);
      const data = await getRecommendations({ plant_id, tariff_brl_per_kwh: tariff, fetchWeather: async () => {
        try { return await gw.postForm('v3/PowerStation/GetWeather', { powerStationId: plant_id }); } catch { return null }
      }, fetchDevices: async () => devicesOverviewInternal(req, helpers), fetchDeviceMeta: async () => {
        try {
          const authHeader = req.headers['authorization'] || '';
          const base = helpers.deriveBaseUrl(req).replace(/\/$/, '') + '/api';
          const r = await fetch(base + '/device-meta', { headers: { 'Authorization': authHeader }, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
          const j = await r.json().catch(()=>null);
          return (j && j.items) ? j.items : (j || {});
        } catch { return {}; }
      }, fetchRooms: async () => {
        try {
          const authHeader = req.headers['authorization'] || '';
          const base = helpers.deriveBaseUrl(req).replace(/\/$/, '') + '/api';
          const r = await fetch(base + '/rooms', { headers: { 'Authorization': authHeader }, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
          const j = await r.json().catch(()=>null);
          const map = {}; (Array.isArray(j?.items)? j.items: []).forEach(it => { map[String(it.id)] = it.name || '' });
          return map;
        } catch { return {}; }
      } });
      res.json({ ok: true, ...data });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  // Cost projection (net import * tariff)
  router.get('/ai/cost-projection', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const plant_id = user.powerstation_id;
    const hours = Number(req.query.hours || 24);
    const tariff = Number(req.query.tariff || process.env.TARIFF_BRL_PER_KWH || 1.0);
    try {
      const { getCostProjection } = await import('../analytics/service.js');
      const data = await getCostProjection({ plant_id, hours, tariff_brl_per_kwh: tariff, fetchWeather: async () => {
        try { return await gw.postForm('v3/PowerStation/GetWeather', { powerStationId: plant_id }); } catch { return null }
      }});
      res.json(data);
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  // Battery strategy (charge/discharge windows)
  router.get('/ai/battery/strategy', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    const plant_id = user.powerstation_id;
    const hours = Number(req.query.hours || 24);
    const min_soc = Number(req.query.min_soc || 20);
    const max_soc = Number(req.query.max_soc || 90);
    try {
      const { getBatteryStrategy } = await import('../analytics/service.js');
      const data = await getBatteryStrategy({ plant_id, hours, min_soc, max_soc, fetchWeather: async () => {
        try { return await gw.postForm('v3/PowerStation/GetWeather', { powerStationId: plant_id }); } catch { return null }
      }});
      res.json(data);
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  // Toggle all devices by priority (low/medium). High priority is never toggled here.
  router.post('/ai/devices/toggle-priority', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const action = String(req.body?.action || req.query?.action || '').toLowerCase();
      const priority = String(req.body?.priority || req.query?.priority || '').toLowerCase();
      if (!['on','off'].includes(action)) return res.status(422).json({ ok:false, error:'action must be on/off' });
      const prMap = { low: 1, baixa:1, medium:2, media:2 };
      const pr = prMap[priority];
      if (!pr) return res.status(422).json({ ok:false, error:'priority must be low|baixa or medium|media' });

      const authHeader = req.headers['authorization'] || '';
      const base = helpers.deriveBaseUrl(req).replace(/\/$/, '') + '/api';
      const api = async (path, opts={}) => {
        const r = await fetch(base + path, { headers: { 'Authorization': authHeader, 'Content-Type':'application/json' }, ...opts, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
        const j = await r.json().catch(()=>null); if (!r.ok) throw new Error(j?.error || `${r.status}`); return j;
      };
      const devs = await devicesOverviewInternal(req, helpers);
      const items = Array.isArray(devs?.items) ? devs.items : [];
      const meta = await api('/device-meta'); const metaMap = meta?.items || meta || {};
      const essentialNames = ['geladeira','fridge','refrigerador','freezer'];
      function isEssential(d){
        const key = `${d.vendor||''}|${d.id||''}`; const mm = metaMap[key] || {};
        if (mm.essential === true) return true;
        const s = String(d.name||'').toLowerCase(); return essentialNames.some(x => s.includes(x));
      }
      const targets = items.filter(d => !isEssential(d) && (metaMap[`${d.vendor||''}|${d.id||''}`]?.priority === pr));
      const results = [];
      for (const d of targets){
        try {
          if (d.vendor === 'smartthings'){
            const r = await fetch(`${base}/smartthings/device/${encodeURIComponent(d.id)}/${action}`, { method:'POST', headers: { 'Authorization': authHeader }, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS||30000)) });
            const j = await r.json().catch(()=>null); results.push({ vendor:d.vendor, id:d.id, ok:r.ok, resp:j });
          } else if (d.vendor === 'tuya'){
            const r = await fetch(`${base}/tuya/device/${encodeURIComponent(d.id)}/${action}`, { method:'POST', headers: { 'Authorization': authHeader }, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS||30000)) });
            const j = await r.json().catch(()=>null); results.push({ vendor:d.vendor, id:d.id, ok:r.ok, resp:j });
          }
        } catch (e) { results.push({ vendor:d.vendor, id:d.id, ok:false, error:String(e) }); }
      }
      res.json({ ok:true, count: results.length, results });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  // Toggle all devices by local Room (from our DB: /rooms + /device-meta), not vendor rooms
  router.post('/ai/devices/toggle-room', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const action = String(req.body?.action || req.query?.action || '').toLowerCase();
      const room = String(req.body?.room || req.query?.room || '').trim();
      if (!['on','off'].includes(action)) return res.status(422).json({ ok:false, error:'action must be on/off' });
      if (!room) return res.status(422).json({ ok:false, error:'room required' });

      const authHeader = req.headers['authorization'] || '';
      const base = helpers.deriveBaseUrl(req).replace(/\/$/, '') + '/api';
      const headers = { 'Authorization': authHeader };
      const api = async (path) => {
        const r = await fetch(base + path, { headers, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS||30000)) });
        const j = await r.json().catch(()=>null); if (!r.ok) throw new Error(j?.error || `${r.status}`); return j;
      };

      // 1) Resolve target room id from our Rooms list
      function norm(s){ return String(s||'').toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,' ').trim(); }
      const target = norm(room);
      const rooms = await api('/rooms').then(j => Array.isArray(j.items)? j.items: []);
      let roomId = null;
      // try exact normalized match, then contains, else numeric id
      const exact = rooms.find(r => norm(r.name) === target);
      if (exact) roomId = Number(exact.id);
      if (!roomId) {
        const partial = rooms.find(r => norm(r.name).includes(target) || target.includes(norm(r.name)));
        if (partial) roomId = Number(partial.id);
      }
      if (!roomId) {
        const asNum = Number(room);
        if (Number.isFinite(asNum) && rooms.some(r => Number(r.id) === asNum)) roomId = asNum;
      }
      if (!roomId) return res.status(404).json({ ok:false, error:'room not found' });

      // 2) Fetch device meta map and pick devices linked to this room
      const metaMap = await api('/device-meta').then(j => (j && j.items) ? j.items : (j || {}));
      const data = await devicesOverviewInternal(req, helpers);
      const items = Array.isArray(data?.items) ? data.items : [];
      const targets = items.filter(d => {
        const key = `${d.vendor||''}|${d.id||''}`;
        const mm = metaMap[key];
        return mm && Number(mm.room_id) === Number(roomId);
      });

      // 3) Send commands per vendor
      const results = [];
      for (const d of targets){
        try {
          if (d.vendor === 'smartthings'){
            const r = await fetch(`${base}/smartthings/device/${encodeURIComponent(d.id)}/${action}`, { method:'POST', headers, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS||30000)) });
            const j = await r.json().catch(()=>null); results.push({ vendor:d.vendor, id:d.id, name:d.name, roomId, ok:r.ok, resp:j });
          } else if (d.vendor === 'tuya'){
            const r = await fetch(`${base}/tuya/device/${encodeURIComponent(d.id)}/${action}`, { method:'POST', headers, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS||30000)) });
            const j = await r.json().catch(()=>null); results.push({ vendor:d.vendor, id:d.id, name:d.name, roomId, ok:r.ok, resp:j });
          }
        } catch (e) { results.push({ vendor:d.vendor, id:d.id, name:d.name, roomId, ok:false, error:String(e) }); }
      }
      res.json({ ok:true, count: results.length, roomId, results });
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
    const data = await devicesOverviewInternal(req, helpers);
    res.json(data);
  });

  // Toggle device by fuzzy name across SmartThings + Tuya
  router.post('/ai/device/toggle', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const name = String(req.body?.name || req.query?.name || '').trim();
      const action = String(req.body?.action || req.query?.action || '').toLowerCase();
      if (!name || !['on','off'].includes(action)) return res.status(422).json({ ok:false, error:'name and action (on/off) required' });

      const data = await devicesOverviewInternal(req, helpers);
      const items = Array.isArray(data?.items) ? data.items : [];

      function norm(s){ return String(s||'').toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,' ').trim(); }
      const q = norm(name);
      function score(d){
        const n = norm(d.name);
        let sc = 0;
        if (n === q) sc = 100;
        else if (n.includes(q)) sc = 80;
        else {
          const parts = q.split(' ').filter(Boolean);
          let hit = 0; for (const p of parts){ if (n.includes(p)) hit++; }
          sc = hit * 10 + (d.roomName && norm(d.roomName).includes(q) ? 5 : 0);
        }
        // prefer on devices when turning off
        if (action==='off' && d.on===true) sc += 3;
        return sc;
      }
      const ranked = items.map(d=>({ d, s: score(d) })).sort((a,b)=> b.s-a.s);
      const best = ranked[0] && ranked[0].s>=10 ? ranked[0].d : null;
      if (!best) return res.status(404).json({ ok:false, error:'device not found', tried: items.length });

      const authHeader = req.headers['authorization'] || '';
      const base = helpers.deriveBaseUrl(req).replace(/\/$/, '') + '/api';
      const headers = { 'Authorization': authHeader };
      let resp = null;
      if (best.vendor === 'smartthings') {
        const r = await fetch(`${base}/smartthings/device/${encodeURIComponent(best.id)}/${action}`, { method:'POST', headers, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS||30000)) });
        resp = await r.json().catch(()=>null);
        if (!r.ok) return res.status(r.status).json(resp||{ ok:false });
      } else if (best.vendor === 'tuya') {
        const r = await fetch(`${base}/tuya/device/${encodeURIComponent(best.id)}/${action}`, { method:'POST', headers, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS||30000)) });
        resp = await r.json().catch(()=>null);
        if (!r.ok) return res.status(r.status).json(resp||{ ok:false });
      } else {
        return res.status(400).json({ ok:false, error:'unknown vendor' });
      }
      res.json({ ok:true, vendor: best.vendor, device_id: best.id, name: best.name, roomName: best.roomName||'', action, result: resp });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });

  // (removed) /ai/automations/suggest and /ai/automations/apply
}
