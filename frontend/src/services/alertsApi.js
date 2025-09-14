// src/services/alertsApi.js

/**
 * Troque API_BASE pela URL real quando tiver.
 * Exemplo de retorno esperado da sua API (array):
 * [
 *   { id: "al1", level: "info"|"warn"|"crit", msg: "texto do alerta" }
 * ]
 */
const API_BASE = ""; // <-- DEIXE VAZIO AGORA. Depois: "https://sua.api/alerts"

async function fetchJson(url, body) {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * getAlerts({ type, name }) chama sua API para obter alertas
 * type: "generator" | "battery" | "charger" | "vehicle"
 * name: string (nome do dispositivo)
 */
export async function getAlerts({ type, name }) {
  if (!API_BASE) {
    // STUB controlado (NÃO aleatório): retorna vazio.
    // Assim nada aparece até você ligar na API real.
    return [];
  }

  // Exemplo de chamada real — ajuste ao seu contrato:
  // return await fetchJson(`${API_BASE}/alerts`, { type, name });

  // Se sua API for GET com querystring, algo assim:
  // const qs = new URLSearchParams({ type, name }).toString();
  // return await fetchJson(`${API_BASE}/alerts?${qs}`);

  return []; // fallback seguro
}
