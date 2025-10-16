import crypto from 'node:crypto';

const cache = new Map(); // key -> { exp, data }

function cacheGet(key){ const it = cache.get(key); if (!it) return null; if (Date.now() >= it.exp) { cache.delete(key); return null; } return it.data; }
function cacheSet(key, data, ttlMs){ cache.set(key, { exp: Date.now() + (ttlMs||600000), data }); }

export async function fetchRates({ base='BRL', symbols=['USD','EUR','GBP','CNY'], ttlMs=15*60*1000, providerUrl }={}){
  const syms = Array.isArray(symbols)? symbols.filter(Boolean) : [];
  const key = crypto.createHash('md5').update(JSON.stringify({ base, syms })).digest('hex');
  const cached = cacheGet(key); if (cached) return cached;
  const url = (providerUrl || 'https://api.exchangerate.host/latest') + `?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(syms.join(','))}`;
  const r = await fetch(url, { method:'GET', signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS || 30000)) });
  const j = await r.json().catch(()=>null);
  if (!r.ok || !j || !j.rates) throw new Error(`rates http ${r.status}`);
  const data = { base: String(j.base||base), date: j.date || null, rates: j.rates };
  cacheSet(key, data, ttlMs);
  return data;
}

