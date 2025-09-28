import mqtt from 'mqtt';

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function startMqttPublisher({ gw, dbApi }) {
  const url = process.env.MQTT_URL || '';
  if (!url) {
    console.warn('[mqtt] MQTT_URL not set; MQTT integration disabled');
    return;
  }

  const plantId = String(
    process.env.MQTT_PLANT_ID ||
    process.env.PLANT_ID ||
    process.env.ASSIST_PLANT_ID ||
    (dbApi.listPowerstations?.()[0]?.id || '')
  );
  if (!plantId) {
    console.warn('[mqtt] No plant id (set MQTT_PLANT_ID/PLANT_ID). MQTT disabled');
    return;
  }

  const prefix = (process.env.MQTT_PREFIX || 'goodwe').replace(/\/$/, '');
  const discPrefix = (process.env.MQTT_DISCOVERY_PREFIX || 'homeassistant').replace(/\/$/, '');
  const intervalMs = Math.max(2000, Number(process.env.MQTT_INTERVAL_MS || 10000));
  const clientId = (process.env.MQTT_CLIENT_ID || `goodwe-${Math.random().toString(16).slice(2, 8)}`);

  const opts = {
    clientId,
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    clean: true,
  };

  const c = mqtt.connect(url, opts);

  c.on('connect', async () => {
    console.log('[mqtt] connected');
    try { await gw.ensureAuth(); } catch {}

    const dev = {
      identifiers: [plantId],
      name: process.env.MQTT_DEVICE_NAME || 'GoodWe Plant',
      manufacturer: 'GoodWe',
      model: 'SEMS',
    };

    const base = `${prefix}/${plantId}`;
    const stateTopic = `${base}/state`;

    // Publish discovery for a handful of useful sensors using value_template from JSON
    const sensors = [
      { key: 'pv_power', name: 'PV Power', unit: 'W', device_class: 'power' },
      { key: 'load_power', name: 'Load Power', unit: 'W', device_class: 'power' },
      { key: 'grid_power', name: 'Grid Power', unit: 'W', device_class: 'power' },
      { key: 'battery_power', name: 'Battery Power', unit: 'W', device_class: 'power' },
      { key: 'soc', name: 'Battery SOC', unit: '%', device_class: 'battery' },
      { key: 'today_generation_kwh', name: 'Generation Today', unit: 'kWh', device_class: 'energy', state_class: 'total_increasing' },
    ];
    for (const s of sensors) {
      const uid = `${plantId}_${s.key}`;
      const topic = `${discPrefix}/sensor/${uid}/config`;
      const payload = {
        name: s.name,
        unique_id: uid,
        state_topic: stateTopic,
        value_template: `{{ value_json.${s.key} }}`,
        unit_of_measurement: s.unit,
        device: dev,
      };
      if (s.device_class) payload.device_class = s.device_class;
      if (s.state_class) payload.state_class = s.state_class;
      c.publish(topic, JSON.stringify(payload), { retain: true, qos: 1 });
    }

    // Periodic publisher
    async function tick(){
      try {
        const psId = plantId;
        const power = await gw.postJson('v2/PowerStation/GetPowerflow', { PowerStationId: psId }).catch(()=>null);
        const jMon = await gw.postJson('PowerStationMonitor/QueryPowerStationMonitor', {
          powerstation_id: psId, key: '', orderby: '', powerstation_type: '', powerstation_status: '', page_index: 1, page_size: 1, adcode: '', org_id: '', condition: ''
        }).catch(()=>null);

        // Try to normalize fields
        const d = power?.data || power || {};
        const pv = num(d.pv_power ?? d.pv2power ?? d.pv_input ?? 0);
        const load = num(d.load_power ?? d.loadpower ?? d.load ?? 0);
        const grid = num(d.grid_power ?? d.gridpower ?? d.grid ?? 0);
        const batt = num(d.battery_power ?? d.batterypower ?? d.batt ?? 0);
        const soc = num(d.soc ?? d.battery_soc ?? 0);

        const it = jMon?.data?.list?.[0] || {};
        const genToday = num(it.eday ?? it.eday_kwh ?? 0);

        const state = {
          plant_id: psId,
          pv_power: pv,
          load_power: load,
          grid_power: grid,
          battery_power: batt,
          soc,
          today_generation_kwh: genToday,
          ts: Date.now(),
        };
        c.publish(stateTopic, JSON.stringify(state), { retain: false, qos: 0 });
      } catch (e) {
        // ignore
      }
    }
    tick();
    const id = setInterval(tick, intervalMs);
    c.on('close', ()=> clearInterval(id));
  });

  c.on('error', (e) => {
    console.error('[mqtt] error', e?.message || e);
  });
}

