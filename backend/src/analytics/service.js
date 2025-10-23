import { initHistoryRepo } from './historyRepo.js';
import { getDbEngine } from '../db.js';

let repoPromise = null;
async function getRepo(){ if (!repoPromise) repoPromise = initHistoryRepo(); return repoPromise; }

function nextHoursList(hours){
  const n = Math.max(1, Number(hours||24));
  const arr = []; const base = new Date();
  base.setMinutes(0,0,0);
  for (let i=1;i<=n;i++){ const t = new Date(base); t.setHours(base.getHours()+i); arr.push(t); }
  return arr;
}

function adjustByWeather(genHourly, weather){
  try {
    const sky = (weather?.data?.weather?.forecast?.[0]?.skycon || '').toLowerCase();
    const clouds = weather?.data?.weather?.cloudrate; // 0..1 if present
    let factor = 1.0;
    if (typeof clouds === 'number') {
      factor = Math.max(0.3, 1 - (clouds*0.6));
    } else if (sky.includes('rain') || sky.includes('storm')) factor = 0.5;
    else if (sky.includes('cloud')) factor = 0.7;
    return genHourly.map(v => v*factor);
  } catch { return genHourly }
}

export async function getForecast({ plant_id, hours = 24, fetchWeather }){
  const repo = await getRepo();
  const genProfile = await repo.getHourlyProfile({ table: 'generation_history', plant_id, lookbackDays: 14 });
  const consProfile = await repo.getHourlyProfile({ table: 'consumption_history', plant_id, lookbackDays: 14 });

  const slots = nextHoursList(hours);
  // Base: average kWh per hour across recent days
  let hourlyGen = slots.map(t => genProfile.get(t.getHours()) || 0);
  const hourlyCons = slots.map(t => consProfile.get(t.getHours()) || 0);

  let weather = null;
  if (typeof fetchWeather === 'function'){
    try { weather = await fetchWeather(); } catch {}
  }
  // Apply daylight shaping using a simple sinus between sunrise/sunset (fallback 6-18)
  const dayShape = (() => {
    let sunrise = 6, sunset = 18;
    try {
      // Prefer sunrise/sunset from already-fetched weather if available
      const sr = weather?.data?.weather?.sunrise; const ss = weather?.data?.weather?.sunset;
      if (typeof sr === 'number' && typeof ss === 'number' && ss > sr) { sunrise = sr; sunset = ss; }
    } catch {}
    const arr = slots.map(t => {
      const h = t.getHours();
      if (h <= sunrise || h >= sunset) return 0;
      const x = (h - sunrise) / (sunset - sunrise);
      return Math.sin(Math.PI * x);
    });
    return arr;
  })();
  const genSum = hourlyGen.reduce((a,b)=>a+b,0);
  if (genSum < 0.01) {
    // Estimate daily energy from historical totals
    const days = await repo.getDailyTotals({ table: 'generation_history', plant_id, lookbackDays: 14 });
    const meanDaily = days.length ? (days.reduce((s,it)=>s+it.kwh,0)/days.length) : 0;
    const shapeSum = dayShape.reduce((a,b)=>a+b,0) || 1;
    hourlyGen = dayShape.map(v => (meanDaily * (v/shapeSum)));
  } else {
    // Blend a bit of shape to push generation to daylight hours
    const blend = 0.3;
    const baseSum = hourlyGen.reduce((a,b)=>a+b,0) || 1;
    const shapeSum = dayShape.reduce((a,b)=>a+b,0) || 1;
    const shaped = dayShape.map(v => (genSum * (v/shapeSum)));
    hourlyGen = hourlyGen.map((v,i)=> (1-blend)*v + blend*(shaped[i] * (v>0? v/baseSum : 1)));
  }
  const adjGen = weather ? adjustByWeather(hourlyGen, weather) : hourlyGen;

  const items = slots.map((t, i) => ({ time: t.toISOString(), generation_kwh: adjGen[i] || 0, consumption_kwh: hourlyCons[i] || 0 }));
  const total_generation_kwh = items.reduce((s,it)=> s + (it.generation_kwh||0), 0);
  const total_consumption_kwh = items.reduce((s,it)=> s + (it.consumption_kwh||0), 0);
  return { plant_id, hours: Number(hours||24), items, total_generation_kwh, total_consumption_kwh, weather_used: !!weather };
}

