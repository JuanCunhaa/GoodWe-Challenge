// Alexa Skill handler (Node.js 22, ESM)

export function say(text, end = true) {
  return {
    version: '1.0',
    response: {
      outputSpeech: { type: 'PlainText', text },
      shouldEndSession: end,
    },
  };
}

function numEnv(name, def){
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : def;
}

function sleep(ms){ return new Promise(r=> setTimeout(r, ms)) }

async function getJson(url) {
  // Timeout e retry configuráveis por env
  const HTTP_TIMEOUT_MS = Math.max(500, numEnv('HTTP_TIMEOUT_MS', 2500));
  const HTTP_RETRIES = Math.max(0, numEnv('HTTP_RETRIES', 1));
  let lastErr;
  for (let attempt = 0; attempt <= HTTP_RETRIES; attempt++){
    try{
      const r = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
          ? AbortSignal.timeout(HTTP_TIMEOUT_MS)
          : undefined,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch(e){
      lastErr = e;
      if (attempt < HTTP_RETRIES) await sleep(150);
    }
  }
  throw lastErr || new Error('request failed');
}

// -------- Assistant bridge (env: API_BASE, ASSIST_TOKEN) --------
async function postAssistant(input) {
  const API_BASE = process.env.API_BASE;
  const token = process.env.ASSIST_TOKEN || '';
  const plantId = process.env.PLANT_ID || process.env.ASSIST_PLANT_ID || '';
  const HTTP_TIMEOUT_MS = Math.max(500, numEnv('HTTP_TIMEOUT_MS', 2500));
  const url = `${API_BASE}/assistant/chat${plantId ? `?powerstation_id=${encodeURIComponent(plantId)}` : ''}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ input }),
    signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
      ? AbortSignal.timeout(HTTP_TIMEOUT_MS)
      : undefined,
  });
  const j = await r.json().catch(()=>null);
  if (!r.ok || !j?.ok) throw new Error(j?.error || `${r.status}`);
  return String(j?.answer || '').trim().slice(0, 8000);
}

function pickUtteranceFromSlots(intent){
  try{
    const slots = intent?.slots || {};
    const values = Object.values(slots)
      .map(s => (s && (s.value || s.resolutions?.resolutionsPerAuthority?.[0]?.values?.[0]?.value?.name)) || '')
      .filter(Boolean);
    if (values.length) return values.join(' ');
  }catch{}
  return '';
}

export const handler = async (event) => {
  const API_BASE = process.env.API_BASE; // ex.: https://seu-tunel.trycloudflare.com/api
  const PLANT_ID = process.env.PLANT_ID; // powerstation_id (pode ser usado pelos seus tools)

  try {
    if (!API_BASE) {
      return say('Configuração ausente. Defina API_BASE na Lambda.');
    }

    const type = event?.request?.type;

    if (type === 'LaunchRequest') {
      return say('Bem-vindo ao GoodWe Monitor. Você pode perguntar: quanto gerou hoje?', false);
    }

    if (type === 'IntentRequest') {
      const name = event?.request?.intent?.name || '';

      // Built-ins ainda tratados localmente
      if (name === 'AMAZON.HelpIntent') {
        return say('Você pode perguntar: quanto gerou hoje, ou renda total.', false);
      }
      if (name === 'AMAZON.StopIntent' || name === 'AMAZON.CancelIntent' || name === 'AMAZON.FallbackIntent') {
        return say('Até logo.');
      }

      // -------- Qualquer pergunta vai para o Assistente --------
      try {
        const utterFromSlots = pickUtteranceFromSlots(event?.request?.intent);
        const rawUtter = utterFromSlots || name || 'Responda de forma adequada para voz.';
        const voiceStyle = 'Responda em pt-BR, em 1 frase natural para voz. Use unidades por extenso (quilowatt-hora, watts). Converta moedas para o real brasileiro e diga "reais". Evite termos técnicos e URLs.';
        const prompt = `${voiceStyle}\nPergunta: ${rawUtter}`;
        const answer = await postAssistant(prompt);
        if (answer) return say(answer);
      } catch {}

      return say('Desculpe, não entendi. Você pode tentar: quanto gerou hoje?');
    }

    if (type === 'SessionEndedRequest') {
      return say('Até logo.');
    }

    return say('Houve um problema ao processar sua solicitação.');
  } catch (e) {
    console.error('Alexa error:', e);
    return say('Houve um erro ao consultar os dados.');
  }
};
