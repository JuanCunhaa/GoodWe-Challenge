export function registerGoodWeRoutes(router, { gw, helpers }) {
  const { tryGetUser, getPsId } = helpers;

  router.get('/debug/auth', (req, res) => {
    const auth = gw.auth || null;
    const cookies = Object.keys(gw.cookies || {});
    const tokenHeader = gw.tokenHeaderValue || null;
    const mask = (s) => (typeof s === 'string' && s.length > 12) ? `${s.slice(0, 8)}...${s.slice(-4)}` : s;
    res.json({
      hasAuth: !!auth,
      api_base: auth?.api_base || null,
      uid: auth?.uid || null,
      token_present: !!auth?.token,
      timestamp: auth?.timestamp || null,
      cookies,
      token_header_length: tokenHeader ? tokenHeader.length : 0,
      token_header_preview: tokenHeader ? tokenHeader.slice(0, 64) + '...' : null,
      token_mask: auth?.token ? mask(auth.token) : null,
    });
  });

  router.post('/auth/crosslogin', async (req, res) => {
    try {
      const auth = await gw.crossLogin();
      res.json({ ok: true, auth: { api_base: auth.api_base, uid: auth.uid, timestamp: auth.timestamp } });
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });

  router.post('/auth/crosslogin/raw', async (req, res) => {
    try {
      const ver = (req.query.ver || req.body?.ver || 'auto');
      const raw = await gw.crossLoginRaw({ version: String(ver) });
      res.json(raw);
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });

  router.get('/monitor', async (req, res) => {
    const body = {
      powerstation_id: await getPsId(req),
      key: req.query.key || '', orderby: req.query.orderby || '',
      powerstation_type: req.query.powerstation_type || '',
      powerstation_status: req.query.powerstation_status || '',
      page_index: Number(req.query.page_index || 1), page_size: Number(req.query.page_size || 14),
      adcode: req.query.adcode || '', org_id: req.query.org_id || '', condition: req.query.condition || '',
    };
    try { const j = await gw.postJson('PowerStationMonitor/QueryPowerStationMonitor', body); res.json(j); }
    catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });

  router.get('/inverters', async (req, res) => {
    const psId = await getPsId(req);
    try { const j = await gw.postForm('v3/PowerStation/GetInverterAllPoint', { powerStationId: psId }); res.json(j); }
    catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });

  router.get('/monitor-abs', async (req, res) => {
    const url = req.query.url;
    const powerstation_id = req.query.powerstation_id || req.query.pw_id || '';
    if (!url) return res.status(400).json({ ok: false, error: 'url is required' });
    try {
      const j = await gw.postAbsoluteJson(url, {
        powerstation_id,
        key: req.query.key || '', orderby: req.query.orderby || '',
        powerstation_type: req.query.powerstation_type || '', powerstation_status: req.query.powerstation_status || '',
        page_index: Number(req.query.page_index || 1), page_size: Number(req.query.page_size || 14),
        adcode: req.query.adcode || '', org_id: req.query.org_id || '', condition: req.query.condition || '',
      });
      res.json(j);
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });

  router.get('/weather', async (req, res) => {
    const psId = await getPsId(req);
    try { const j = await gw.postForm('v3/PowerStation/GetWeather', { powerStationId: psId }); res.json(j); }
    catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });

  router.get('/powerflow', async (req, res) => {
    const psId = await getPsId(req);
    try { const j = await gw.postJson('v2/PowerStation/GetPowerflow', { PowerStationId: psId }); res.json(j); }
    catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });

  router.get('/evchargers/count', async (req, res) => {
    const psId = await getPsId(req);
    try { const j = await gw.postJson('v4/EvCharger/GetEvChargerCountByPwId', { PowerStationId: psId }); res.json(j); }
    catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });

  router.get('/chart-by-plant', async (req, res) => {
    const user = await tryGetUser(req);
    const id = req.query.id || req.query.plant_id || user?.powerstation_id || '';
    const date = req.query.date || '';
    const range = req.query.range || '2';
    const chartIndexId = req.query.chartIndexId || '8';
    try {
      const body = { id, date, range: Number(range), chartIndexId: String(chartIndexId), isDetailFull: false };
      const j = await gw.postJson('v2/Charts/GetChartByPlant', body);
      res.json(j);
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });

  router.get('/plant-detail', async (req, res) => {
    const psId = await getPsId(req);
    try { const j = await gw.postForm('v3/PowerStation/GetPlantDetailByPowerstationId', { powerStationId: psId }); res.json(j); }
    catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });

  router.get('/power-chart', async (req, res) => {
    const user = await tryGetUser(req);
    const id = req.query.plant_id || req.query.id || user?.powerstation_id || '';
    const date = req.query.date || '';
    const full_script = String(req.query.full_script || 'true') === 'true';
    const payload = { id, date, full_script };
    try { const j = await gw.postJson('v2/Charts/GetPlantPowerChart', payload); res.json(j); }
    catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });

  router.get('/warnings', async (req, res) => {
    const pwId = await getPsId(req);
    try {
      let j = await gw.postForm('warning/PowerstationWarningsQuery', { pw_id: pwId });
      if (String(j?.code) !== '0') {
        try { j = await gw.postAbsoluteForm('https://eu.semsportal.com/api/warning/PowerstationWarningsQuery', { pw_id: pwId }); } catch { }
        if (String(j?.code) !== '0') {
          j = await gw.postAbsoluteForm('https://us.semsportal.com/api/warning/PowerstationWarningsQuery', { pw_id: pwId });
        }
      }
      res.json(j);
    } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
  });
}

