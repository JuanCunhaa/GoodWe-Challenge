import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { GoodWeClient } from './goodweClient.js';
import * as dbApi from './db.js';
import { createRoutes } from './routes.js';
import openapi from './openapi.js';
import compression from 'compression';
import { startMqttPublisher } from './mqttPublisher.js';
import { startIngestor } from './analytics/ingestor.js';
import { startIotIngestor } from './analytics/iotIngestor.js';
import { startAutomationRunner } from './automation/runner.js';
import { startHabitMiner } from './automation/habitsMiner.js';

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
// HTTP compression (gzip/deflate)
app.use(compression({ threshold: 1024 }));
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

// OpenAPI JSON
app.get('/api/openapi.json', (req, res) => {
  res.json(openapi);
});

// Swagger UI (served via CDN, no extra npm deps) - Dark theme
app.get('/api/docs', (req, res) => {
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>GoodWe API Docs</title>
      <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
      <style>
        :root {
          color-scheme: dark;
        }
        body { margin: 0; background: #0b1220; color: #e2e8f0; }
        .swagger-ui .topbar { display: none; }
        .swagger-ui, .swagger-ui .wrapper, .swagger-ui .information-container, .scheme-container,
        .models, .opblock, .opblock-tag-section, .responses-inner, .response, .model-container {
          background-color: #0b1220 !important;
          color: #e2e8f0 !important;
        }
        .opblock-summary, .opblock-summary-method, .opblock-tag, .model-title, .tab li, .markdown p,
        .model .property.primitive, .model .model-title__text, .parameters-col_description, .response-col_description {
          color: #e2e8f0 !important;
        }
        .opblock { border-color: #1f2937 !important; }
        .opblock .opblock-summary { background: #0f172a !important; border-color: #1f2937 !important; }
        .opblock .opblock-summary .opblock-summary-method { color: #111827 !important; }
        .opblock.opblock-get .opblock-summary-method { background: #22c55e !important; }
        .opblock.opblock-post .opblock-summary-method { background: #60a5fa !important; }
        .opblock.opblock-put .opblock-summary-method { background: #f59e0b !important; }
        .opblock.opblock-delete .opblock-summary-method { background: #ef4444 !important; }
        .info .title, .info .base-url, .scheme-container .schemes-title { color: #e2e8f0 !important; }
        .btn, .button { background: #1f2937 !important; color: #e2e8f0 !important; border-color: #374151 !important; }
        .btn[disabled], .button[disabled] { opacity: 0.6; }
        input, select, textarea { background: #0f172a !important; color: #e2e8f0 !important; border-color: #374151 !important; }
        .prop-type { color: #60a5fa !important; }
        code, pre { background: #111827 !important; color: #e5e7eb !important; }
        a, a:visited { color: #93c5fd !important; }
      </style>
    </head>
    <body>
      <div id="swagger-ui"></div>
      <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
      <script>
        window.onload = () => {
          window.ui = SwaggerUIBundle({
            url: '/api/openapi.json',
            dom_id: '#swagger-ui',
            presets: [SwaggerUIBundle.presets.apis],
            layout: 'BaseLayout',
            deepLinking: true,
            docExpansion: 'list',
            tagsSorter: 'alpha',
            operationsSorter: 'alpha',
            defaultModelsExpandDepth: -1,
            tryItOutEnabled: true,
            persistAuthorization: true,
          });
        };
      </script>
    </body>
  </html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ---------- Static frontend (single-port serving) ----------
// Serve built frontend if present (default path: ../frontend/dist)
const FRONT_DIST = process.env.FRONT_DIST || path.resolve(process.cwd(), '../frontend/dist');
if (fs.existsSync(FRONT_DIST)) {
  app.use(express.static(FRONT_DIST, { index: false }));
  app.get(['/', '/index.html'], (req, res) => {
    res.sendFile(path.join(FRONT_DIST, 'index.html'));
  });
  // SPA fallback: any non-API route serves index.html
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(FRONT_DIST, 'index.html'));
  });
} else {
  console.warn(`[server] Frontend build not found at ${FRONT_DIST}. Only API will be served.`);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API listening on http://0.0.0.0:${PORT}`);
});

// Start MQTT publisher (optional)
if (process.env.MQTT_URL) {
  try { startMqttPublisher({ gw, dbApi }); } catch (e) { console.warn('[mqtt] init failed', e?.message || e); }
}

// Start analytics ingestor (optional, default enabled)
try { startIngestor({ gw, dbApi }); } catch (e) { console.warn('[ingestor] init failed', e?.message || e) }
try { startIotIngestor({ helpers: null }); } catch (e) { console.warn('[iot-ingestor] init failed', e?.message || e) }
try { startAutomationRunner({ helpers: { deriveBaseUrl: (req)=> (process.env.BASE_URL||'') } }); } catch (e) { console.warn('[automation] init failed', e?.message || e) }
try { startHabitMiner({ helpers: { deriveBaseUrl: (req)=> (process.env.BASE_URL||'') } }); } catch (e) { console.warn('[habits] init failed', e?.message || e) }
