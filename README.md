# GoodWe App — Backend + Frontend (pt-BR)

Aplicação completa para monitoramento GoodWe/SEMS com:
- Backend Node 18+ (Express) que autentica no SEMS, expõe endpoints amigáveis, cacheia chamadas e serve a UI em produção.
- Banco local SQLite (usuários, sessões e rótulos de powerstations) ou Postgres (via `DATABASE_URL`).
- Frontend React + Vite + Tailwind com dashboard moderno, 14 páginas e painel de Assistente.
- Assistente opcional (OpenAI) com ferramentas que consultam a API em tempo real.
- TTS opcional (voz) via Piper local ou servidor HTTP externo.


## Requisitos
- Node.js 18 ou superior (usa `fetch` global).
- Acesso a uma conta SEMS (GoodWe) para `GOODWE_EMAIL` e `GOODWE_PASSWORD`.
- (Opcional) Chave OpenAI (`OPENAI_API_KEY`) para habilitar o Assistente.
- (Opcional) Piper TTS instalado ou um servidor TTS HTTP.


## Como rodar (rápido)
1) Clone o projeto e acesse a pasta `goodwe-app`.
2) Backend: copie `backend/.env.exemple` para `backend/.env` e preencha `GOODWE_EMAIL` e `GOODWE_PASSWORD`.
3) Seed do banco (cria/atualiza powerstations locais):
   - `npm run seed`
4) Desenvolvimento:
   - API: `npm run dev` (porta padrão `3000`)
   - UI: `npm --prefix frontend run dev` (porta padrão `5173`)
5) Produção (porta única):
   - `npm start`  → compila o frontend e o backend serve tudo em `/:index.html` e `/api/*`.


## Scripts (root)
- `npm run dev` → roda backend em watch (`3000`).
- `npm run start` → build do frontend + inicia o backend servindo estáticos.
- `npm run build` → build apenas do frontend (saida em `frontend/dist`).
- `npm run seed` → executa `backend/src/seed.js` (popular powerstations e gerar `logins.txt`).


## Configuração (variáveis de ambiente)

Arquivo `backend/.env` (exemplos em `backend/.env.exemple`):
- `GOODWE_EMAIL` e `GOODWE_PASSWORD` — credenciais SEMS utilizadas pelo servidor para realizar o CrossLogin e assinar chamadas.
- `PORT` — porta do backend (padrão `3000`).
- `TOKEN_CACHE` — caminho do JSON de cache do token (padrão `.cache/goodwe_token.json`).
- `TIMEOUT_MS` — timeout HTTP em ms (padrão `30000`).
- `CORS_ORIGIN` — origem permitida em dev (ex.: `http://localhost:5173`).
- `OPENAI_API_KEY` — se definido, habilita `/api/assistant/chat`.
- `ASSIST_TOKEN` — token de serviço para consumir o Assistente sem sessão de usuário (ex.: Alexa).
- TTS (opcional, modo Node/Piper):
  - `PIPER_PATH` — caminho do executável Piper (ex.: `C:\tools\piper\piper.exe`).
  - `PIPER_VOICE` — caminho do modelo `.onnx` da voz pt-BR.
  - `PIPER_VOICE_JSON` — `.onnx.json` correspondente (opcional, recomendado).
  - Ajustes finos: `PIPER_SPEAKER`, `PIPER_LENGTH_SCALE`, `PIPER_NOISE_SCALE`, `PIPER_NOISE_W`.
- TTS (opcional, fallback HTTP):
  - `PIPER_HTTP_URL` ou `TTS_SERVER_URL` (ex.: `http://127.0.0.1:5002/tts`).

- Banco de Dados:
  - Por padrão, usa SQLite no arquivo `backend/data/app.db` (ou caminho legado `backend/backend/data`).
  - Para Postgres (Render/Neon): defina `DATABASE_URL` (ex.: `postgresql://user:pass@host:5432/dbname?sslmode=require`).
    O backend detecta e inicializa o schema automaticamente.

Arquivo `frontend/.env` (exemplos em `frontend/.env.example`):
- `VITE_API_BASE` — base da API (ex.: `http://localhost:3000/api`).
- Taxas de câmbio para conversões (usadas em estimativas): `VITE_RATE_USD_BRL`, `VITE_RATE_EUR_BRL`, `VITE_RATE_GBP_BRL`, `VITE_RATE_CNY_BRL`.
- Tarifas energéticas e feed-in por moeda (ex.: `VITE_TARIFF_BRL_KWH`, `VITE_FEEDIN_BRL_KWH`).
- Parâmetros de atualização/cache do front (intervalos TTL e pré-carregamento histórico).


