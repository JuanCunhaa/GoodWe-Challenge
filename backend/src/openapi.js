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
    { name: 'SmartThings', description: 'Integração SmartThings (OAuth2 + devices)' },
    { name: 'Tuya', description: 'Integração Tuya Cloud (dev/test; UID vinculado)' },
    { name: 'Hue', description: 'Integração Philips Hue (Remote API v2; opcional)' },
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
      get: {
        tags: ['Assistant'],
        summary: 'List assistant tool descriptors',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object', properties: { items: { type: 'array', items: { type: 'object' } } }
                },
                example: {
                  items: [
                    { name: 'get_income_today' },
                    { name: 'get_total_income' },
                    { name: 'get_generation' },
                    { name: 'get_monitor' },
                    { name: 'get_inverters' },
                    { name: 'get_weather' },
                    { name: 'get_powerflow' },
                    { name: 'get_evcharger_count' },
                    { name: 'get_plant_detail' },
                    { name: 'get_chart_by_plant' },
                    { name: 'get_power_chart' },
                    { name: 'get_warnings' },
                    { name: 'list_powerstations' },
                    { name: 'set_powerstation_name' },
                    { name: 'debug_auth' },
                    { name: 'cross_login' },
                    { name: 'st_list_devices' },
                    { name: 'st_device_status' },
                    { name: 'st_command' },
                    { name: 'st_find_device_room' },
                    { name: 'tuya_list_devices' },
                    { name: 'tuya_device_status' },
                    { name: 'tuya_command' },
                  ]
                }
              }
            }
          }
        }
      }
    },
    '/assistant/help': {
      get: { tags: ['Assistant'], summary: 'Return system prompt/guidance', responses: { '200': { description: 'OK' } } },
    },
    '/assistant/ping': {
      get: { tags: ['Assistant'], summary: 'Ping + auth status', responses: { '200': { description: 'OK' } } },
    },
    '/ai/forecast': {
      get: {
        tags: ['AI/Analytics'],
        summary: 'Previsão de geração e consumo (próximas horas)',
        parameters: [ { name: 'hours', in: 'query', schema: { type: 'integer', default: 24 } } ],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'OK' }, '401': { description: 'Unauthorized' } },
      },
    },
    '/ai/recommendations': {
      get: {
        tags: ['AI/Analytics'],
        summary: 'Recomendações de economia',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'OK' }, '401': { description: 'Unauthorized' } },
      },
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

    // SmartThings
    '/auth/smartthings': {
      get: { tags: ['SmartThings'], summary: 'Inicia OAuth2 (redirect)', responses: { '302': { description: 'Redirect to SmartThings' }, '401': { description:'Missing token' } } }
    },
    '/auth/smartthings/status': {
      get: { tags: ['SmartThings'], summary: 'Status da integração', security:[{ bearerAuth:[] }], responses: { '200': { description:'OK' } } }
    },
    '/auth/smartthings/unlink': {
      post: { tags: ['SmartThings'], summary: 'Desvincular', security:[{ bearerAuth:[] }], responses: { '204': { description:'No Content' }, '401':{ description:'Unauthorized' } } }
    },
    '/smartthings/devices': {
      get: { tags: ['SmartThings'], summary: 'Lista devices normalizados', security:[{ bearerAuth:[] }], responses: { '200': { description:'OK' } } }
    },
    '/smartthings/rooms': {
      get: {
        tags: ['SmartThings'], summary: 'Lista cômodos (rooms)', security:[{ bearerAuth:[] }],
        parameters: [ { name:'locationId', in:'query', schema:{ type:'string' } } ], responses: { '200': { description:'OK' } }
      }
    },
    '/smartthings/device/{id}/status': {
      get: {
        tags: ['SmartThings'], summary: 'Status de um device', security:[{ bearerAuth:[] }],
        parameters: [ { name:'id', in:'path', required:true, schema:{ type:'string' } } ], responses: { '200': { description:'OK' } }
      }
    },
    '/smartthings/commands': {
      post: {
        tags: ['SmartThings'], summary: 'Envia comandos ao device', security:[{ bearerAuth:[] }],
        requestBody: { required:true, content: { 'application/json': { schema: { type:'object', properties: { deviceId:{type:'string'}, commands:{ type:'array', items:{ type:'object' } }, component:{type:'string'}, capability:{type:'string'}, command:{type:'string'}, arguments:{ type:'array' }, action:{ type:'string', enum:['on','off'] } }, required:['deviceId'] } } } },
        responses: { '200': { description:'OK' }, '401': { description:'Unauthorized' }, '422': { description:'Invalid payload' }, '409': { description:'Conflict (device state)' } }
      }
    },
    '/smartthings/device/{id}/off': {
      post: { tags:['SmartThings'], summary:'Desliga (auto component)', security:[{ bearerAuth:[] }], parameters:[{ name:'id',in:'path',required:true,schema:{type:'string'}}], responses:{ '200':{description:'OK'}, '401':{description:'Unauthorized'} } }
    },
    '/smartthings/device/{id}/on': {
      post: { tags:['SmartThings'], summary:'Liga (auto component)', security:[{ bearerAuth:[] }], parameters:[{ name:'id',in:'path',required:true,schema:{type:'string'}}], responses:{ '200':{description:'OK'}, '401':{description:'Unauthorized'} } }
    },

    // Tuya Cloud (dev/test)
    '/auth/tuya/status': {
      get: { tags: ['Tuya'], summary: 'Status da integração Tuya', security:[{ bearerAuth:[] }], responses: { '200': { description:'OK' } } }
    },
    '/auth/tuya/link': {
      post: {
        tags: ['Tuya'], summary: 'Vincular UID Tuya ao usuário', security:[{ bearerAuth:[] }],
        requestBody: { required:true, content: { 'application/json': { schema: { type:'object', properties:{ uid:{ type:'string' } }, required:['uid'] }, example:{ uid:'eu1623********' } } } },
        responses: { '200': { description:'OK' }, '400': { description:'Bad Request' } }
      }
    },
    '/auth/tuya/unlink': {
      post: { tags: ['Tuya'], summary: 'Desvincular Tuya', security:[{ bearerAuth:[] }], responses: { '204': { description:'No Content' } } }
    },
    '/tuya/devices': {
      get: { tags: ['Tuya'], summary: 'Lista devices (UID)', security:[{ bearerAuth:[] }], responses: { '200': { description:'OK' }, '401':{ description:'not linked / missing uid' } } }
    },
    '/tuya/commands': {
      post: {
        tags: ['Tuya'], summary: 'Envia comandos Tuya (teste)', security:[{ bearerAuth:[] }],
        requestBody: { required:true, content:{ 'application/json': { schema:{ type:'object', properties:{ device_id:{ type:'string' }, commands:{ type:'array', items:{ type:'object', properties:{ code:{type:'string'}, value:{} }, required:['code','value'] } } }, required:['device_id','commands'] } } } },
        responses: { '200': { description:'OK' }, '401':{ description:'not linked / missing uid' } }
      }
    },

    // Philips Hue (opcional; pode estar desabilitado por env)
    '/auth/hue/status': {
      get: { tags: ['Hue'], summary: 'Status da integração Hue', security:[{ bearerAuth:[] }], responses: { '200': { description:'OK' } } }
    },
    '/auth/hue': {
      get: { tags: ['Hue'], summary: 'Inicia OAuth2 (redirect)', responses: { '302': { description:'Redirect' } } }
    },
    '/auth/hue/unlink': {
      post: { tags: ['Hue'], summary: 'Desvincular Hue', security:[{ bearerAuth:[] }], responses: { '204': { description:'No Content' } } }
    },
    '/hue/devices': {
      get: { tags: ['Hue'], summary: 'Lista devices Hue (normalizado)', security:[{ bearerAuth:[] }], responses: { '200': { description:'OK' } } }
    },
    '/auth/hue/appkey': {
      post: { tags: ['Hue'], summary: 'Gerar Application Key via Remote API (exige botão do bridge)', security:[{ bearerAuth:[] }], responses: { '200':{ description:'OK' }, '400':{ description:'No app key returned' } } }
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