// Heuristic wattage guesser when power is not available
function guessWatts(name){
  const s = String(name||'').toLowerCase();
  const checks = [
    { k: ['ar condicionado','ar-condicionado','air conditioner','ac','split'], w: 900 },
    { k: ['tv','televis','smart tv'], w: 100 },
    { k: ['geladeira','fridge','refrigerador','freezer'], w: 150 },
    { k: ['micro-ondas','microondas','microwave'], w: 1200 },
    { k: ['chuveiro','shower'], w: 4500 },
    { k: ['maquina de lavar','máquina de lavar','lavadora'], w: 500 },
    { k: ['lamp','lâmp','lampada','lâmpada','bulb','ilumin'], w: 10 },
    { k: ['computador','pc','desktop'], w: 200 },
    { k: ['roteador','modem','router'], w: 12 },
    { k: ['ventilador','fan'], w: 60 },
  ];
  for (const c of checks){ if (c.k.some(x => s.includes(x))) return c.w; }
  return 60; // default small load
}

function isEssentialByName(name){
  const s = String(name||'').toLowerCase();
  const essential = ['geladeira','fridge','refrigerador','freezer'];
  return essential.some(x => s.includes(x));
}

export async function getRecommendations({ plant_id, fetchWeather, fetchDevices, fetchDeviceMeta, fetchRooms, tariff_brl_per_kwh }){
  const repo = await getRepo();
  const consDaily = await repo.getDailyTotals({ table: 'consumption_history', plant_id, lookbackDays: 30 });
  const byHour = await repo.getHourlyProfile({ table: 'consumption_history', plant_id, lookbackDays: 14 });

  const meanDaily = consDaily.length ? (consDaily.reduce((s,it)=> s+it.kwh, 0)/consDaily.length) : 0;
  const peakHours = [18,19,20,21,22];
  const peakAvg = peakHours.reduce((s,h)=> s + (byHour.get(h) || 0), 0) / peakHours.length;
  const baseHours = [10,11,12,13,14];
  const baseAvg = baseHours.reduce((s,h)=> s + (byHour.get(h) || 0), 0) / baseHours.length;
  const upliftPct = baseAvg>0 ? ((peakAvg - baseAvg)/baseAvg)*100 : (peakAvg>0?100:0);

  const recs = [];
  if (upliftPct > 10) {
    recs.push({
      text: `Seu consumo no horário de pico (18h–22h) está ${upliftPct.toFixed(0)}% acima do período de base. Considere desligar aparelhos não essenciais nesse horário.`,
      metric: { peak_avg_kwh: +peakAvg.toFixed(3), base_avg_kwh: +baseAvg.toFixed(3), uplift_pct: +upliftPct.toFixed(1) }
    });
  }

  if (meanDaily > 0) {
    recs.push({
      text: `Consumo médio diário de ${meanDaily.toFixed(1)} kWh. Priorize o uso de dispositivos não essenciais fora do pico para reduzir custo.`,
      metric: { mean_daily_kwh: +meanDaily.toFixed(2) }
    });
  }

  if (recs.length === 0) {
    recs.push({ text: 'Nenhum padrão crítico encontrado recentemente. Bons hábitos energéticos!', metric: {} });
  }

  // Climate-based advice (GoodWe weather)
  try {
    let weather = null;
    if (typeof fetchWeather === 'function') {
      weather = await fetchWeather();
    }
    const sky = String(weather?.data?.weather?.forecast?.[0]?.skycon || weather?.data?.weather?.skycon || '').toLowerCase();
    const clouds = Number(weather?.data?.weather?.cloudrate ?? NaN);
    let alert = null;
    if (!Number.isNaN(clouds) && clouds >= 0.8) alert = `Cobertura de nuvens muito alta (${Math.round(clouds*100)}%).`;
    else if (!Number.isNaN(clouds) && clouds >= 0.6) alert = `Céu nublado (${Math.round(clouds*100)}% de nuvens).`;
    if (sky.includes('storm')) alert = 'Tempestade prevista'; else if (sky.includes('rain')) alert = 'Chuva prevista';
    if (alert) {
      recs.unshift({ text: `${alert} Priorize recarga da bateria e adie cargas não essenciais no pico solar (11h–15h).`, metric: { sky, clouds: isFinite(clouds) ? +clouds.toFixed(2) : null } });
    }
  } catch {}

  // Device-aware suggestions (SmartThings/Tuya + estimativa quando não houver power)
  try {
    if (typeof fetchDevices === 'function'){
      const devices = await fetchDevices();
      const list = Array.isArray(devices?.items) ? devices.items : [];
      const metaMap = (typeof fetchDeviceMeta === 'function') ? (await fetchDeviceMeta()) : {};
      const roomsMap = (typeof fetchRooms === 'function') ? (await fetchRooms()) : {};

      // Prepare recent window data from device_history to infer top consumers
      const engine = getDbEngine();
      const until = new Date();
      const since = new Date(until.getTime() - 24*60*60*1000);
      let rows = [];
      if (engine.type === 'pg'){
        const sql = `SELECT vendor, device_id, name, room, ts, state_on, power_w, energy_wh FROM device_history WHERE ts >= $1 AND ts <= $2 ORDER BY vendor, device_id, ts ASC`;
        rows = (await engine.pgPool.query(sql, [since, until])).rows;
      } else {
        rows = engine.sqliteDb.prepare('SELECT vendor, device_id, name, room, ts, state_on, power_w, energy_wh FROM device_history WHERE ts >= ? AND ts <= ? ORDER BY vendor, device_id, ts ASC').all(since.toISOString(), until.toISOString());
      }
      const byDev = new Map();
      for (const r of rows){
        const key = `${r.vendor}|${r.device_id}`; if (!byDev.has(key)) byDev.set(key, []); byDev.get(key).push(r);
      }
      const agg = [];
      for (const d of list){
        const key = `${d.vendor}|${d.id}`;
        const samples = byDev.get(key) || [];
        // Compute on-time and energy estimate
        let totalMs = 0; let estWh = 0; let lastTs = null; let lastOn = null; let lastPower = null; let firstEnergy = null; let lastEnergy = null;
        for (let i=0;i<samples.length;i++){
          const s = samples[i];
          const ts = new Date(s.ts).getTime();
          if (firstEnergy==null && s.energy_wh!=null) firstEnergy = Number(s.energy_wh)||0;
          if (s.energy_wh!=null) lastEnergy = Number(s.energy_wh)||0;
          if (lastTs!=null){
            const dt = Math.max(0, ts - lastTs);
            if (lastOn===true) totalMs += dt;
            const p = (Number.isFinite(Number(lastPower)) ? Number(lastPower) : null);
            if (p!=null) estWh += (p * (dt/3600000));
          }
          lastTs = ts; lastOn = (s.state_on===true || s.state_on===1); lastPower = (Number.isFinite(Number(s.power_w))? Number(s.power_w): null);
        }
        // Fallback estimation if no power/energy: use guessed watts * on-time
        if (!estWh || estWh < 0.001){
          const watts = guessWatts(d.name);
          estWh = watts * (totalMs/3600000);
        }
        // Prefer energy_wh delta when available
        let deltaWh = null; if (firstEnergy!=null && lastEnergy!=null && lastEnergy>=firstEnergy) deltaWh = lastEnergy - firstEnergy;
        const energyWh = (deltaWh!=null) ? deltaWh : estWh;
        agg.push({ key, vendor: d.vendor, device_id: d.id, name: d.name, roomName: d.roomName||'', energy_wh: energyWh, on_minutes: Math.round(totalMs/60000) });
      }

      // Filter out essentials by meta or name
      const safeAgg = agg.filter(a => {
        const mm = metaMap[a.key] || {};
        if (mm.essential === true) return false;
        if (isEssentialByName(a.name)) return false;
        return true;
      });

      // Em vez de repetir o "top consumidor" (já exibido na UI), sumarize e proponha ações por prioridade
      const lowMedium = safeAgg
        .map(t => {
          const mm = metaMap[t.key] || {};
          const pr = Number(mm.priority||0) || null;
          return { ...t, priority: pr };
        })
        .filter(t => t.priority===1 || t.priority===2);

      if (lowMedium.length){
        const sorted = lowMedium.slice().sort((a,b)=> (b.energy_wh||0)-(a.energy_wh||0));
        const topLM = sorted.slice(0, 5);
        const totalKwhLM = +(topLM.reduce((s,it)=> s + (Number(it.energy_wh||0)/1000), 0).toFixed(3));
        const names = topLM.map(x => x.name).filter(Boolean).slice(0,3).join(', ');
        recs.unshift({
          text: `Dispositivos de prioridade baixa/média nas últimas 24h somaram ~${totalKwhLM.toFixed(2)} kWh (${names || (topLM.length+" itens")}). Considere desligá-los quando não essenciais.`,
          metric: {
            total_energy_kwh: totalKwhLM,
            items: topLM.map(x => ({ vendor: x.vendor, device_id: x.device_id, name: x.name, energy_kwh: +((x.energy_wh||0)/1000).toFixed(3), priority: x.priority })),
          }
        });
      }

      // Top cômodo (somente 1), somando por roomName (fallback) ou app room quando possível
      const byRoom = new Map();
      for (const t of safeAgg){
        const mm = metaMap[t.key] || {};
        const appRoom = mm.room_id ? (roomsMap[String(mm.room_id)] || '') : '';
        const rn = appRoom || t.roomName || 'Sem cômodo';
        byRoom.set(rn, (byRoom.get(rn)||0) + (t.energy_wh||0));
      }
      const sortedRooms = Array.from(byRoom.entries()).sort((a,b)=> b[1]-a[1]);
      if (sortedRooms.length){
        const [rName, rWh] = sortedRooms[0];
        recs.unshift({ text: `Cômodo com maior consumo nas últimas 24h: ${rName} (~${(rWh/1000).toFixed(2)} kWh).`, metric: { room: rName, energy_kwh: +(rWh/1000).toFixed(3) } });
      }

      // Standby simples a partir do instantâneo atual (<=15 W e ligado)
      const withPower = list.filter(d => Number.isFinite(Number(d.power_w))).map(d => ({ ...d, power_w: Number(d.power_w) }));
      const phantom = withPower.filter(d => d.on === true && d.power_w > 3 && d.power_w <= 15).slice(0, 3);
      if (phantom.length){
        const names = phantom.map(d => d.name).filter(Boolean).slice(0,3).join(', ');
        recs.push({ text: `Possível consumo em standby (${names || phantom.length + ' dispositivos'}). Avalie desconectar quando não estiver em uso.`, metric: { count: phantom.length } });
      }
    }
  } catch {}

  try {
    const t = (typeof tariff_brl_per_kwh === 'number' && !Number.isNaN(tariff_brl_per_kwh)) ? Number(tariff_brl_per_kwh) : (process.env.TARIFF_BRL_PER_KWH!=null ? Number(process.env.TARIFF_BRL_PER_KWH) : null);
    if (typeof t === 'number' && !Number.isNaN(t)){
      for (let i=0; i<recs.length; i++){
        const r = recs[i];
        const ek = (r && r.metric && typeof r.metric.energy_kwh === 'number') ? Number(r.metric.energy_kwh) : null;
        if (ek!=null && Number.isFinite(ek)){
          const cost = +(ek * t).toFixed(2);
          recs[i] = { ...r, metric: { ...r.metric, cost_brl: cost }, text: (String(r.text||'').replace(/\.*\s*$/,'') + ` (≈ R$ ${cost.toFixed(2)})`).trim() };
        }
      }
    }
  } catch {}

  return { plant_id, recommendations: recs };
}

