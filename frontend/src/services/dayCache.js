// Lightweight localStorage cache for daily energy aggregates and optional curves

const ENERGY_KEY = (plantId) => `gw_day_energy:${plantId}`;
const CURVE_KEY  = (plantId) => `gw_day_curve:${plantId}`;
const META_KEY   = (plantId) => `gw_backfill:${plantId}`;

function read(key){
  try{ return JSON.parse(localStorage.getItem(key) || '{}') || {} }catch{ return {} }
}
function write(key, obj){
  try{ localStorage.setItem(key, JSON.stringify(obj)) }catch{}
}

export const dayCache = {
  // ---------- Energy aggregates ----------
  getEnergy(plantId, date){
    const store = read(ENERGY_KEY(plantId));
    return store?.[date] || null; // { pv, load, batt, grid, gridImp, gridExp }
  },
  setEnergy(plantId, date, energy){
    const store = read(ENERGY_KEY(plantId));
    store[date] = { ...energy, _ts: Date.now() };
    write(ENERGY_KEY(plantId), store);
  },

  // ---------- Curves (limited retention) ----------
  getCurve(plantId, date){
    const store = read(CURVE_KEY(plantId));
    return store?.items?.[date] || null; // { series, soc }
  },
  setCurve(plantId, date, curve){
    const max = Number(import.meta.env.VITE_CACHE_CURVE_DAYS || 30);
    const store = read(CURVE_KEY(plantId));
    const items = store.items || {};
    items[date] = { ...curve, _ts: Date.now() };
    // Evict older if exceeds max
    const keys = Object.keys(items).sort((a,b)=> (items[a]._ts||0) - (items[b]._ts||0));
    while (keys.length > max){ const k = keys.shift(); delete items[k]; }
    write(CURVE_KEY(plantId), { items });
  },

  // ---------- Meta (backfill coverage) ----------
  getMeta(plantId){
    return read(META_KEY(plantId)); // { seeded, rangeStart, rangeEnd, lastUpdatedAt }
  },
  setMeta(plantId, meta){
    write(META_KEY(plantId), meta || {});
  },

  clearPlant(plantId){
    try{ localStorage.removeItem(ENERGY_KEY(plantId)); localStorage.removeItem(CURVE_KEY(plantId)); }catch{}
    try{ localStorage.removeItem(META_KEY(plantId)); }catch{}
  }
}
