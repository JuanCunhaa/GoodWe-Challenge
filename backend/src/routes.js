import { Router } from 'express';
import { registerAllRoutes } from './routes/index.js';

export function createRoutes(gw, dbApi) {
  const router = Router();
  registerAllRoutes(router, { gw, dbApi });
  return router;
}

