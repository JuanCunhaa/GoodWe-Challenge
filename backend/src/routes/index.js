import { registerPowerstationRoutes } from './powerstations.js';
import { registerAppAuthRoutes } from './appAuth.js';
import { registerGoodWeRoutes } from './goodwe.js';
import { registerTtsRoutes } from './tts.js';
import { registerAssistantRoutes } from './assistant.js';
import { registerAiRoutes } from './ai.js';
import { registerSmartThingsRoutes } from './integrations/smartthings.js';
import { registerHueRoutes } from './integrations/hue.js';
import { registerTuyaRoutes } from './integrations/tuya.js';
import { createHelpers } from './helpers.js';
import { registerIoTRoutes } from './iot.js';
import { registerRoomsRoutes } from './rooms.js';
import { registerMetaRoutes } from './meta.js';
import { registerAutomationsRoutes } from './automations.js';
import { registerEnergyRoutes } from './energy.js';
import { registerHabitsRoutes } from './habits.js';

export function registerAllRoutes(router, { gw, dbApi }) {
  const helpers = createHelpers({ gw, dbApi });

  // Health
  router.get('/health', (req, res) => res.json({ ok: true }));

  // Core
  registerPowerstationRoutes(router, { dbApi, helpers });
  registerAppAuthRoutes(router, { dbApi, helpers });
  registerGoodWeRoutes(router, { gw, helpers });
  registerTtsRoutes(router, { helpers });
  registerAssistantRoutes(router, { gw, helpers, dbApi });
  registerAiRoutes(router, { gw, helpers });

  // Integrations
  registerSmartThingsRoutes(router, { dbApi, helpers });
  registerHueRoutes(router, { dbApi, helpers });
  registerTuyaRoutes(router, { dbApi, helpers });
  registerIoTRoutes(router, { helpers });
  registerRoomsRoutes(router, { dbApi, helpers });
  registerMetaRoutes(router, { helpers });
  registerAutomationsRoutes(router, { helpers });
  registerEnergyRoutes(router, { helpers });
  registerHabitsRoutes(router, { helpers });

  return router;
}
