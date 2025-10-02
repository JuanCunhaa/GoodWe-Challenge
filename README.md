# GoodWe App — Painel de Energia + Assistente + Integrações (pt‑BR)

Aplicação completa para monitorar plantas GoodWe/SEMS, com painel React moderno, backend Node/Express, Assistente com ferramentas em tempo real, TTS, integrações residenciais (SmartThings, Tuya, Hue) e publicação em MQTT para automação doméstica.


## Sumário
- Visão Geral
- Recursos (Backend, Frontend, Assistente, Integrações, MQTT)
- Banco de Dados e Autenticação do App
- APIs (principais rotas)
- AI/Analytics (previsão e sugestões)
- Variáveis de Ambiente
- Como Rodar (Dev e Produção)
- Deploy (Vercel + Render/Railway)
- Solução de Problemas


## Visão Geral
- Backend (Node 20+/Express): autentica no SEMS (GoodWe), expõe rotas amigáveis, integra SmartThings/Tuya/Hue, serve a UI em produção e publica métricas em MQTT.
- Frontend (React + Vite + Tailwind): dashboard com páginas de geração, consumo, inversores, alertas, perfil (integrações) e “Dispositivos”.
- Assistente (OpenAI opcional): conversa em português e executa ferramentas (income, geração, status, ligar/desligar, etc.).
- TTS: voz local via Piper (auto‑detecção do binário/voz) ou servidor HTTP.


## Recursos

### Backend
- Express com CORS dinâmico, compressão e Swagger (OpenAPI em `/api/openapi.json` e UI em `/api/docs`).
- Cliente SEMS (CrossLogin v1/v2/v3, cookies, throttling, cache TTL por endpoint).
- TTS `/api/tts` (Piper local ou servidor HTTP). Auto‑detecta binário/voz quando não há envs; higieniza texto (remove `*`).
- Assistente `/api/assistant/*` com ferramentas completas (GoodWe/SmartThings/Tuya) e respostas amigáveis (sem `*`).
- Integrações:
  - SmartThings: OAuth2, listagem de devices com roomName, status e comandos (liga/desliga; autodetecção do componente com ‘switch’).
  - Tuya/Smart Life: link por UID, listagem robusta (v1.0/users e iot‑03), enriquecimento com cômodos (homes/rooms + details), status normalizado (on/off) e comandos. Rota para functions (DP codes) disponível.
  - Hue (opcional): OAuth remoto, devices e toggle.
- MQTT (Home Assistant): publica métricas em tópicos com discovery.

### Frontend
- Páginas: Dashboard, Live, Fluxo, Geração, Consumo, Inversores, Alertas, Manutenção, Relatórios, Faturamento, Admin, Auditoria, Configurações, Perfil (Integrações), Dispositivos.
- Dispositivos: lista de SmartThings/Tuya com filtro por cômodo, busca, status ON/OFF (normalizado) e controle de ligar/desligar.
- Perfil → Integrações: SmartThings/Tuya (vincular, sincronizar, desvincular) e estado/contagem de devices.

### Assistente
- Ferramentas GoodWe: get_income_today, get_total_income, get_generation (today/yesterday/this_week/this_month/total), get_monitor, get_inverters, get_weather, get_powerflow, get_evcharger_count, get_plant_detail, get_chart_by_plant, get_power_chart, get_warnings, list_powerstations, set_powerstation_name, debug_auth, cross_login.
- Ferramentas SmartThings: st_list_devices (com roomName), st_device_status, st_command (autodetecta componente switch), st_find_device_room.
- Ferramentas Tuya: tuya_list_devices (multi‑UID, com cômodos), tuya_device_status (normalizado), tuya_command (toggle com validação), tuya/device/:id/functions.
- Regras: respostas em pt‑BR, sem markdown/bold, frases amigáveis (“Prontinho! ... foi ligado/desligado.”). Lista de ferramentas em `/api/assistant/tools`.
- Novas ferramentas: `get_forecast` e `get_recommendations` (baseadas no histórico local).

### MQTT (opcional)
- Publica sensores (PV Power, Load Power, Grid Power, Battery Power, SOC, Generation Today) com discovery HA.
- Config: `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_PREFIX`, `MQTT_DISCOVERY_PREFIX`, `MQTT_PLANT_ID` (ou usa a primeira powerstation local).


## Banco de Dados e Autenticação do App
- Banco: SQLite por padrão (`backend/data/app.db`) — compat com caminho legado `backend/backend/data`. Postgres via `DATABASE_URL`.
- Tabelas: `powerstations`, `users` (scrypt), `sessions`, `oauth_states`, `linked_accounts`.
- Autenticação do App: `/api/auth/register`, `/api/auth/login`, `/api/auth/me`, `/api/auth/change-password`.
- Seed: `npm run seed` cria/atualiza powerstations e `backend/data/logins.txt`.


## APIs — principais rotas

### Health e OpenAPI
- `GET /api/health` — status.
- `GET /api/openapi.json` e `GET /api/docs` — documentação Swagger.

### GoodWe
- `GET /api/monitor`, `/inverters`, `/weather`, `/powerflow`, `/evchargers/count`.
- `GET /api/chart-by-plant`, `/plant-detail`, `/power-chart`, `/warnings`, `/monitor-abs`.
- `POST /api/auth/crosslogin`, `POST /api/auth/crosslogin/raw`, `GET /api/debug/auth`.

### Assistente
- `POST /api/assistant/chat` — conversa + ferramentas.
- `GET /api/assistant/tools` — descrições das ferramentas.
- `GET /api/assistant/help|ping|health` — utilitários.

