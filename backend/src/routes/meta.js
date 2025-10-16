import { fetchRates } from '../utils/rates.js';

export function registerMetaRoutes(router, { helpers }){
  const { requireUser } = helpers;

  // External currency rates with caching
  router.get('/rates', async (req, res) => {
    // Optional auth: allow public if desired; currently require user for consistency
    const user = await requireUser(req, res); if (!user) return;
    try {
      const base = String(req.query.base || 'BRL').toUpperCase();
      const symbols = String(req.query.symbols || 'USD,EUR,GBP,CNY').split(',').map(s=> s.trim().toUpperCase()).filter(Boolean);
      const ttl = Math.max(10_000, Number(req.query.ttl_ms || process.env.RATES_TTL_MS || 900_000));
      const provider = process.env.RATES_URL || null;
      const data = await fetchRates({ base, symbols, ttlMs: ttl, providerUrl: provider });
      res.json({ ok:true, ...data });
    } catch (e) { res.status(500).json({ ok:false, error: String(e) }); }
  });
}

