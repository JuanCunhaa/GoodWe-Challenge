// Lambda handler para Alexa, tudo hardcoded conforme pedido
// Encaminha a requisição original da Alexa para o endpoint do backend

const SKILL_ID = '1f6aa4d0-6ef8-435c-9b8d-9f2942df4f4d';
const API_BASE = 'https://good-we-challenge.vercel.app';
const ENDPOINT = `${API_BASE}/api/alexa/${SKILL_ID}`;
const TIMEOUT_MS = 10000;

function alexaResponse(text){
  return {
    version: '1.0',
    response: { outputSpeech: { type: 'PlainText', text: String(text || 'Ok.') }, shouldEndSession: true },
    sessionAttributes: {}
  };
}

export async function handler(event, context){
  try {
    // Validação simples do Skill ID (hardcoded)
    try {
      const appId = event?.session?.application?.applicationId || event?.context?.System?.application?.applicationId || '';
      if (appId && appId !== SKILL_ID) {
        return alexaResponse('Aplicativo não autorizado.');
      }
    } catch {}

    // Encaminhar a própria carga da Alexa para o backend
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event || {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // Se o backend retornar no formato Alexa, apenas repassar
    const data = await r.json().catch(()=>null);
    if (r.ok && data && data.version === '1.0' && data.response) {
      return data;
    }

    // Fallback: se vier outro JSON, extrair texto
    if (r.ok && data && (data.answer || data.text)){
      return alexaResponse(data.answer || data.text);
    }

    return alexaResponse('Serviço indisponível no momento.');
  } catch (e) {
    return alexaResponse('Falha ao processar sua solicitação.');
  }
}

