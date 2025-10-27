export function registerAlexaRoutes(router, { helpers }){
  const SKILL_ID = '1f6aa4d0-6ef8-435c-9b8d-9f2942df4f4d';
  const PLANT_ID = '7f9af1fc-3a9a-4779-a4c0-ca6ec87bd93a';

  function extractUtterance(body){
    if (!body || typeof body !== 'object') return '';
    // explicit fields first
    const explicit = body.input || body.text || body.query || body.q || '';
    if (explicit && typeof explicit === 'string') return explicit;
    // Alexa-style IntentRequest slots
    try {
      const req = body.request || {};
      if (req.type === 'IntentRequest'){
        const intent = req.intent || {};
        const slots = intent.slots || {};
        const parts = [];
        for (const k of Object.keys(slots)){
          const v = slots[k];
          if (v && typeof v.value === 'string' && v.value.trim()) parts.push(v.value.trim());
        }
        if (parts.length) return parts.join(' ');
        if (typeof intent.name === 'string' && intent.name) return intent.name;
      }
    } catch {}
    return '';
  }

  async function callAssistant(req, { input }){
    const svcToken = process.env.ASSIST_TOKEN || '';
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || '';
    if (!OPENAI_API_KEY) throw new Error('assistant unavailable: missing OPENAI_API_KEY');
    if (!svcToken) throw new Error('assistant unavailable: missing ASSIST_TOKEN');
    const base = helpers.deriveBaseUrl(req).replace(/\/$/, '') + '/api';
    const url = `${base}/assistant/chat?powerstation_id=${encodeURIComponent(PLANT_ID)}`;
    const headers = { 'Authorization': `Bearer ${svcToken}`, 'Content-Type':'application/json' };
    const r = await fetch(url, { method:'POST', headers, body: JSON.stringify({ input: String(input||'') }), signal: AbortSignal.timeout(Number(process.env.TIMEOUT_MS||30000)) });
    const j = await r.json().catch(()=>null);
    if (!r.ok) throw new Error(j?.error || `${r.status}`);
    const answer = String(j?.answer || '').trim() || 'Ok.';
    return { answer, steps: Array.isArray(j?.steps)? j.steps: [] };
  }

  // Accept GET (q=) and POST (raw Alexa or { input })
  router.all(`/alexa/${SKILL_ID}`, async (req, res) => {
    try{
      const input = String(req.query?.q || extractUtterance(req.body) || '').trim();
      const debugFlag = (String(process.env.ALEXA_DEBUG||'')==='1') || /^(1|true)$/i.test(String(req.query?.debug||''));
      if (!input) return res.status(400).json({ ok:false, error:'input required' });
      const { answer, steps } = await callAssistant(req, { input });

      // If payload looks like Alexa request, shape Alexa response
      const looksAlexa = !!(req.body && typeof req.body==='object' && (req.body.session || req.body.context) && req.body.request);
      if (looksAlexa && !debugFlag){
        return res.json({
          version: '1.0',
          response: { outputSpeech: { type: 'PlainText', text: answer }, shouldEndSession: true },
          sessionAttributes: {}
        });
      }
      if (debugFlag){
        try{ console.log('[alexa][debug]', { method:req.method, path:req.path, query:req.query, headers: { 'user-agent': req.headers['user-agent'] }, body: req.body, input, answer }); } catch {}
      }
      return res.json({ ok:true, input, answer, steps, received: debugFlag ? { method:req.method, query:req.query, body:req.body } : undefined });
    } catch (e) {
      return res.status(500).json({ ok:false, error: String(e) });
    }
  });
}
