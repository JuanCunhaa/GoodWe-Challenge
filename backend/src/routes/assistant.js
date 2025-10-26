export function registerAssistantRoutes(router, { gw, helpers, dbApi }) {
  const { getBearerToken, requireUser, deriveBaseUrl } = helpers;

  router.post('/assistant/chat', async (req, res) => {
    try {
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || '';
      if (!OPENAI_API_KEY) return res.status(501).json({ ok: false, error: 'assistant unavailable: missing OPENAI_API_KEY' });

      const bearer = getBearerToken(req);
      const svcToken = process.env.ASSIST_TOKEN || '';
      let user = null;
      if (svcToken && bearer === svcToken) {
        const plantId = String(
          req.query.powerstation_id ||
          req.query.powerStationId ||
          req.query.pw_id ||
          process.env.ASSIST_PLANT_ID ||
          process.env.PLANT_ID ||
          ''
        );
        if (!plantId) return res.status(400).json({ ok: false, error: 'missing plant id (set ASSIST_PLANT_ID/PLANT_ID or pass ?powerstation_id=...)' });
        user = { id: 0, email: 'assistant@service', powerstation_id: plantId };
      } else {
        user = await requireUser(req, res); if (!user) return;
      }

      const input = String(req.body?.input || '').trim();
      const prev = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const psId = user.powerstation_id;

      const authHeader = req.headers['authorization'] || '';
      const apiBase = deriveBaseUrl(req).replace(/\/$/, '') + '/api';
      async function apiJson(path, opts = {}) {
        const r = await fetch(apiBase + path, {
          method: opts.method || 'GET',
          headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)),
        });
        const ct = r.headers.get('content-type') || '';
        const data = ct.includes('application/json') ? await r.json().catch(() => null) : null;
        if (!r.ok) throw new Error(data?.error || `${r.status} ${r.statusText}`);
        return data || {};
      }

      const tools = {
        async get_devices_overview(){
          const data = await apiJson(`/ai/devices/overview`);
          return { ok: true, ...data };
        },
        async get_forecast({ hours }){
          const h = Number(hours || 24);
          const data = await apiJson(`/ai/forecast?hours=${encodeURIComponent(h)}`);
          return { ok: true, ...data };
        },
        async get_recommendations(){
          const data = await apiJson(`/ai/recommendations`);
          return { ok: true, ...data };
        },
        async device_toggle({ name, action }){
          const payload = { name: String(name||'').trim(), action: String(action||'').toLowerCase() };
          const data = await apiJson(`/ai/device/toggle`, { method:'POST', body: payload });
          return { ok: true, ...data };
        },
        async devices_toggle_priority({ action, priority }){
          const payload = { action: String(action||'').toLowerCase(), priority: String(priority||'').toLowerCase() };
          const data = await apiJson(`/ai/devices/toggle-priority`, { method:'POST', body: payload });
          return { ok: true, ...data };
        },
        async devices_toggle_room({ action, room }){
          const payload = { action: String(action||'').toLowerCase(), room: String(room||'').trim() };
          const data = await apiJson(`/ai/devices/toggle-room`, { method:'POST', body: payload });
          return { ok: true, ...data };
        },
        async get_device_usage_by_hour({ vendor, device_id, window }){
          const v = String(vendor||'').toLowerCase();
          const id = String(device_id||'');
          const w = String(window||'24h');
          const data = await apiJson(`/iot/device/${encodeURIComponent(v)}/${encodeURIComponent(id)}/usage-by-hour?window=${encodeURIComponent(w)}`);
          return { ok: true, ...data };
        },
        // Habits (hábitos)
        async habits_list(){ const j = await apiJson('/habits'); return { items: j.items || [], total: (j.items||[]).length }; },
        async habits_logs({ limit, pattern_id }){ const q = new URLSearchParams({ limit: String(limit||50) }); if (pattern_id!=null) q.set('pattern_id', String(pattern_id)); const j = await apiJson(`/habits/logs?${q}`); return { items: j.items || [], total: (j.items||[]).length }; },
        async habit_set_state({ id, state }){ if(!id||!state) throw new Error('id and state required'); const j = await apiJson(`/habits/${encodeURIComponent(String(id))}/state`, { method:'PUT', body:{ state } }); return j; },
        async habit_undo({ id }){ if(!id) throw new Error('id required'); const j = await apiJson(`/habits/${encodeURIComponent(String(id))}/undo`, { method:'POST', body:{} }); return j; },
        async cost_projection({ hours, tariff_brl_per_kwh }){
          const h = Number(hours||24);
          const t = Number(tariff_brl_per_kwh|| (process.env.TARIFF_BRL_PER_KWH||1.0));
          const data = await apiJson(`/ai/cost-projection?hours=${encodeURIComponent(h)}&tariff=${encodeURIComponent(t)}`);
          return { ok: true, ...data };
        },
        async battery_strategy({ hours, min_soc, max_soc }){
          const q = new URLSearchParams({
            hours: String(Number(hours||24)),
            min_soc: String(Number(min_soc||20)),
            max_soc: String(Number(max_soc||90))
          }).toString();
          const data = await apiJson(`/ai/battery/strategy?${q}`);
          return { ok: true, ...data };
        },
        async automation_list(){
          const data = await apiJson(`/automations`);
          return { ok:true, ...data };
        },
        async automation_create({ name, enabled=true, kind, schedule, conditions, actions }){
          const body = { name, enabled, kind, schedule, conditions, actions };
          const data = await apiJson(`/automations`, { method:'POST', body });
          return { ok:true, ...data };
        },
        async automation_update({ id, name, enabled, kind, schedule, conditions, actions }){
          const body = { name, enabled, kind, schedule, conditions, actions };
          const data = await apiJson(`/automations/${encodeURIComponent(String(id))}`, { method:'PUT', body });
          return { ok:true, ...data };
        },
        async automation_delete({ id }){
          const r = await fetch(apiBase + `/automations/${encodeURIComponent(String(id))}`, { method:'DELETE', headers: { 'Authorization': authHeader }, signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS||30000)) });
          if (!r.ok) throw new Error(`${r.status}`);
          return { ok:true };
        },
        async automation_run({ id }){
          const data = await apiJson(`/automations/${encodeURIComponent(String(id))}/run`, { method:'POST', body:{} });
          return { ok:true, ...data };
        },
        async eco_simulate({ hours=24, tariff_brl_per_kwh }){
          const [recs, cost, strat] = await Promise.all([
            apiJson(`/ai/recommendations`),
            apiJson(`/ai/cost-projection?hours=${encodeURIComponent(Number(hours||24))}${tariff_brl_per_kwh!=null? `&tariff=${encodeURIComponent(Number(tariff_brl_per_kwh))}`:''}`),
            apiJson(`/ai/battery/strategy?hours=${encodeURIComponent(Number(hours||24))}`),
          ]);
          return { ok:true, recommendations: recs?.recommendations||[], cost_projection: cost, battery_strategy: strat };
        },
        async eco_execute({ priority='low' }){
          const data = await apiJson(`/ai/devices/toggle-priority`, { method:'POST', body: { action:'off', priority } });
          return { ok:true, ...data };
        },
        async get_income_today() {
          const body = { powerstation_id: psId, key: '', orderby: '', powerstation_type: '', powerstation_status: '', page_index: 1, page_size: 14, adcode: '', org_id: '', condition: '' };
          const j = await gw.postJson('PowerStationMonitor/QueryPowerStationMonitor', body);
          const it = j?.data?.list?.[0] || {};
          const income = Number(it?.eday_income || 0);
          const currency = String(it?.currency || 'BRL');
          const date = new Date().toISOString().slice(0, 10);
          return { income, currency, date, source: '/api/monitor' };
        },
        async get_total_income() {
          const det = await gw.postForm('v3/PowerStation/GetPlantDetailByPowerstationId', { powerStationId: psId });
          const income = Number(det?.data?.kpi?.total_income || 0);
          const currency = String(det?.data?.kpi?.currency || 'BRL');
          return { income, currency, source: '/api/plant-detail' };
        },
        async get_generation({ range }) {
          const today = new Date();
          const pad = (n) => String(n).padStart(2, '0');
          const dateLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          const startEnd = (days) => { const end = new Date(); const start = new Date(end); start.setDate(end.getDate() - days + 1); return { start: dateLocal(start), end: dateLocal(end) } };

          if (range === 'today' || range === 'yesterday'){
            const ref = new Date(today);
            if (range === 'yesterday') ref.setDate(today.getDate()-1);
            const ds = dateLocal(ref);
            const j = await apiJson(`/energy/day-aggregates?date=${encodeURIComponent(ds)}`);
            const kwh = Number(j?.energy?.pv || 0);
            return { kwh, period: range, source: '/api/energy/day-aggregates' };
          }

          if (range === 'this_week'){
            const { start, end } = startEnd(7);
            const j = await apiJson(`/energy/daily-aggregates?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
            const items = Array.isArray(j?.items) ? j.items : [];
            const kwh = items.reduce((s,it)=> s + Number(it?.energy?.pv || 0), 0);
            return { kwh, period: 'this_week', source: '/api/energy/daily-aggregates' };
          }

          if (range === 'this_month'){
            const { start, end } = startEnd(30);
            const j = await apiJson(`/energy/daily-aggregates?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
            const items = Array.isArray(j?.items) ? j.items : [];
            const kwh = items.reduce((s,it)=> s + Number(it?.energy?.pv || 0), 0);
            return { kwh, period: 'this_month', source: '/api/energy/daily-aggregates' };
          }

          if (range === 'total') {
            const det = await gw.postForm('v3/PowerStation/GetPlantDetailByPowerstationId', { powerStationId: psId });
            const etotal = Number(det?.data?.kpi?.etotal ?? det?.data?.info?.etotal ?? 0);
            return { kwh: etotal, period: 'total', source: '/api/plant-detail' };
          }

          return { kwh: 0, period: String(range || 'unknown') };
        },

        async get_monitor(params) {
          const body = { powerstation_id: psId, key: params?.key || '', orderby: params?.orderby || '', powerstation_type: params?.powerstation_type || '', powerstation_status: params?.powerstation_status || '', page_index: Number(params?.page_index || 1), page_size: Number(params?.page_size || 14), adcode: params?.adcode || '', org_id: params?.org_id || '', condition: params?.condition || '' };
          return await gw.postJson('PowerStationMonitor/QueryPowerStationMonitor', body);
        },
        async get_inverters() { return await gw.postForm('v3/PowerStation/GetInverterAllPoint', { powerStationId: psId }); },
        async get_weather() { return await gw.postForm('v3/PowerStation/GetWeather', { powerStationId: psId }); },
        async get_powerflow() { return await gw.postJson('v2/PowerStation/GetPowerflow', { PowerStationId: psId }); },
        async get_evcharger_count() { return await gw.postJson('v4/EvCharger/GetEvChargerCountByPwId', { PowerStationId: psId }); },
        async get_plant_detail() { return await gw.postForm('v3/PowerStation/GetPlantDetailByPowerstationId', { powerStationId: psId }); },
        async get_chart_by_plant({ date, range = 2, chartIndexId = '8', isDetailFull = false }) { return await gw.postJson('v2/Charts/GetChartByPlant', { id: psId, date: date || '', range: Number(range), chartIndexId: String(chartIndexId), isDetailFull: !!isDetailFull }); },
        async get_power_chart({ date, full_script = true }) { return await gw.postJson('v2/Charts/GetPlantPowerChart', { id: psId, date: date || '', full_script: !!full_script }); },
        async get_warnings() { return await gw.postForm('warning/PowerstationWarningsQuery', { pw_id: psId }); },
        async list_powerstations() { return await dbApi.listPowerstations(); },
        async set_powerstation_name({ id, name }) { await dbApi.upsertBusinessName(String(id || ''), (name ?? null)); return { ok: true }; },
        async debug_auth() {
          const auth = gw.auth || null; const cookies = Object.keys(gw.cookies || {}); const tokenHeader = gw.tokenHeaderValue || null; const mask = (s) => (typeof s === 'string' && s.length > 12) ? `${s.slice(0, 8)}...${s.slice(-4)}` : s; return { hasAuth: !!auth, api_base: auth?.api_base || null, uid: auth?.uid || null, token_present: !!auth?.token, timestamp: auth?.timestamp || null, cookies, token_header_length: tokenHeader ? tokenHeader.length : 0, token_header_preview: tokenHeader ? tokenHeader.slice(0, 64) + '...' : null, token_mask: auth?.token ? mask(auth.token) : null };
        },
        async cross_login() { const a = await gw.crossLogin(); return { api_base: a.api_base, uid: a.uid, timestamp: a.timestamp }; },

        // SmartThings (via API interna)
        async st_list_devices() {
          const j = await apiJson('/smartthings/devices');
          // rooms jÃ¡ sÃ£o resolvidos no backend; manter compat
          const items = (j.items || []).map(d => ({ ...d, roomName: d.roomName || '' }));
          return { items, total: items.length };
        },
        async st_device_status({ device_id }) { if (!device_id) throw new Error('device_id required'); return await apiJson(`/smartthings/device/${encodeURIComponent(device_id)}/status`); },
        async st_command({ device_id, action, component }) {
          if (!device_id || !action) throw new Error('device_id and action required');
          let useComponent = component || 'main';
          try {
            const devs = await tools.st_list_devices();
            const found = (devs.items || []).find(d => String(d.id) === String(device_id));
            if (found && Array.isArray(found.components)) {
              const cand = found.components.find(c => Array.isArray(c.capabilities) && c.capabilities.some(x => (x.id || x.capability) === 'switch'));
              if (cand && cand.id) useComponent = cand.id;
            }
          } catch {}
          await apiJson('/smartthings/commands', { method: 'POST', body: { deviceId: device_id, action, component: useComponent } });
          const status = await tools.st_device_status({ device_id });
          let name = ''; try { const devs = await tools.st_list_devices(); const found = (devs.items || []).find(d => String(d.id) === String(device_id)); name = found?.name || ''; } catch {}
          return { ok: true, device_id, name, action, status };
        },
        async st_find_device_room({ query, device_id }) {
          const j = await tools.st_list_devices();
          const devices = Array.isArray(j.items) ? j.items : [];
          let chosen = null;
          if (device_id) chosen = devices.find(d => String(d.id) === String(device_id));
          const q = String(query || '').toLowerCase().trim();
          if (!chosen && q) chosen = devices.find(d => String(d.name||'').toLowerCase().includes(q));
          if (!chosen) return { ok: false, error: 'device not found' };
          const roomName = chosen.roomName || '';
          return { ok: true, name: chosen.name || '', roomName: roomName || '' };
        },

        // Tuya (via API interna)
        async tuya_list_devices() { const j = await apiJson('/tuya/devices'); return { items: j.items || [], total: (j.items||[]).length }; },
        async tuya_device_status({ device_id }) { if (!device_id) throw new Error('device_id required'); return await apiJson(`/tuya/device/${encodeURIComponent(device_id)}/status`); },
        async tuya_command({ device_id, action }) {
          if (!device_id || !action) throw new Error('device_id and action required');
          await apiJson(`/tuya/device/${encodeURIComponent(device_id)}/${encodeURIComponent(action)}`, { method: 'POST', body: {} }).catch(async () => {
            const value = action === 'on'; await apiJson('/tuya/commands', { method: 'POST', body: { device_id, commands: [{ code: 'switch', value }] } });
          });
          const status = await tools.tuya_device_status({ device_id });
          let name = ''; try { const devs = await tools.tuya_list_devices(); const found = (devs.items || []).find(d => String(d.id||d.uuid) === String(device_id)); name = found?.name || ''; } catch {}
          return { ok: true, device_id, name, action, status };
        },
      };

      const toolSchemas = [
        { name: 'device_toggle', description: 'Liga/Desliga dispositivo por nome (SmartThings/Tuya) com correspondência aproximada.', parameters: { type:'object', properties: { name: { type:'string' }, action:{ type:'string', enum:['on','off'] } }, required:['name','action'], additionalProperties:false } },
        { name: 'get_devices_overview', description: 'Lista dispositivos (SmartThings + Tuya) do usuário com status e métricas (quando disponíveis).', parameters: { type:'object', properties:{}, additionalProperties:false } },
        { name: 'get_forecast', description: 'Previsão de geração e consumo nas próximas horas.', parameters: { type: 'object', properties: { hours: { type: 'number', minimum: 1, maximum: 72 } }, additionalProperties: false } },
        { name: 'get_recommendations', description: 'Sugestões de economia baseadas no histórico.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_income_today', description: 'Retorna a renda agregada de hoje.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_total_income', description: 'Retorna a renda total acumulada da planta.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_generation', description: 'Retorna a geracao para um intervalo padrão.', parameters: { type: 'object', properties: { range: { type: 'string', enum: ['today','yesterday','this_week','this_month','total'] } }, required: ['range'], additionalProperties: false } },
        { name: 'get_monitor', description: 'QueryPowerStationMonitor', parameters: { type: 'object', properties: { page_index: { type: 'number' }, page_size: { type: 'number' }, key: { type: 'string' }, orderby: { type: 'string' }, powerstation_type: { type: 'string' }, powerstation_status: { type: 'string' }, adcode: { type: 'string' }, org_id: { type: 'string' }, condition: { type: 'string' } }, additionalProperties: false } },
        { name: 'get_inverters', description: 'GetInverterAllPoint', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_weather', description: 'GetWeather', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_powerflow', description: 'GetPowerflow', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_evcharger_count', description: 'GetEvChargerCountByPwId', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_plant_detail', description: 'GetPlantDetailByPowerstationId', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_chart_by_plant', description: 'Charts/GetChartByPlant', parameters: { type: 'object', properties: { date: { type: 'string' }, range: { type: 'number' }, chartIndexId: { type: 'string' }, isDetailFull: { type: 'boolean' } }, additionalProperties: false } },
        { name: 'get_power_chart', description: 'Charts/GetPlantPowerChart', parameters: { type: 'object', properties: { date: { type: 'string' }, full_script: { type: 'boolean' } }, additionalProperties: false } },
        { name: 'get_warnings', description: 'warning/PowerstationWarningsQuery', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'list_powerstations', description: 'Lista powerstations locais', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'set_powerstation_name', description: 'Define nome comercial local para powerstation', parameters: { type: 'object', properties: { id: { type: 'string' }, name: { type: ['string','null'] } }, required: ['id'], additionalProperties: false } },
        { name: 'debug_auth', description: 'Info GoodWe (mascarado)', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'cross_login', description: 'Executa CrossLogin GoodWe', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'st_list_devices', description: 'Lista dispositivos do SmartThings vinculados ao usuario atual.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'st_device_status', description: 'Status de um dispositivo SmartThings.', parameters: { type: 'object', properties: { device_id: { type: 'string' } }, required: ['device_id'], additionalProperties: false } },
        { name: 'st_command', description: 'Liga/Desliga um device SmartThings.', parameters: { type: 'object', properties: { device_id: { type: 'string' }, action: { type: 'string', enum: ['on','off'] }, component: { type: 'string' } }, required: ['device_id','action'], additionalProperties: false } },
        { name: 'st_find_device_room', description: 'Encontra o comodo (nome) de um dispositivo SmartThings (por nome ou id).', parameters: { type: 'object', properties: { query: { type: 'string' }, device_id: { type: 'string' } }, additionalProperties: false } },
        { name: 'tuya_list_devices', description: 'Lista dispositivos Tuya vinculados (Smart Life e/ou Tuya app).', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'tuya_device_status', description: 'Status de um device Tuya.', parameters: { type: 'object', properties: { device_id: { type: 'string' } }, required: ['device_id'], additionalProperties: false } },
        { name: 'habits_list', description: 'Lista habitos detectados (padroes) com estado.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'habits_logs', description: 'Timeline dos habitos (ultimos eventos).', parameters: { type: 'object', properties: { limit: { type: 'number' }, pattern_id: { type: 'number' } }, additionalProperties: false } },
        { name: 'habit_set_state', description: 'Altera estado de um habito (shadow|suggested|active|paused|retired).', parameters: { type: 'object', properties: { id: { type: 'number' }, state: { type: 'string', enum: ['shadow','suggested','active','paused','retired'] } }, required: ['id','state'], additionalProperties: false } },
        { name: 'habit_undo', description: 'Desfaz a ultima acao aplicada a um habito.', parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'], additionalProperties: false } },
        { name: 'tuya_command', description: 'Liga/Desliga um device Tuya.', parameters: { type: 'object', properties: { device_id: { type: 'string' }, action: { type: 'string', enum: ['on','off'] } }, required: ['device_id','action'], additionalProperties: false } },
        
        { name: 'devices_toggle_room', description: 'Liga/Desliga todos os dispositivos de um comodo (ex.: sala, cozinha).', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['on','off'] }, room: { type: 'string' } }, required: ['action','room'], additionalProperties: false } },
        { name: 'get_device_usage_by_hour', description: 'Uso por hora de um dispositivo nas últimas 24h (ou janela definida).', parameters: { type: 'object', properties: { vendor: { type: 'string' }, device_id: { type: 'string' }, window: { type: 'string' } }, required: ['vendor','device_id'], additionalProperties: false } },
        { name: 'cost_projection', description: 'Projeção de custo baseado em previsão de consumo/geração.', parameters: { type: 'object', properties: { hours: { type: 'number' }, tariff_brl_per_kwh: { type: 'number' } }, additionalProperties: false } },
        { name: 'battery_strategy', description: 'Janelas ótimas de carga/descarga da bateria nas próximas horas.', parameters: { type: 'object', properties: { hours: { type: 'number' }, min_soc: { type: 'number' }, max_soc: { type: 'number' } }, additionalProperties: false } },
        { name: 'automation_list', description: 'Lista rotinas de energia (automations) do usuário.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'automation_create', description: 'Cria/atualiza uma rotina de energia.', parameters: { type: 'object', properties: { name: { type: 'string' }, enabled: { type: 'boolean' }, kind: { type: 'string' }, schedule: { type: 'object' }, conditions: { type: 'object' }, actions: { type: 'object' } }, required: ['name','kind','schedule','actions'], additionalProperties: false } },
        { name: 'automation_update', description: 'Atualiza uma rotina existente.', parameters: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' }, enabled: { type: 'boolean' }, kind: { type: 'string' }, schedule: { type: 'object' }, conditions: { type: 'object' }, actions: { type: 'object' } }, required: ['id'], additionalProperties: false } },
        { name: 'automation_delete', description: 'Remove uma rotina.', parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'], additionalProperties: false } },
        { name: 'automation_run', description: 'Executa (marca) uma rotina agora.', parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'], additionalProperties: false } },
        { name: 'eco_simulate', description: 'Simula economia: recomendações + custo projetado + estratégia de bateria.', parameters: { type: 'object', properties: { hours: { type: 'number' }, tariff_brl_per_kwh: { type: 'number' } }, additionalProperties: false } },
        { name: 'eco_execute', description: 'Economia rápida: desliga prioridade baixa (ou média) agora.', parameters: { type: 'object', properties: { priority: { type: 'string', enum: ['low','baixa','medium','media'] } }, additionalProperties: false } },
        { name: 'get_income_today', description: 'Retorna a renda agregada de hoje.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_total_income', description: 'Retorna a renda total acumulada da planta.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_generation', description: 'Retorna a geracao para um intervalo padrao.', parameters: { type: 'object', properties: { range: { type: 'string', enum: ['today','yesterday','this_week','this_month','total'] } }, required: ['range'], additionalProperties: false } },
        { name: 'get_monitor', description: 'QueryPowerStationMonitor', parameters: { type: 'object', properties: { page_index: { type: 'number' }, page_size: { type: 'number' }, key: { type: 'string' }, orderby: { type: 'string' }, powerstation_type: { type: 'string' }, powerstation_status: { type: 'string' }, adcode: { type: 'string' }, org_id: { type: 'string' }, condition: { type: 'string' } }, additionalProperties: false } },
        { name: 'get_inverters', description: 'GetInverterAllPoint', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_weather', description: 'GetWeather', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_powerflow', description: 'GetPowerflow', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_evcharger_count', description: 'GetEvChargerCountByPwId', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_plant_detail', description: 'GetPlantDetailByPowerstationId', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'get_chart_by_plant', description: 'Charts/GetChartByPlant', parameters: { type: 'object', properties: { date: { type: 'string' }, range: { type: 'number' }, chartIndexId: { type: 'string' }, isDetailFull: { type: 'boolean' } }, additionalProperties: false } },
        { name: 'get_power_chart', description: 'Charts/GetPlantPowerChart', parameters: { type: 'object', properties: { date: { type: 'string' }, full_script: { type: 'boolean' } }, additionalProperties: false } },
        { name: 'get_warnings', description: 'warning/PowerstationWarningsQuery', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'list_powerstations', description: 'Lista powerstations locais', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'set_powerstation_name', description: 'Define nome comercial local para powerstation', parameters: { type: 'object', properties: { id: { type: 'string' }, name: { type: ['string','null'] } }, required: ['id'], additionalProperties: false } },
        { name: 'debug_auth', description: 'Info GoodWe no servidor (mascarado)', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'cross_login', description: 'Executa CrossLogin GoodWe', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'st_list_devices', description: 'Lista dispositivos do SmartThings vinculados ao usuario atual.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'st_device_status', description: 'Status de um dispositivo SmartThings.', parameters: { type: 'object', properties: { device_id: { type: 'string' } }, required: ['device_id'], additionalProperties: false } },
        { name: 'st_command', description: 'Liga/Desliga um device SmartThings.', parameters: { type: 'object', properties: { device_id: { type: 'string' }, action: { type: 'string', enum: ['on','off'] }, component: { type: 'string' } }, required: ['device_id','action'], additionalProperties: false } },
        { name: 'st_find_device_room', description: 'Encontra o comodo (nome) de um dispositivo SmartThings (por nome ou id).', parameters: { type: 'object', properties: { query: { type: 'string' }, device_id: { type: 'string' } }, additionalProperties: false } },
        { name: 'tuya_list_devices', description: 'Lista dispositivos Tuya vinculados (Smart Life e/ou Tuya app).', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'tuya_device_status', description: 'Status de um device Tuya.', parameters: { type: 'object', properties: { device_id: { type: 'string' } }, required: ['device_id'], additionalProperties: false } },
        { name: 'habits_list', description: 'Lista habitos detectados (padroes) com estado.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
        { name: 'habits_logs', description: 'Timeline dos habitos (ultimos eventos).', parameters: { type: 'object', properties: { limit: { type: 'number' }, pattern_id: { type: 'number' } }, additionalProperties: false } },
        { name: 'habit_set_state', description: 'Altera estado de um habito (shadow|suggested|active|paused|retired).', parameters: { type: 'object', properties: { id: { type: 'number' }, state: { type: 'string', enum: ['shadow','suggested','active','paused','retired'] } }, required: ['id','state'], additionalProperties: false } },
        { name: 'habit_undo', description: 'Desfaz a ultima acao aplicada a um habito.', parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'], additionalProperties: false } },
        { name: 'tuya_command', description: 'Liga/Desliga um device Tuya.', parameters: { type: 'object', properties: { device_id: { type: 'string' }, action: { type: 'string', enum: ['on','off'] } }, required: ['device_id','action'], additionalProperties: false } },
      ];

      // Build conversation messages
      const messages = [
        { role: 'system', content: 'Você é o Assistente do painel. Responda em pt-BR, de forma breve, direta e útil. Não use markdown nem *. Use ferramentas quando precisar de dados reais.' },
        ...prev.filter(m => m && m.role && m.content),
        input ? { role: 'user', content: input } : null,
      ].filter(Boolean);

      const steps = [];
      const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
      const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const openaiTimeout = Number(process.env.ASSIST_OPENAI_TIMEOUT_MS || process.env.TIMEOUT_MS || 30000);

      async function callOpenAI(msgs){
        const payload = { model: MODEL, messages: msgs, tools: toolSchemas.map(t => ({ type: 'function', function: t })), tool_choice: 'auto', temperature: 0.2 };
        const r = await fetch(OPENAI_URL, { method: 'POST', headers: { 'Authorization': 'Bearer ' + OPENAI_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(openaiTimeout) });
        if (!r.ok) throw new Error('OpenAI HTTP ' + r.status);
        return r.json();
      }

      let msg = null; let round = 0;
      while (round < 2) {
        round++;
        const data = await callOpenAI(messages);
        msg = data?.choices?.[0]?.message || null;
        if (!msg) break;
        if (msg.tool_calls && msg.tool_calls.length) {
          messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
          for (const call of msg.tool_calls) {
            const name = call.function?.name; let args = {};
            try { args = JSON.parse(call.function?.arguments || '{}'); } catch {}
            let result;
            try { const started = Date.now(); result = await (typeof tools[name] === 'function' ? tools[name](args||{}) : Promise.reject(new Error('unknown tool'))); steps.push({ name, args, ok:true, result, ms: Date.now()-started }); }
            catch (e) { steps.push({ name, args, ok:false, error: String(e) }); result = { ok:false, error:String(e) }; }
            messages.push({ role:'tool', tool_call_id: call.id, name, content: JSON.stringify(result) });
          }
          continue;
        }
        break;
      }

      let answer = msg?.content || '';
      if (!answer && !steps.length) {
        answer = 'Certo! Como posso ajudar no painel?';
      }
      return res.json({ ok:true, answer, steps });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e) });
    }
  });

  router.get('/assistant/help', (req, res) => {
    const SYSTEM_PROMPT = `Você é o Assistente Virtual deste painel.
Regras:
1) Use ferramentas para dados reais (renda, geração, métricas, status, dispositivos).
2) Não invente valores; se faltar permissão/credencial, solicite conexão/login.
3) Métricas: cite apenas o período (Hoje/Ontem/Esta Semana/Este Mês/Total).
4) Ao listar dispositivos, responda apenas os nomes (um por linha).
5) Nunca utilize o caractere * e não use markdown/bold.
6) Seja breve, direto e útil. Idioma: pt-BR.`;
    res.json({ system_prompt: SYSTEM_PROMPT });
  });

  router.get('/assistant/help', (req, res) => {
    const SYSTEM_PROMPT = `VocÃª Ã© o Assistente Virtual deste painel.
Regras:
1) Use ferramentas para dados reais (renda, geração, métricas, status, dispositivos).
2) Não invente valores; se faltar permissão/credencial, solicite conexão/login.
3) Métricas: cite apenas o período (Hoje/Ontem/Esta Semana/Este Mês/Total).
4) Ao listar dispositivos, responda apenas os nomes (um por linha).
5) Nunca utilize o caractere * e nÃ£o use markdown/bold.
6) Seja breve, direto e Ãºtil. Idioma: pt-BR.`;
    res.json({ system_prompt: SYSTEM_PROMPT });
  });

  router.get('/assistant/ping', (req, res) => {
    const auth = gw.auth || null;
    res.json({ ok: true, hasAuth: !!auth, api_base: auth?.api_base || null, ts: Date.now() });
  });

  router.get('/assistant/health', (req, res) => {
    res.json({ ok: true, hasKey: !!(process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY) });
  });
}


