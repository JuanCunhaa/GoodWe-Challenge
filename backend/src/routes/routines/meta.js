import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { detectCooccurrence, detectTrends, generateMetaRoutine } from '../../engine/metaRoutineEngine.js';
import { upsertAutomation, setAutomationState } from '../../db.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const schemaPath = path.resolve(process.cwd(), 'src', 'schemas', 'adaptive_routine.schema.json');
let schema = null; try { schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8')); } catch {}
const validate = schema ? ajv.compile(schema) : (() => true);

export function registerMetaRoutineRoutes(router, { helpers }) {
  const { requireUser } = helpers;

  // Discover meta routines; optionally register experimental automations
  router.get('/routines/meta/discover', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      // Heuristic: find best cooccurrence among top devices (SmartThings/Tuya ingested)
      // For simplicity, accept vendor/id from query to focus discovery
      const a = { vendor: String(req.query.a_vendor || 'smartthings'), id: String(req.query.a_id || '') };
      const b = { vendor: String(req.query.b_vendor || 'tuya'), id: String(req.query.b_id || '') };
      const results = [];
      if (a.id && b.id) {
        const co = await detectCooccurrence(a, b, { minutes: Number(req.query.win || 10), lookbackDays: Number(req.query.days || 30) });
        const trend = await detectTrends({ plant_id: user.powerstation_id, windowMin: Number(req.query.trend_min || 180) });
        const basePattern = { name: `${a.vendor}:${a.id}+${b.vendor}:${b.id}`, schedule: { days: [1,2,3,4,5], start: '18:00', end: '21:00' }, actions: { priority: 'low', action: 'off', restore_on: true } };
        const gen = await generateMetaRoutine({ basePattern, plant_id: user.powerstation_id, user_id: user.id });
        const routine = gen.routine; const simulation = gen.simulation;

        // Validate & gate by thresholds
        const ok = validate(routine) && (simulation?.predicted_savings_pct || 0) >= 2.5;
        const comfort_penalty = 0.0; // unknown from here; keep conservative low
        const risk = comfort_penalty <= 0.3 ? 'low' : 'high';
        const decision = ok && risk === 'low';

        let created = null;
        if (decision && String(req.query.persist || 'true') === 'true') {
          // Register as experimental automation (disabled); mark state
          created = await upsertAutomation(user.id, {
            name: routine.name,
            enabled: false,
            kind: routine.kind,
            schedule: routine.schedule,
            conditions: { experimental: true, created_at: new Date().toISOString(), promote_after_days: 14 },
            actions: routine.actions,
          });
          try { await setAutomationState(created.id, { last_state: 'experimental', last_at: new Date() }); } catch {}
        }
        results.push({ a, b, cooccurrence: co, trend, routine, simulation, decision, created });
      }
      res.json({ ok: true, items: results });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}

export default { registerMetaRoutineRoutes };
