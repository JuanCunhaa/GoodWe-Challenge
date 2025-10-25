const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function request(path, { method='GET', token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { method, headers });
  const data = await res.json().catch(()=>null);
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

export const goodweApi = {
  monitor: (token, powerstation_id) => request(`/monitor?powerstation_id=${encodeURIComponent(powerstation_id)}`, { token }),
  plantDetail: (token, powerStationId) => request(`/plant-detail?powerStationId=${encodeURIComponent(powerStationId)}`, { token }),
  inverters: (token, powerStationId) => request(`/inverters?powerStationId=${encodeURIComponent(powerStationId)}`, { token }),
  warnings: (token, powerStationId) => request(`/warnings?powerStationId=${encodeURIComponent(powerStationId)}`, { token }),
  powerChartDay: (token, plantId, date) => request(`/power-chart?plant_id=${encodeURIComponent(plantId)}&date=${encodeURIComponent(date)}`, { token }),
  weather: (token, powerStationId) => request(`/weather?powerStationId=${encodeURIComponent(powerStationId)}`, { token }),
  powerflow: (token, powerStationId) => request(`/powerflow?powerStationId=${encodeURIComponent(powerStationId)}`, { token }),
  evChargerCount: (token, powerStationId) => request(`/evchargers/count?powerStationId=${encodeURIComponent(powerStationId)}`, { token }),
  chartByPlant: (token, plantId, { date, range=3, chartIndexId=8 } = {}) =>
    request(`/chart-by-plant?id=${encodeURIComponent(plantId)}&date=${encodeURIComponent(date||'')}&range=${encodeURIComponent(range)}&chartIndexId=${encodeURIComponent(chartIndexId)}`, { token }),
};

export function getCurrencyRates() {
  // Read from env with sensible defaults; adjust in your .env if needed
  const num = (v, d) => (v!=null && !isNaN(+v) ? +v : d);
  return {
    BRL: 1,
    USD: num(import.meta.env.VITE_RATE_USD_BRL, 5.50),
    EUR: num(import.meta.env.VITE_RATE_EUR_BRL, 6.00),
    GBP: num(import.meta.env.VITE_RATE_GBP_BRL, 7.00),
    CNY: num(import.meta.env.VITE_RATE_CNY_BRL, 0.80),
  };
}

export function convertToBRL(amount, currency) {
  const rates = getCurrencyRates();
  const cur = (currency || 'BRL').toUpperCase();
  const rate = rates[cur];
  if (!rate) return amount; // unknown -> no conversion
  return (Number(amount) || 0) * rate;
}
