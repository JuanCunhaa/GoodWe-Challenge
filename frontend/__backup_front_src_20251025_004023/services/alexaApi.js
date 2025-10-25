// src/services/alexaApi.js

// Simula a verificação de cada passo no backend.
// Substitua por fetch/axios para seu endpoint real.
export async function verifyAlexaStep(step) {
  // Ex.: const r = await fetch(`/api/alexa/verify-step`, { method:'POST', body: JSON.stringify({ step }) })
  // const { ok } = await r.json(); return ok;
  await delay(700);
  return true; // <- deixe true enquanto integra
}

// Verificação periódica da conexão após conectado.
export async function checkAlexaConnection() {
  // Ex.: const r = await fetch(`/api/alexa/health`); const { connected } = await r.json(); return connected;
  await delay(300);
  return true; // <- deixe true enquanto integra
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