### TTS
- `POST/GET /api/tts` — áudio WAV; Piper local quando presente, fallback HTTP se configurado.

## AI/Analytics
- Coleta histórica automática: as rotas GoodWe (`/powerflow`, `/chart-by-plant`, `/power-chart`) agora alimentam tabelas de histórico (Postgres via Sequelize; SQLite fallback) com geração, consumo, bateria (SOC/potência) e rede (import/export).
- Previsão: `GET /api/ai/forecast?hours=24` — retorna previsão horária de geração e consumo para as próximas N horas (média móvel recente; ajuste simples por clima quando disponível).
- Recomendações: `GET /api/ai/recommendations` — retorna sugestões de economia com justificativas numéricas.
- Frontend: nova página “Sugestoes” exibindo previsão e dicas com indicadores visuais.

### SmartThings
- OAuth: `GET /api/auth/smartthings` (redirect) + callback; `POST /api/auth/smartthings/unlink`; `GET /api/auth/smartthings/status`.
- Devices/Rooms/Status/Commands: `GET /api/smartthings/devices`, `GET /api/smartthings/rooms`, `GET /api/smartthings/device/:id/status`, `POST /api/smartthings/commands`, `POST /api/smartthings/device/:id/on|off`.

### Tuya / Smart Life
- Link/Status/Unlink: `POST /api/auth/tuya/link { uid, app? }`, `GET /api/auth/tuya/status`, `POST /api/auth/tuya/unlink`.
- Devices: `GET /api/tuya/devices` — tenta `/v1.0/users/{uid}/devices` (antigo), depois iot‑03; enriquece com cômodos (homes/rooms + details) e retorna `{ items, total }`.
- Status/Toggle/Functions: `GET /api/tuya/device/:id/status` (normalizado), `POST /api/tuya/device/:id/on|off`, `POST /api/tuya/commands`, `GET /api/tuya/device/:id/functions`.


## Variáveis de Ambiente (backend)
- Gerais: `PORT`, `CORS_ORIGIN`, `TIMEOUT_MS`, `TOKEN_CACHE`.
- GoodWe: `GOODWE_EMAIL`, `GOODWE_PASSWORD`.
- Assistente: `OPENAI_API_KEY` (obrigatório p/ chat), `ASSIST_TOKEN` (modo serviço, sem integrações residenciais), `ASSIST_PLANT_ID`/`PLANT_ID` (service‑mode).
- TTS Piper: `PIPER_PATH`, `PIPER_VOICE`, `PIPER_VOICE_JSON`, `PIPER_SPEAKER`, `PIPER_LENGTH_SCALE`, `PIPER_NOISE_SCALE`, `PIPER_NOISE_W`, `PIPER_HTTP_URL`/`TTS_SERVER_URL`.
- Tuya: `TUYA_ACCESS_ID`, `TUYA_ACCESS_SECRET`, `TUYA_API_BASE` (us/weu/in/cn), `TUYA_SIGN_VERSION`, `TUYA_LANG`.
- SmartThings: `ST_CLIENT_ID`, `ST_CLIENT_SECRET`, `ST_AUTH_URL`, `ST_TOKEN_URL`, `ST_API_BASE`, `ST_SCOPES`, `ST_REDIRECT_PATH`.
- Hue (opcional): `HUE_CLIENT_ID`, `HUE_CLIENT_SECRET`, `HUE_AUTH_URL`, `HUE_TOKEN_URL`, `HUE_API_BASE`, `HUE_APP_KEY`.
- MQTT (opcional): `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_PREFIX`, `MQTT_DISCOVERY_PREFIX`, `MQTT_INTERVAL_MS`.
- Banco: `DATABASE_URL` (Postgres) — se ausente, usa SQLite.


## Como Rodar
1) Backend: copie `backend/.env.exemple` → `backend/.env` e preencha as envs mínimas (GoodWe + CORS).
2) Seed do banco: `npm run seed`.
3) Dev:
   - Backend: `npm run dev` (porta 3000)
   - Frontend: `npm --prefix frontend run dev` (porta 5173) e `VITE_API_BASE=http://localhost:3000/api`
4) Produção (uma porta): `npm start` no root (build do front + serve estáticos e `/api/*`).


## Deploy (Vercel + Render/Railway)
- Backend (Render): Node 20.x (recomendado). Root Directory = `backend`. Build `npm ci`. Start `npm run start`.
- Frontend (Vercel): Project Root = repo; `vercel.json` reescreve `/api/*` para o backend.
- Piper: coloque os binários/vozes em `piper/` e deixe o auto‑detector encontrar. Pode forçar com `PIPER_*`.


## Solução de Problemas
- 401 nas rotas: envie `Authorization: Bearer <token>` (login do app). `ASSIST_TOKEN` funciona só p/ Assistente sem integrações.
- GoodWe sem dados no Assistente: verifique pwid do usuário (helpers já prioriza `user.powerstation_id`). `GET /api/assistant/ping` indica se há auth SEMS.
- Tuya “0 devices”: confirme `TUYA_API_BASE` do seu projeto (us/weu/in/cn), o UID vinculado (Linked Users) e refaça `/auth/tuya/link` se necessário.
- TTS 501: adicione Piper ou configure `PIPER_HTTP_URL`.
- Render e ESM: use Node 20+ e Root Directory `backend` (para honrar "type": "module").


—
Projeto sem cabeçalho de licença explícito. Consulte o autor antes de redistribuir.