## Arquitetura (visão geral)
- Backend (`backend/src`):
  - `server.js` — Express com CORS, compressão, rotas `/api/*`, OpenAPI em `/api/openapi.json` e Swagger em `/api/docs`. Em produção serve `frontend/dist` no mesmo processo.
  - `routes.js` — endpoints GoodWe (monitor, inverters, charts, powerflow, weather, warnings), autenticação do app (register/login/me/change-password), Assistente (`/assistant/*`) e TTS (`/tts`).
  - `goodweClient.js` — cliente SEMS com CrossLogin v1/v2/v3, jar de cookies, throttling, dedupe e cache com TTL por endpoint; suporta `postJson`, `postForm` e versões absolutas (EU/US) como fallback.
  - `db.js` — SQLite (tabelas: `powerstations`, `users`, `sessions`). Persiste em `backend/backend/data/app.db` por compatibilidade; migra para `backend/data/app.db` quando existir.
  - `openapi.js` — especificação mínima dos endpoints para Swagger UI.
  - `seed.js` — semeia powerstations e escreve `backend/backend/data/logins.txt`.
  - `tts_server.py` — servidor Flask opcional com Coqui TTS (caso prefira voz neural via Python).
- Frontend (`frontend/src`):
  - React + Vite + Tailwind. Rotas protegidas por login. Páginas de dashboard, geração, inversores, alertas, perfil etc.
  - `services/goodweApi.js` — wrappers para os endpoints `/api/*`.
  - `services/energyService.js` e `services/dayCache.js` — agregação de curvas (dia/semana/mês) e cache em `localStorage` com pré-aquecimento e atualização incremental.
  - `components/AssistantPanel.jsx` — chat com Assistente, STT (Web Speech) e TTS (via `/api/tts`).
- Lambda (opcional):
  - `index.mjs` — handler para Alexa: recebe intents, chama `/api/assistant/chat` com `ASSIST_TOKEN` e responde em fala curta pt-BR.


## Fluxo de autenticação
- Autenticação de app: usuários e sessões no SQLite.
  - `POST /api/auth/register` → cria usuário e retorna `token`.
  - `POST /api/auth/login` → valida senha (scrypt), cria sessão e retorna `token`.
  - `GET /api/auth/me` e `POST /api/auth/change-password` exigem `Authorization: Bearer <token>`.
- Autenticação GoodWe: realizada no servidor com a conta do `.env` (CrossLogin). O cliente não envia credenciais SEMS.


## Endpoints principais
- Saúde: `GET /api/health`.
- Powerstations (locais): `GET /api/powerstations`, `POST /api/powerstations/:id/name`.
- GoodWe: `GET /api/monitor`, `GET /api/inverters`, `GET /api/weather`, `GET /api/powerflow`, `GET /api/evchargers/count`, `GET /api/chart-by-plant`, `GET /api/power-chart`, `GET /api/plant-detail`, `GET /api/warnings`.
- Assistente: `POST /api/assistant/chat`, `GET /api/assistant/tools`, `GET /api/assistant/health`, `GET /api/assistant/help`.
- TTS: `GET/POST /api/tts` → retorna `audio/wav` quando configurado.
- Documentação: `GET /api/openapi.json` e `GET /api/docs` (Swagger UI dark).


## Assistente (opcional)
- Requer `OPENAI_API_KEY`.
- Modelo padrão: `gpt-4o-mini` (configurável via `OPENAI_MODEL`).
- O agente usa ferramentas para buscar dados reais (renda do dia, total, geração por período, monitor, inverters, clima, powerflow etc.).
- Modo serviço (sem login de usuário): defina `ASSIST_TOKEN` no backend e envie `Authorization: Bearer <ASSIST_TOKEN>` ao chamar `/api/assistant/chat`. A planta pode vir por `?powerstation_id=...` ou pelas envs `ASSIST_PLANT_ID`/`PLANT_ID`.


## TTS (voz)
Você pode:
1) Usar Piper local (recomendado, tudo em Node): configure `PIPER_PATH` e `PIPER_VOICE` no `backend/.env`.
2) Usar um servidor HTTP TTS (ex.: `tts_server.py` com Coqui): configure `PIPER_HTTP_URL`/`TTS_SERVER_URL`.
O frontend faz requisições a `/api/tts` e reproduz o áudio concatendando frases longas.