// -------- Device usage by hour (last 24h by default) --------
export async function getDeviceUsageByHour({ vendor, device_id, minutes = 24*60, guessWattsFn }){
  const engine = getDbEngine();
  const until = new Date();
  const since = new Date(until.getTime() - Math.max(1, Number(minutes))*60*1000);
  let rows = [];
  if (engine.type === 'pg'){
    const sql = `SELECT ts, state_on, power_w, energy_wh FROM device_history WHERE vendor=$1 AND device_id=$2 AND ts >= $3 AND ts <= $4 ORDER BY ts ASC`;
    rows = (await engine.pgPool.query(sql, [vendor, device_id, since, until])).rows;
  } else {
    rows = engine.sqliteDb.prepare('SELECT ts, state_on, power_w, energy_wh FROM device_history WHERE vendor=? AND device_id=? AND ts >= ? AND ts <= ? ORDER BY ts ASC').all(vendor, device_id, since.toISOString(), until.toISOString());
  }
  const hours = Array.from({ length: 24 }, (_,h)=> ({ hour:h, energy_kwh:0, on_minutes:0 }));
  if (!rows.length) return { hours, total_energy_kwh: 0, total_on_minutes: 0 };
  let last = null;
  let energyBase = null; // first energy_wh when available
  const now = until.getTime();
  for (const cur of rows){
    const ts = new Date(cur.ts).getTime();
    if (!Number.isFinite(ts)) continue;
    if (energyBase == null && cur.energy_wh!=null) energyBase = Number(cur.energy_wh)||0;
    if (last){
      const dt = Math.max(0, ts - last.ts);
      const hIdx = new Date(last.ts).getHours();
      let dWh = null;
      const prevWh = (last.energy_wh!=null) ? Number(last.energy_wh) : null;
      const curWh = (cur.energy_wh!=null) ? Number(cur.energy_wh) : null;
      if (prevWh!=null && curWh!=null && curWh>=prevWh){
        dWh = (curWh - prevWh);
      } else {
        const p = (last.power_w!=null && Number.isFinite(Number(last.power_w))) ? Number(last.power_w) : null;
        if (p!=null){ dWh = p * (dt/3600000); }
        else if (last.state_on===true || last.state_on===1){
          const guess = typeof guessWattsFn === 'function' ? Number(guessWattsFn()) : 60;
          dWh = guess * (dt/3600000);
        }
      }
      if (dWh!=null) hours[hIdx].energy_kwh += (dWh/1000);
      if (last.state_on===true || last.state_on===1) hours[hIdx].on_minutes += (dt/60000);
    }
    last = { ts, state_on: (cur.state_on===true || cur.state_on===1), power_w: (cur.power_w!=null? Number(cur.power_w): null), energy_wh: (cur.energy_wh!=null? Number(cur.energy_wh): null) };
  }
  const total_energy_kwh = hours.reduce((s,h)=> s + h.energy_kwh, 0);
  const total_on_minutes = Math.round(hours.reduce((s,h)=> s + h.on_minutes, 0));
  // Round for neatness
  for (const h of hours){ h.energy_kwh = +h.energy_kwh.toFixed(3); h.on_minutes = Math.round(h.on_minutes); }
  return { hours, total_energy_kwh: +total_energy_kwh.toFixed(3), total_on_minutes };
}

