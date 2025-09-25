// Minimal OpenAPI spec for the GoodWe backend
// Extend this as you add/adjust endpoints

const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'GoodWe Backend API',
    version: '1.0.0',
    description:
      'Minimal OpenAPI spec with a few core endpoints. Extend as needed.',
  },
  tags: [
    { name: 'Health', description: 'Status e verificação básica' },
    { name: 'Powerstations', description: 'Recursos locais da aplicação' },
    { name: 'Auth', description: 'Autenticação do app (registro/login/conta)' },
    { name: 'Assistant', description: 'Assistente e ferramentas' },
    { name: 'Debug', description: 'Rotas de depuração (sem segredos)' },
    { name: 'GoodWe Auth', description: 'Autenticação/handshake com SEMS/GoodWe' },
    { name: 'GoodWe Monitor', description: 'Monitor e monitor-abs' },
    { name: 'GoodWe Plant', description: 'Detalhes de planta e inversores' },
    { name: 'GoodWe Charts', description: 'Gráficos e séries históricas' },
    { name: 'GoodWe Live', description: 'Powerflow e clima' },
    { name: 'GoodWe EV Chargers', description: 'Carregadores de veículos elétricos' },
    { name: 'GoodWe Warnings', description: 'Alertas/avisos por planta' },
  ],
  servers: [
    { url: '/api', description: 'API base' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
                example: { ok: true },
              },
            },
          },
        },
      },
    },
    '/powerstations': {
      get: {
        tags: ['Powerstations'],
        summary: 'List powerstations (local DB)',
        responses: {
          '200': {
            description: 'List of powerstations',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/powerstations/{id}/name': {
      post: {
        tags: ['Powerstations'],
        summary: 'Update business name for a powerstation',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { name: { type: ['string', 'null'] } },
              },
              example: { name: 'My Plant' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
                example: { ok: true },
              },
            },
          },
        },
      },
    },
    '/debug/auth': {
      get: {
        tags: ['Debug'],
        summary: 'Debug authentication state (no secrets)',
        responses: {
          '200': { description: 'Debug info', content: { 'application/json': {} } },
        },
      },
    },
    '/assistant/chat': {
      post: {
        tags: ['Assistant'],
        summary: 'Assistant chat (requires Authorization Bearer token)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  input: { type: 'string' },
                  messages: { type: 'array', items: { type: 'object' } },
                },
              },
              example: { input: 'Olá, geração de hoje?', messages: [] },
            },
          },
        },
        responses: {
          '200': { description: 'Assistant response', content: { 'application/json': {} } },
          '401': { description: 'Unauthorized' },
          '501': { description: 'Assistant unavailable' },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    '/assistant/health': {
      get: { tags: ['Assistant'], summary: 'Assistant service availability', responses: { '200': { description: 'OK' } } },
    },
    '/assistant/tools': {
      get: { tags: ['Assistant'], summary: 'List assistant tool descriptors', responses: { '200': { description: 'OK' } } },
    },
    '/assistant/help': {
      get: { tags: ['Assistant'], summary: 'Return system prompt/guidance', responses: { '200': { description: 'OK' } } },
    },
    '/assistant/ping': {
      get: { tags: ['Assistant'], summary: 'Ping + auth status', responses: { '200': { description: 'OK' } } },
    },
    '/tts': {
      post: {
        tags: ['Assistant'],
        summary: 'Text to Speech (audio)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
              example: { text: 'Olá! Esta é uma voz neutra.' },
            },
          },
        },
        responses: {
          '200': { description: 'WAV audio', content: { 'audio/wav': { schema: { type: 'string', format: 'binary' } } } },
          '501': { description: 'TTS not configured' },
        },
      },
      get: {
        tags: ['Assistant'],
        summary: 'Text to Speech (debug via query)',
        parameters: [ { name: 'text', in: 'query', schema: { type: 'string' }, required: true } ],
        responses: {
          '200': { description: 'WAV audio', content: { 'audio/wav': { schema: { type: 'string', format: 'binary' } } } },
          '400': { description: 'Missing text' },
          '501': { description: 'TTS not configured' },
        },
      },
    },

    // Auth
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register user and create session',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 6 },
                  powerstation_id: { type: 'string' },
                },
                required: ['email', 'password', 'powerstation_id'],
              },
            },
          },
        },
        responses: { '200': { description: 'OK' }, '400': { description: 'Bad Request' } },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login and create session',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { email: { type: 'string' }, password: { type: 'string' } },
                required: ['email', 'password'],
              },
            },
          },
        },
        responses: { '200': { description: 'OK' }, '401': { description: 'Unauthorized' } },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get current user by token',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'OK' }, '401': { description: 'Unauthorized' } },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: 'Change password (Bearer token required)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { old_password: { type: 'string' }, new_password: { type: 'string' } },
                required: ['old_password', 'new_password'],
              },
            },
          },
        },
        responses: { '200': { description: 'OK' }, '401': { description: 'Unauthorized' } },
      },
    },
    '/auth/crosslogin': {
      post: { tags: ['GoodWe Auth'], summary: 'GoodWe CrossLogin (masked response)', responses: { '200': { description: 'OK' } } },
    },
    '/auth/crosslogin/raw': {
      post: {
        tags: ['GoodWe Auth'],
        summary: 'GoodWe CrossLogin (raw)',
        parameters: [
          { name: 'ver', in: 'query', required: false, schema: { type: 'string', enum: ['auto', 'v1', 'v2'] } },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },

    // GoodWe data wrappers
    '/monitor': {
      get: {
        tags: ['GoodWe Monitor'],
        summary: 'QueryPowerStationMonitor',
        parameters: [
          { name: 'powerstation_id', in: 'query', required: true, schema: { type: 'string' }, example: 'PWID-123' },
          { name: 'key', in: 'query', schema: { type: 'string' } },
          { name: 'orderby', in: 'query', schema: { type: 'string' } },
          { name: 'powerstation_type', in: 'query', schema: { type: 'string' } },
          { name: 'powerstation_status', in: 'query', schema: { type: 'string' } },
          { name: 'page_index', in: 'query', schema: { type: 'integer' } },
          { name: 'page_size', in: 'query', schema: { type: 'integer' } },
          { name: 'adcode', in: 'query', schema: { type: 'string' } },
          { name: 'org_id', in: 'query', schema: { type: 'string' } },
          { name: 'condition', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/monitor-abs': {
      get: {
        tags: ['GoodWe Monitor'],
        summary: 'Absolute monitor (debug via provided URL)',
        parameters: [
          { name: 'url', in: 'query', required: true, schema: { type: 'string', format: 'uri' } },
          { name: 'powerstation_id', in: 'query', schema: { type: 'string' } },
          { name: 'key', in: 'query', schema: { type: 'string' } },
          { name: 'orderby', in: 'query', schema: { type: 'string' } },
          { name: 'powerstation_type', in: 'query', schema: { type: 'string' } },
          { name: 'powerstation_status', in: 'query', schema: { type: 'string' } },
          { name: 'page_index', in: 'query', schema: { type: 'integer' } },
          { name: 'page_size', in: 'query', schema: { type: 'integer' } },
          { name: 'adcode', in: 'query', schema: { type: 'string' } },
          { name: 'org_id', in: 'query', schema: { type: 'string' } },
          { name: 'condition', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/inverters': {
      get: {
        tags: ['GoodWe Plant'],
        summary: 'GetInverterAllPoint',
        parameters: [ { name: 'powerStationId', in: 'query', required: true, schema: { type: 'string' }, example: 'PWID-123' } ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/weather': {
      get: {
        tags: ['GoodWe Live'],
        summary: 'GetWeather',
        parameters: [ { name: 'powerStationId', in: 'query', required: true, schema: { type: 'string' }, example: 'PWID-123' } ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/powerflow': {
      get: {
        tags: ['GoodWe Live'],
        summary: 'GetPowerflow',
        parameters: [ { name: 'powerStationId', in: 'query', required: true, schema: { type: 'string' }, example: 'PWID-123' } ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/evchargers/count': {
      get: {
        tags: ['GoodWe EV Chargers'],
        summary: 'GetEvChargerCountByPwId',
        parameters: [ { name: 'powerStationId', in: 'query', required: true, schema: { type: 'string' }, example: 'PWID-123' } ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/chart-by-plant': {
      get: {
        tags: ['GoodWe Charts'],
        summary: 'Charts/GetChartByPlant',
        parameters: [
          { name: 'id', in: 'query', required: true, schema: { type: 'string' }, example: 'PLANT-123' },
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' }, example: '2025-09-19' },
          { name: 'range', in: 'query', schema: { type: 'integer', default: 2 }, example: 2 },
          { name: 'chartIndexId', in: 'query', schema: { type: 'string', default: '8' } },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/plant-detail': {
      get: {
        tags: ['GoodWe Plant'],
        summary: 'GetPlantDetailByPowerstationId',
        parameters: [ { name: 'powerStationId', in: 'query', required: true, schema: { type: 'string' }, example: 'PWID-123' } ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/power-chart': {
      get: {
        tags: ['GoodWe Charts'],
        summary: 'Charts/GetPlantPowerChart',
        parameters: [
          { name: 'plant_id', in: 'query', schema: { type: 'string' }, example: 'PLANT-123' },
          { name: 'id', in: 'query', schema: { type: 'string' }, example: 'PLANT-123' },
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' }, example: '2025-09-19' },
          { name: 'full_script', in: 'query', schema: { type: 'boolean', default: true } },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/warnings': {
      get: {
        tags: ['GoodWe Warnings'],
        summary: 'warning/PowerstationWarningsQuery',
        parameters: [ { name: 'powerStationId', in: 'query', required: true, schema: { type: 'string' }, example: 'PWID-123' } ],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
      },
    },
  },
};

export default openapi;
