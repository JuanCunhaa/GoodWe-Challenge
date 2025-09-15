import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { GoodWeClient } from './goodweClient.js';
import * as dbApi from './db.js';
import { createRoutes } from './routes.js';

const PORT = Number(process.env.PORT || 3000);

// Ensure cache dir exists if custom path provided
const tokenCachePath = process.env.TOKEN_CACHE || '.cache/goodwe_token.json';
fs.mkdirSync(path.dirname(path.resolve(tokenCachePath)), { recursive: true });

const gw = new GoodWeClient({
  account: process.env.GOODWE_EMAIL || '',
  password: process.env.GOODWE_PASSWORD || '',
  tokenCachePath,
  timeoutMs: Number(process.env.TIMEOUT_MS || 30000),
});

const app = express();
app.use(express.json());
// CORS (dynamic headers to satisfy preflight)
app.use((req, res, next) => {
  const origin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  const reqHeaders = req.headers['access-control-request-headers'];
  res.setHeader('Access-Control-Allow-Headers', reqHeaders || 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api', createRoutes(gw, dbApi));

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