// -------- Cost projection using forecast --------
export async function getCostProjection({ plant_id, hours = 24, tariff_brl_per_kwh = 1.0, fetchWeather }){
  const f = await getForecast({ plant_id, hours, fetchWeather });
  // Net import per hour (kWh)
  const items = (f.items||[]).map(it => ({ time: it.time, net_import_kwh: Math.max(0, (it.consumption_kwh||0) - (it.generation_kwh||0)) }));
  const net_kwh = items.reduce((s,it)=> s + it.net_import_kwh, 0);
  const cost_brl = net_kwh * Number(tariff_brl_per_kwh||0);
  return { ok:true, plant_id, hours: Number(hours||24), tariff_brl_per_kwh: Number(tariff_brl_per_kwh||0), net_import_kwh: +net_kwh.toFixed(3), projected_cost_brl: +cost_brl.toFixed(2), items };
}

// -------- Simple battery strategy (charge/discharge windows) --------
export async function getBatteryStrategy({ plant_id, hours = 24, min_soc = 20, max_soc = 90, fetchWeather }){
  const repo = await getRepo();
  // Last SOC from battery history (fallback powerflow if needed handled by collector elsewhere)
  const engine = getDbEngine(); let lastSoc = null;
  try {
    if (engine.type === 'pg'){
      const r = await engine.pgPool.query("SELECT soc FROM battery_history WHERE plant_id = $1 AND soc IS NOT NULL ORDER BY timestamp DESC LIMIT 1", [plant_id]);
      lastSoc = (r.rows[0]?.soc!=null)? Number(r.rows[0].soc) : null;
    } else {
      const r = engine.sqliteDb.prepare("SELECT soc FROM battery_history WHERE plant_id = ? AND soc IS NOT NULL ORDER BY timestamp DESC LIMIT 1").get(plant_id);
      lastSoc = (r?.soc!=null)? Number(r.soc) : null;
    }
  } catch {}

  const f = await getForecast({ plant_id, hours, fetchWeather });
  // Score each hour by (generation - consumption); positive means surplus (good for charge), negative deficit (good for discharge)
  const plan = [];
  for (const it of (f.items||[])){
    const surplus = (it.generation_kwh||0) - (it.consumption_kwh||0);
    plan.push({ time: it.time, surplus });
  }
  const surplusSorted = plan.map((p,i)=> ({ i, ...p })).sort((a,b)=> b.surplus - a.surplus);
  const deficitSorted = plan.map((p,i)=> ({ i, ...p })).sort((a,b)=> a.surplus - b.surplus);

  // Heurística: 2 melhores horas para carga e 2 piores para descarga
  const chargeIdx = surplusSorted.filter(x=> x.surplus>0).slice(0,2).map(x=> x.i);
  const dischargeIdx = deficitSorted.filter(x=> x.surplus<0).slice(0,2).map(x=> x.i);

  const windows = [];
  for (const i of chargeIdx){ windows.push({ action: 'charge', from: f.items[i].time, to: f.items[i].time, reason: 'maior excedente previsto', target_soc: max_soc }); }
  for (const i of dischargeIdx){ windows.push({ action: 'discharge', from: f.items[i].time, to: f.items[i].time, reason: 'maior déficit previsto', min_soc }); }

  // Weather nublado/chuva: antecipa carga
  try {
    const w = typeof fetchWeather==='function' ? await fetchWeather() : null;
    const sky = String(w?.data?.weather?.forecast?.[0]?.skycon || '').toLowerCase();
    const clouds = Number(w?.data?.weather?.cloudrate ?? NaN);
    if ((sky.includes('rain') || sky.includes('storm')) || (!Number.isNaN(clouds) && clouds>=0.7)){
      windows.unshift({ action:'charge', from: f.items[0]?.time || new Date().toISOString(), to: f.items[1]?.time || new Date().toISOString(), reason: 'clima desfavorável (nublado/chuva)', target_soc: max_soc });
    }
  } catch {}

  return { ok:true, plant_id, hours: Number(hours||24), last_soc: (lastSoc!=null? +lastSoc.toFixed(1): null), min_soc: Number(min_soc||0), max_soc: Number(max_soc||100), windows };
}

