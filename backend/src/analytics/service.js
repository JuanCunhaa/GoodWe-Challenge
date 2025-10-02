import { initHistoryRepo } from './historyRepo.js';

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
  const hourlyGen = slots.map(t => genProfile.get(t.getHours()) || 0);
  const hourlyCons = slots.map(t => consProfile.get(t.getHours()) || 0);

  let weather = null;
  if (typeof fetchWeather === 'function'){
    try { weather = await fetchWeather(); } catch {}
  }
  const adjGen = weather ? adjustByWeather(hourlyGen, weather) : hourlyGen;

  const items = slots.map((t, i) => ({ time: t.toISOString(), generation_kwh: adjGen[i] || 0, consumption_kwh: hourlyCons[i] || 0 }));
  const total_generation_kwh = items.reduce((s,it)=> s + (it.generation_kwh||0), 0);
  const total_consumption_kwh = items.reduce((s,it)=> s + (it.consumption_kwh||0), 0);
  return { plant_id, hours: Number(hours||24), items, total_generation_kwh, total_consumption_kwh, weather_used: !!weather };
}

export async function getRecommendations({ plant_id }){
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
      text: `Consumo médio diário de ${meanDaily.toFixed(1)} kWh. Avalie programar máquinas de lavar e secadoras fora do pico para reduzir custo.`,
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
    // If not provided, try lightweight fetch via Charts weather endpoint is not always accessible; we skip heavy fetch here.
    const sky = String(weather?.data?.weather?.forecast?.[0]?.skycon || weather?.data?.weather?.skycon || '').toLowerCase();
    const clouds = Number(weather?.data?.weather?.cloudrate ?? NaN);
    let lowGen = false; let reason = '';
    if (!Number.isNaN(clouds) && clouds >= 0.7) { lowGen = true; reason = `cobertura de nuvens alta (${Math.round(clouds*100)}%)`; }
    else if (sky.includes('rain') || sky.includes('storm')) { lowGen = true; reason = 'chuva prevista'; }
    else if (sky.includes('cloud')) { lowGen = true; reason = 'tempo nublado'; }
    if (lowGen) {
      recs.unshift({ text: `Previsão climática indica ${reason}. Evite usar dispositivos não críticos no período de pico solar (11h–15h) para não depender de geração instável.`, metric: { sky, clouds: isFinite(clouds) ? +clouds.toFixed(2) : null } });
    }
  } catch {}

  return { plant_id, recommendations: recs };
}