## Banco de dados
- Arquivo SQLite em `backend/backend/data/app.db` (compat) ou `backend/data/app.db` (novo caminho quando existir).
- Rodar seed: `npm run seed` → cria/atualiza powerstations e gera `logins.txt`.
- Usuários são criados via `/api/auth/register` (UI de Registro ou cURL).


## Desenvolvimento vs Produção
- Dev (dois processos):
  - Backend: `npm run dev` (porta `3000`).
  - Frontend: `npm --prefix frontend run dev` (porta `5173`).
  - Em `frontend/.env`, aponte `VITE_API_BASE` para `http://localhost:3000/api`.
- Produção (um processo, porta única):
  - `npm start` no root. O backend compila o frontend e serve estáticos de `frontend/dist`.


## Deploy (Vercel + Render/Railway) — 100% free com Piper

Recomendado: Frontend na Vercel (estático) e Backend em Render/Railway/Fly (processo longo) — mantém Piper 100% funcional.

1) Backend (Render como exemplo)
- Service → Web Service
- Root Directory: `goodwe-app/backend`
- Environment: Node 18
- Build Command: `npm ci`
- Start Command: `npm run start`
- Env obrigatórias:
  - `GOODWE_EMAIL`, `GOODWE_PASSWORD`
  - `PORT=3000`
  - `CORS_ORIGIN=https://SEU_PROJETO.vercel.app`
  - (Opcional) `OPENAI_API_KEY` e `ASSIST_TOKEN`
- Piper (bundled no repo):
  - Coloque o binário/vozes em `goodwe-app/piper/` (ex.: `piper`, `voices/pt_BR.onnx`, `pt_BR.onnx.json`).
  - O backend detecta automaticamente. Se quiser forçar: `PIPER_PATH`, `PIPER_VOICE`, `PIPER_VOICE_JSON`.

2) Frontend (Vercel)
- Project Root: `goodwe-app`
- O arquivo `vercel.json` já está preparado para:
  - Build: `frontend` → `frontend/dist`
  - Rewrite: `/api/*` → seu backend. Edite `goodwe-app/vercel.json` e troque `https://SEU_BACKEND_HOST` pela URL do Render.
- Em “Environment Variables” da Vercel, opcionalmente defina `VITE_API_BASE=/api` (ou já deixe no `.env.production`).

3) Teste
- Abra a URL da Vercel → a UI carrega do Vercel e todas as chamadas a `/api/*` são roteadas para o backend.
- Teste `/api/tts` (se Piper/voz estiverem presentes) e `/api/docs` (Swagger).

Notas
- Se o backend hibernar (plano free), a primeira chamada pode demorar (cold start).
- O `/api/tts` cai em fallback HTTP ou responde 501 se Piper/voz não forem encontrados. O front usa Web Speech como fallback quando recebe 501.


## Handler Alexa (opcional)
- Arquivo `index.mjs` pronto para Lambda.
- Envs: `API_BASE` (exponha seu backend com túnel/ingress), `ASSIST_TOKEN`, `PLANT_ID` (opcional), `HTTP_TIMEOUT_MS`, `HTTP_RETRIES`.
- Dica: use Cloudflare Tunnel para expor `/api` de forma segura sem abrir portas públicas.


## Estrutura de pastas (essencial)
```
goodwe-app/
  backend/
    src/ (server.js, routes.js, goodweClient.js, db.js, openapi.js, seed.js, tts_server.py)
    .env[.exemple]  data/  vendor/
  frontend/
    src/ (components, pages, services, state)
    .env[.example]  dist/
  index.mjs   package.json
```


## Solução de problemas
- 401 nas rotas `/api/*`: verifique se está enviando `Authorization: Bearer <token>` após login, ou use `ASSIST_TOKEN` no modo serviço do Assistente.
- Falha no CrossLogin: confira `GOODWE_EMAIL/GOODWE_PASSWORD` e conectividade com `semsportal.com`.
- TTS 501: defina Piper (`PIPER_*`) ou `PIPER_HTTP_URL/TTS_SERVER_URL`.
- Frontend em branco em produção: confirme que `frontend/dist` existe; `npm start` no root já compila antes de iniciar.
- Banco não encontrado: a app usa caminho legacy `backend/backend/data` se `backend/data` não existir. Crie `backend/data` para adotar o novo caminho.


## Licença
Sem cabeçalho de licença explícito neste repositório. Consulte o autor antes de redistribuir.
