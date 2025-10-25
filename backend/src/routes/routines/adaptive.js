import path from 'node:path';
import fs from 'node:fs';
import Ajv from 'ajv';
import { evaluateRoutine, simulateRoutine, mutateRoutine, banditTick } from '../../engine/learningEngine.js';
import { getDbEngine, listAutomationsByUser, setAutomationState, getAutomationState, upsertAutomation } from '../../db.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const schemaPath = path.resolve(process.cwd(), 'src', 'schemas', 'adaptive_routine.schema.json');
let schema = null;
try { schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8')); } catch {}
const validate = schema ? ajv.compile(schema) : (() => true);

function ok(v) { return v === true; }

export function registerAdaptiveRoutineRoutes(router, { helpers }) {
  const { requireUser } = helpers;

  // Train/evaluate a routine and optionally mutate variants
  router.post('/routines/adaptive/train', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const body = req.body || {};
      let routine = body.routine || null;
      if (!routine && body.automation_id) {
        const list = await listAutomationsByUser(user.id);
        routine = list.find(x => Number(x.id) === Number(body.automation_id));
      }
      if (!routine) return res.status(422).json({ ok: false, error: 'routine or automation_id required' });
      const obj = { name: routine.name || 'Routine', kind: routine.kind || 'custom', schedule: JSON.parse(routine.schedule_json || JSON.stringify(routine.schedule || {})), actions: JSON.parse(routine.actions_json || JSON.stringify(routine.actions || {})), learning: routine.learning || body.learning || {}, plant_id: body.plant_id || user.powerstation_id };
      if (!validate(obj)) return res.status(422).json({ ok: false, error: 'invalid adaptive routine', details: validate.errors });

      const store = { plant_id: obj.plant_id, get: (k) => null };
      const metrics = await evaluateRoutine(obj, store, { days: Number(body.window_days || 7) });

      // Mutations and selection
      const variants = Array.isArray(body.mutate_fields) || obj?.learning?.mutation?.fields ? mutateRoutine(obj, Number(body.k || 3)) : [];
      let selected = null;
      if (variants.length) {
        const ex = { id: 'routine:' + (routine.id || 'x'), variants };
        const pick = banditTick(ex, null);
        selected = variants[pick.selected] || null;
      }
      let promoted = false;
      if (body.promoteIfReady && body.automation_id) {
        try {
          const st = await getAutomationState(Number(body.automation_id));
          const fourteenDaysMs = 14 * 86400000;
          const lastAt = st?.last_at ? new Date(st.last_at) : null;
          const longEnough = lastAt ? (Date.now() - +lastAt >= fourteenDaysMs) : false;
          const good = (metrics?.savings_pct ?? 0) >= 2.5 && (metrics?.comfort_penalty ?? 1) <= 0.3;
          if (st?.last_state === 'experimental' && longEnough && good) {
            // Enable automation
            await upsertAutomation(user.id, { id: Number(body.automation_id), name: routine.name, enabled: true, kind: routine.kind, schedule: JSON.parse(routine.schedule_json || '{}'), conditions: JSON.parse(routine.conditions_json || '{}'), actions: JSON.parse(routine.actions_json || '{}') });
            await setAutomationState(Number(body.automation_id), { last_state: 'active', last_at: new Date() });
            promoted = true;
          }
        } catch {}
      }

      res.json({ ok: true, metrics, variants_count: variants.length, selected, promoted });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Simulate an adaptive routine impact
  router.post('/routines/adaptive/simulate', async (req, res) => {
    const user = await requireUser(req, res); if (!user) return;
    try {
      const obj = req.body?.routine || req.body || {};
      if (!validate(obj)) return res.status(422).json({ ok: false, error: 'invalid adaptive routine', details: validate.errors });
      const sim = await simulateRoutine({ ...obj, plant_id: obj.plant_id || user.powerstation_id }, {}, { plant_id: obj.plant_id || user.powerstation_id, user_id: user.id });
      res.json({ ok: true, ...sim });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}

export default { registerAdaptiveRoutineRoutes };
