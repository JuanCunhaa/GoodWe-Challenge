router.post('/assistant/chat', async (req, res) => {
    try {
        const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || '';
        if (!OPENAI_API_KEY) return res.status(501).json({ ok: false, error: 'assistant unavailable: missing OPENAI_API_KEY' });
        // Allow either authenticated app users OR a service token (ASSIST_TOKEN) for Alexa/automation
        const bearer = getBearerToken(req);
        const svcToken = process.env.ASSIST_TOKEN || '';
        let user = null;
        if (svcToken && bearer === svcToken) {
            // Service-mode: plant id can come from query or env (ASSIST_PLANT_ID/PLANT_ID)
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

        // Tool registry
        const tools = {
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
                const norm = (s) => String(s || '')
                    .toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '');
                const mapXY = (arr) => { const m = new Map(); (arr || []).forEach(p => { const k = String(p?.x || ''); if (k) m.set(k, Number(p?.y) || 0) }); return m };
                const parseGenFromChart = async (refDate) => {
                    const body = { id: psId, date: dateLocal(refDate), range: 2, chartIndexId: '8', isDetailFull: false };
                    const j = await gw.postJson('v2/Charts/GetChartByPlant', body);
                    const lines = j?.data?.lines || [];
                    const by = {}; for (const l of lines) { by[norm(l.label || l.name)] = l.xy || [] }
                    let genArr = by['generationkwh'] || by['generatekwh'] || by['pvgenerationkwh'] || by['pvkwh'] || null;
                    if (!genArr) {
                        const k = Object.keys(by).find(k => k.includes('generation'));
                        if (k) genArr = by[k];
                    }
                    const genMap = genArr ? mapXY(genArr) : new Map();
                    const inHouseMap = mapXY(by['inhousekwh'] || by['selfusekwh'] || []);
                    const gridSellMap = mapXY(by['gridkwhsell'] || by['gridwkwhsell'] || by['gridsellkwh'] || by['sellkwh'] || []);
                    return { genMap, inHouseMap, gridSellMap };
                };

                if (range === 'total') {
                    const det = await gw.postForm('v3/PowerStation/GetPlantDetailByPowerstationId', { powerStationId: psId });
                    const etotal = Number(det?.data?.kpi?.etotal ?? det?.data?.info?.etotal ?? 0);
                    return { kwh: etotal, period: 'total', source: '/api/plant-detail' };
                }

                if (range === 'this_month') {
                    const { genMap, inHouseMap, gridSellMap } = await parseGenFromChart(today);
                    const ym = dateLocal(today).slice(0, 7);
                    let sum = 0;
                    for (const [k, v] of genMap.entries()) {
                        if (k.startsWith(ym)) sum += Number(v) || 0;
                    }
                    // fallback: soma inHouse + gridSell se não houver genMap
                    if (sum === 0) {
                        for (const [k, v] of inHouseMap.entries()) {
                            if (k.startsWith(ym)) sum += Number(v) || 0;
                        }
                        for (const [k, v] of gridSellMap.entries()) {
                            if (k.startsWith(ym)) sum += Number(v) || 0;
                        }
                    }
                    return { kwh: sum, period: 'this_month', source: '/api/chart-by-plant?range=2' };
                }

                if (range === 'this_week') {
                    const { genMap, inHouseMap, gridSellMap } = await parseGenFromChart(today);
                    // calcula início da semana (domingo) e fim (sábado)
                    const base = new Date(today);
                    const day = base.getDay();
                    const startD = new Date(base); startD.setDate(base.getDate() - day);
                    const endD = new Date(startD); endD.setDate(startD.getDate() + 6);
                    let sum = 0;
                    for (const [k, v] of genMap.entries()) {
                        const d = new Date(k + 'T00:00:00');
                        if (d >= startD && d <= endD) sum += Number(v) || 0;
                    }
                    if (sum === 0) {
                        for (const [k, v] of inHouseMap.entries()) {
                            const d = new Date(k + 'T00:00:00');
                            if (d >= startD && d <= endD) sum += Number(v) || 0;
                        }
                        for (const [k, v] of gridSellMap.entries()) {
                            const d = new Date(k + 'T00:00:00');
                            if (d >= startD && d <= endD) sum += Number(v) || 0;
                        }
                    }
                    return { kwh: sum, period: 'this_week', source: '/api/chart-by-plant?range=2' };
                }

                if (range === 'yesterday') {
                    const { genMap, inHouseMap, gridSellMap } = await parseGenFromChart(today);
                    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
                    const yKey = dateLocal(yesterday);
                    let val = Number(genMap.get(yKey)) || 0;
                    if (!val) val = (Number(inHouseMap.get(yKey)) || 0) + (Number(gridSellMap.get(yKey)) || 0);
                    return { kwh: val, period: 'yesterday', date: yKey, source: '/api/chart-by-plant?range=2' };
                }

                if (range === 'today') {
                    // Usa o endpoint correto para geração do dia
                    const body = { powerstation_id: psId, key: '', orderby: '', powerstation_type: '', powerstation_status: '', page_index: 1, page_size: 14, adcode: '', org_id: '', condition: '' };
                    const j = await gw.postJson('PowerStationMonitor/QueryPowerStationMonitor', body);
                    // Como só vem a planta certa, pega o primeiro item
                    const it = j?.data?.list?.[0] || {};
                    const kwh = Number(it?.eday ?? it?.eday_kwh ?? 0);
                    const today = new Date();
                    const pad = (n) => String(n).padStart(2, '0');
                    const dateLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                    return { kwh, period: 'today', date: dateLocal(today), source: '/api/monitor' };
                }

                return { kwh: 0, period: range, note: 'unsupported range' };
            },
            async eval_code({ language, code, timeout_ms }) {
                const lang = String(language || '').toLowerCase();
                if (lang && !['js', 'javascript', 'node'].includes(lang)) {
                    return { ok: false, error: `language not supported: ${language}` };
                }
                const vm = await import('node:vm');
                const output = [];
                const sandbox = { console: { log: (...a) => output.push(a.join(' ')) } };
                try {
                    const script = new vm.Script(String(code || ''));
                    const ctx = vm.createContext(sandbox);
                    script.runInContext(ctx, { timeout: Math.min(Number(timeout_ms || 1000), 5000) });
                    return { ok: true, stdout: output.join('\n'), stderr: '', exit_code: 0 };
                } catch (e) {
                    return { ok: false, stdout: output.join('\n'), stderr: String(e), exit_code: 1 };
                }
            },
            async get_monitor({ page_index = 1, page_size = 14, key = '', orderby = '', powerstation_type = '', powerstation_status = '', adcode = '', org_id = '', condition = '' } = {}) {
                const body = { powerstation_id: psId, key, orderby, powerstation_type, powerstation_status, page_index: Number(page_index), page_size: Number(page_size), adcode, org_id, condition };
                const j = await gw.postJson('PowerStationMonitor/QueryPowerStationMonitor', body);
                return j;
            },
            async get_inverters() {
                const j = await gw.postForm('v3/PowerStation/GetInverterAllPoint', { powerStationId: psId });
                return j;
            },
            async get_weather() {
                const j = await gw.postForm('v3/PowerStation/GetWeather', { powerStationId: psId });
                return j;
            },
            async get_powerflow() {
                const j = await gw.postJson('v2/PowerStation/GetPowerflow', { PowerStationId: psId });
                return j;
            },
            async get_evcharger_count() {
                const j = await gw.postJson('v4/EvCharger/GetEvChargerCountByPwId', { PowerStationId: psId });
                return j;
            },
            async get_plant_detail() {
                const j = await gw.postForm('v3/PowerStation/GetPlantDetailByPowerstationId', { powerStationId: psId });
                return j;
            },
            async get_chart_by_plant({ date = '', range = 2, chartIndexId = '8', isDetailFull = false } = {}) {
                const body = { id: psId, date, range: Number(range), chartIndexId: String(chartIndexId), isDetailFull: !!isDetailFull };
                const j = await gw.postJson('v2/Charts/GetChartByPlant', body);
                return j;
            },
            async get_power_chart({ date = '', full_script = true } = {}) {
                const body = { id: psId, date, full_script: !!full_script };
                const j = await gw.postJson('v2/Charts/GetPlantPowerChart', body);
                return j;
            },
            async get_warnings() {
                let j = await gw.postForm('warning/PowerstationWarningsQuery', { pw_id: psId });
                if (String(j?.code) !== '0') {
                    try { j = await gw.postAbsoluteForm('https://eu.semsportal.com/api/warning/PowerstationWarningsQuery', { pw_id: psId }); } catch { }
                    if (String(j?.code) !== '0') j = await gw.postAbsoluteForm('https://us.semsportal.com/api/warning/PowerstationWarningsQuery', { pw_id: psId });
                }
                return j;
            },
            async get_monitor_abs({ url, key = '', orderby = '', powerstation_type = '', powerstation_status = '', page_index = 1, page_size = 14, adcode = '', org_id = '', condition = '' } = {}) {
                if (!url) return { ok: false, error: 'url is required' };
                const body = { powerstation_id: psId, key, orderby, powerstation_type, powerstation_status, page_index: Number(page_index), page_size: Number(page_size), adcode, org_id, condition };
                const j = await gw.postAbsoluteJson(url, body);
                return j;
            },
            async list_powerstations() {
                const items = await dbApi.listPowerstations();
                return { items };
            },
            async set_powerstation_name({ id, name }) {
                if (!id) return { ok: false, error: 'id required' };
                await dbApi.upsertBusinessName(id, name || null);
                return { ok: true };
            },
            async debug_auth() {
                const auth = gw.auth || null;
                const cookies = Object.keys(gw.cookies || {});
                const tokenHeader = gw.tokenHeaderValue || null;
                const mask = (s) => (typeof s === 'string' && s.length > 12) ? `${s.slice(0, 8)}...${s.slice(-4)}` : s;
                return {
                    hasAuth: !!auth,
                    api_base: auth?.api_base || null,
                    uid: auth?.uid || null,
                    token_present: !!auth?.token,
                    timestamp: auth?.timestamp || null,
                    cookies,
                    token_header_length: tokenHeader ? tokenHeader.length : 0,
                    token_header_preview: tokenHeader ? tokenHeader.slice(0, 64) + '...' : null,
                    token_mask: auth?.token ? mask(auth.token) : null,
                };
            },
            async cross_login() {
                const a = await gw.crossLogin();
                return { api_base: a.api_base, uid: a.uid, timestamp: a.timestamp };
            },
            async cross_login_raw({ version = 'auto' } = {}) {
                const raw = await gw.crossLoginRaw({ version: String(version) });
                return raw;
            },
        };

        const toolSchemas = [
            { name: 'get_income_today', description: 'Retorna a renda agregada de hoje.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
            { name: 'get_total_income', description: 'Retorna a renda total acumulada da planta.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
            { name: 'get_generation', description: 'Retorna a geração para um intervalo padrão.', parameters: { type: 'object', properties: { range: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month', 'total'] } }, required: ['range'], additionalProperties: false } },
            { name: 'eval_code', description: 'Executa código JS em sandbox e retorna stdout/stderr/exit_code.', parameters: { type: 'object', properties: { language: { type: 'string' }, code: { type: 'string' }, timeout_ms: { type: 'number' } }, required: ['code'], additionalProperties: false } },
            { name: 'get_monitor', description: 'QueryPowerStationMonitor', parameters: { type: 'object', properties: { page_index: { type: 'number' }, page_size: { type: 'number' }, key: { type: 'string' }, orderby: { type: 'string' }, powerstation_type: { type: 'string' }, powerstation_status: { type: 'string' }, adcode: { type: 'string' }, org_id: { type: 'string' }, condition: { type: 'string' } }, additionalProperties: false } },
            { name: 'get_inverters', description: 'GetInverterAllPoint', parameters: { type: 'object', properties: {}, additionalProperties: false } },
            { name: 'get_weather', description: 'GetWeather', parameters: { type: 'object', properties: {}, additionalProperties: false } },
            { name: 'get_powerflow', description: 'GetPowerflow', parameters: { type: 'object', properties: {}, additionalProperties: false } },
            { name: 'get_evcharger_count', description: 'GetEvChargerCountByPwId', parameters: { type: 'object', properties: {}, additionalProperties: false } },
            { name: 'get_plant_detail', description: 'GetPlantDetailByPowerstationId', parameters: { type: 'object', properties: {}, additionalProperties: false } },
            { name: 'get_chart_by_plant', description: 'Charts/GetChartByPlant', parameters: { type: 'object', properties: { date: { type: 'string' }, range: { type: 'number' }, chartIndexId: { type: 'string' }, isDetailFull: { type: 'boolean' } }, additionalProperties: false } },
            { name: 'get_power_chart', description: 'Charts/GetPlantPowerChart', parameters: { type: 'object', properties: { date: { type: 'string' }, full_script: { type: 'boolean' } }, additionalProperties: false } },
            { name: 'get_warnings', description: 'warning/PowerstationWarningsQuery', parameters: { type: 'object', properties: {}, additionalProperties: false } },
            { name: 'get_monitor_abs', description: 'Absolute monitor via components.api port', parameters: { type: 'object', properties: { url: { type: 'string' }, key: { type: 'string' }, orderby: { type: 'string' }, powerstation_type: { type: 'string' }, powerstation_status: { type: 'string' }, page_index: { type: 'number' }, page_size: { type: 'number' }, adcode: { type: 'string' }, org_id: { type: 'string' }, condition: { type: 'string' } }, required: ['url'], additionalProperties: false } },
            { name: 'list_powerstations', description: 'Lista powerstations locais', parameters: { type: 'object', properties: {}, additionalProperties: false } },
            { name: 'set_powerstation_name', description: 'Define nome comercial local para powerstation', parameters: { type: 'object', properties: { id: { type: 'string' }, name: { type: ['string', 'null'] } }, required: ['id'], additionalProperties: false } },
            { name: 'debug_auth', description: 'Info de autenticação GoodWe no servidor (token/cookies mascarados)', parameters: { type: 'object', properties: {}, additionalProperties: false } },
            { name: 'cross_login', description: 'Executa CrossLogin GoodWe', parameters: { type: 'object', properties: {}, additionalProperties: false } },
            { name: 'cross_login_raw', description: 'Retorna JSON cru do CrossLogin SEMS', parameters: { type: 'object', properties: { version: { type: 'string' } }, additionalProperties: false } },
        ];

        const SYSTEM_PROMPT = `Você é o Assistente Virtual deste painel. Siga as regras:
Use ferramentas registradas sempre que a pergunta demandar dados reais (renda, geração, métricas, status, etc.).
Não invente valores. Se faltar permissão/credencial, peça para o usuário conectar/entrar.
Ao responder métricas, informe apenas o período (ex.: Hoje, Ontem, Esta Semana, Este Mês, Total), sem incluir a data por extenso ou o local/origem dos dados (não cite endpoints, APIs ou fontes técnicas).
Seja breve, direto e útil. Liste passos acionáveis quando fizer sentido.
Idioma padrão: pt-BR; use o tom do produto; não exponha segredos.
Nunca utilize o caractere ** em nenhuma resposta.
Nunca utilize o caractere ** em nenhuma resposta.
Se qualquer valor de renda ou preço vier em moeda diferente de BRL, sempre converta e informe também o valor equivalente em BRL usando as seguintes cotações fixas:
USD para BRL: 5.50
EUR para BRL: 6.00
GBP para BRL: 7.00
CNY para BRL: 0.80
Exemplo: " US$ 10 = R$ 55,00"`;
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...prev.filter(m => m && m.role && m.content),
            input ? { role: 'user', content: input } : null,
        ].filter(Boolean);

        const steps = [];
        let assistantMsg = null;
        let attempts = 0;
        while (attempts < 3) {
            attempts++;
            const payload = {
                model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
                messages,
                tools: toolSchemas.map(t => ({ type: 'function', function: t })),
                tool_choice: 'auto',
                temperature: 0.2,
            };
            const r = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)),
            });
            if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}`);
            const data = await r.json();
            const msg = data?.choices?.[0]?.message;
            if (!msg) throw new Error('OpenAI: missing message');
            if (msg.tool_calls && msg.tool_calls.length) {
                // Record assistant msg with tool calls
                messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
                for (const call of msg.tool_calls) {
                    const name = call.function?.name;
                    let args = {};
                    try { args = JSON.parse(call.function?.arguments || '{}'); } catch { }
                    let result;
                    try {
                        if (typeof tools[name] !== 'function') throw new Error('unknown tool');
                        const started = Date.now();
                        result = await tools[name](args || {});
                        steps.push({ name, args, ok: true, ms: Date.now() - started });
                    } catch (e) {
                        result = { ok: false, error: String(e) };
                        steps.push({ name, args, ok: false, error: String(e) });
                    }
                    messages.push({ role: 'tool', tool_call_id: call.id, name, content: JSON.stringify(result) });
                }
                continue; // loop again with tool results
            }
            assistantMsg = msg;
            break;
        }

        const answer = assistantMsg?.content || '';
        res.json({ ok: true, answer, steps });
    } catch (e) {
        res.status(500).json({ ok: false, error: String(e) });
    }
});

router.get('/assistant/tools', (req, res) => {
    try {
        const items = [
            { name: 'get_income_today', description: 'Retorna a renda agregada de hoje.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
            { name: 'get_total_income', description: 'Retorna a renda total acumulada da planta.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
            { name: 'get_generation', description: 'Retorna a geração para um intervalo padrão.', parameters: { type: 'object', properties: { range: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month', 'total'] } }, required: ['range'], additionalProperties: false } },
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
            { name: 'set_powerstation_name', description: 'Define nome comercial local para powerstation', parameters: { type: 'object', properties: { id: { type: 'string' }, name: { type: ['string', 'null'] } }, required: ['id'], additionalProperties: false } },
            { name: 'debug_auth', description: 'Info de autenticação GoodWe no servidor (token/cookies mascarados)', parameters: { type: 'object', properties: {}, additionalProperties: false } },
            { name: 'cross_login', description: 'Executa CrossLogin GoodWe', parameters: { type: 'object', properties: {}, additionalProperties: false } },
            { name: 'cross_login_raw', description: 'Retorna JSON cru do CrossLogin SEMS', parameters: { type: 'object', properties: { version: { type: 'string' } }, additionalProperties: false } },
        ];
        res.json({ items });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }) }
});

router.get('/assistant/help', (req, res) => {
    const SYSTEM_PROMPT = `Você é o Assistente Virtual deste painel. Regras:
1) Use ferramentas para dados reais (renda, geração, métricas, status).
2) Não invente valores; se faltar permissão, peça login/conexão.
3) Métricas: cite só o período (Hoje/Ontem/Esta Semana/Este Mês/Total).
4) Seja curto e prático; use listas quando ajudar.
5) Idioma: pt-BR; não exponha segredos.`;
    res.json({ system_prompt: SYSTEM_PROMPT });
});

router.get('/assistant/ping', (req, res) => {
    const auth = gw.auth || null;
    res.json({ ok: true, hasAuth: !!auth, api_base: auth?.api_base || null, ts: Date.now() });
});

  router.get('/assistant/health', (req, res) => {
    res.json({ ok: true, hasKey: !!(process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY) });
  });