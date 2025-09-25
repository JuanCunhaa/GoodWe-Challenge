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

TTS (Text‑to‑Speech)
- POST /api/tts { text } → retorna áudio (audio/wav) com voz neutra consistente.

Node‑only (recomendado, sem Python)
- Usa o binário Piper TTS (open‑source, offline) chamado pelo Node.
- Variáveis de ambiente:
  - PIPER_PATH: caminho do executável (ex.: C:\tools\piper\piper.exe)
  - PIPER_VOICE: caminho do modelo .onnx da voz pt_BR
  - PIPER_VOICE_JSON: caminho do .onnx.json da voz (opcional, recomendado)
  - PIPER_SPEAKER: índice do speaker (se o modelo suportar multi‑speaker)
  - PIPER_LENGTH_SCALE, PIPER_NOISE_SCALE, PIPER_NOISE_W: ajustes finos (opcionais)

Como usar Piper (Windows)
1) Baixe o binário do Piper (Windows x64) nas releases do projeto “rhasspy/piper”.
2) Baixe uma voz pt_BR (arquivo .onnx e .onnx.json correspondentes) das releases de vozes do Piper.
3) Defina variáveis, por exemplo:
   - set PIPER_PATH=C:\tools\piper\piper.exe
   - set PIPER_VOICE=C:\tools\piper\voices\pt_BR-xxxx-high.onnx
   - set PIPER_VOICE_JSON=C:\tools\piper\voices\pt_BR-xxxx-high.onnx.json
4) Inicie o backend Node normalmente. O /api/tts usará o Piper local e retornará WAV.

Alternativa (Python, opcional)
- Servidor Flask em backend/src/tts_server.py usando Coqui TTS (XTTS v2) com fallback.
- Se usar essa opção, defina TTS_SERVER_URL (ex.: http://127.0.0.1:5002/tts) e o /api/tts fará proxy.


Notes
- Requires Node 18+ (uses global fetch).
- DB is local SQLite at backend/data/app.db. Seeded with the provided powerstation IDs (12 so far).
- A text mapping is generated at backend/data/logins.txt (business names TBD).
