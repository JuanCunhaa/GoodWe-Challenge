Backend (Node + Express + SQLite)

Quick start
- Copy .env.example to .env and set GOODWE_EMAIL and GOODWE_PASSWORD.
- Seed the local DB: npm run seed
- Start the API: npm run dev

Environment
- GOODWE_EMAIL: your SEMS account email
- GOODWE_PASSWORD: your SEMS password
- PORT: API port (default 3000)
- TOKEN_CACHE: path to cache CrossLogin token JSON (default .cache/goodwe_token.json)
- TIMEOUT_MS: HTTP timeout in ms (default 30000)
- OPENAI_API_KEY: API key to enable the Assistant endpoint (/api/assistant/chat)

Routes (prefix /api)
- GET /api/health
- GET /api/powerstations
- POST /api/powerstations/:id/name  { name }
- POST /api/auth/crosslogin
- GET /api/monitor?powerstation_id=...
- GET /api/inverters?powerStationId=...
- GET /api/weather?powerStationId=...
- GET /api/power-chart?plant_id=...&date=YYYY-MM-DD
- POST /api/auth/change-password
- POST /api/assistant/chat { input, messages? }

Notes
- Requires Node 18+ (uses global fetch).
- DB is local SQLite at backend/data/app.db. Seeded with the provided powerstation IDs (12 so far).
- A text mapping is generated at backend/data/logins.txt (business names TBD).