// -------- Automation suggestions based on last days usage --------
export async function suggestAutomations({ plant_id, days = 7 }){
  const engine = getDbEngine();
  const until = new Date();
  const since = new Date(until.getTime() - Math.max(1, Number(days))*24*60*60*1000);
  let rows = [];
  if (engine.type === 'pg'){
    const sql = `SELECT ts, state_on, power_w, energy_wh FROM device_history WHERE ts >= $1 AND ts <= $2 ORDER BY ts ASC`;
    rows = (await engine.pgPool.query(sql, [since, until])).rows;
  } else {
    rows = engine.sqliteDb.prepare('SELECT ts, state_on, power_w, energy_wh FROM device_history WHERE ts >= ? AND ts <= ? ORDER BY ts ASC').all(since.toISOString(), until.toISOString());
  }
  const hourly = Array.from({ length: 24 }, (_,h)=> ({ hour:h, on_ms:0, energy_wh:0 }));
  let last = null;
  for (const cur of rows){
    const ts = new Date(cur.ts).getTime(); if (!Number.isFinite(ts)) continue;
    if (last){
      const dt = Math.max(0, ts - last.ts);
      const h = new Date(last.ts).getHours();
      if (last.state_on===true || last.state_on===1) hourly[h].on_ms += dt;
      const prevWh = (last.energy_wh!=null? Number(last.energy_wh): null);
      const curWh = (cur.energy_wh!=null? Number(cur.energy_wh): null);
      if (prevWh!=null && curWh!=null && curWh>=prevWh) hourly[h].energy_wh += (curWh - prevWh);
      else if (last.power_w!=null && Number.isFinite(Number(last.power_w))) hourly[h].energy_wh += (Number(last.power_w) * (dt/3600000));
    }
    last = { ts, state_on: (cur.state_on===true||cur.state_on===1), power_w: (cur.power_w!=null? Number(cur.power_w): null), energy_wh: (cur.energy_wh!=null? Number(cur.energy_wh): null) };
  }
  const hours = hourly.map(h => ({ hour: h.hour, on_minutes: Math.round(h.on_ms/60000), energy_kwh: +(h.energy_wh/1000).toFixed(3) }));
  // Heuristics for windows
  const evening = hours.slice(17, 23); // 17..22
  const eveningSum = evening.reduce((s,h)=> s + h.energy_kwh, 0);
  const eveningAvg = eveningSum / (evening.length || 1);
  const night = [...hours.slice(23,24), ...hours.slice(0,7)]; // 23..06
  const nightSum = night.reduce((s,h)=> s + h.energy_kwh, 0);

  const suggestions = [];
  if (eveningSum > 0.1){
    // Choose a 3-4h window with max sum
    let best = { from: 18, to: 22, score: 0 };
    for (let start=17; start<=19; start++){
      const end = start+4; // inclusive-ish
      let sc = 0; for (let h=start; h<end; h++) sc += hours[h]?.energy_kwh||0;
      if (sc > best.score) best = { from:start+1, to:end, score: sc };
    }
    suggestions.push({ name:'Economia de Pico', kind:'peak_saver', schedule:{ days:[1,2,3,4,5], start: `${String(best.from).padStart(2,'0')}:00`, end: `${String(best.to).padStart(2,'0')}:00` }, actions:{ low:true, medium:true, restore_on:true }, reason:`Maior consumo noturno: ~${eveningSum.toFixed(2)} kWh (média ~${eveningAvg.toFixed(2)} kWh/h).` });
  }
  if (nightSum > 0.05){
    suggestions.push({ name:'Sono', kind:'sleep', schedule:{ days:[0,1,2,3,4,5,6], start:'23:00', end:'06:00' }, actions:{ low:true, medium:false, restore_on:true }, reason:`Consumo noturno observado: ~${nightSum.toFixed(2)} kWh.` });
  }
  if (!suggestions.length){
    suggestions.push({ name:'Economia Básica', kind:'peak_saver', schedule:{ days:[1,2,3,4,5], start:'18:00', end:'22:00' }, actions:{ low:true, medium:true, restore_on:true }, reason:'Sugestão padrão baseada em janelas de pico.' });
  }
  return { ok:true, plant_id, days, hours, suggestions };
}
