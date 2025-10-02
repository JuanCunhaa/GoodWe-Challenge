import { insertDeviceHistory } from '../db.js';

export async function startIotIngestor({ helpers }){
  const enabled = String(process.env.ANALYTICS_IOT_POLL_ENABLED || 'true') === 'true';
  if (!enabled) return { stop: () => {} };

  const intervalMs = Math.max(30_000, Number(process.env.ANALYTICS_IOT_POLL_INTERVAL_MS || 60_000));
  let stop = false;

  async function pollOnce(){
    try {
      const base = (process.env.BASE_URL || '').replace(/\/$/, '');
      // we prefer internal calls using helpers.deriveBaseUrl needs req; we don't have req here
      // fallback: localhost
      const apiBase = base ? (base + '/api') : ('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api');
      const svcToken = process.env.ASSIST_TOKEN || ''; // reuse service token for auth
      if (!svcToken) return; // require token for internal polling
      const headers = { 'Authorization': `Bearer ${svcToken}` };

      // SmartThings
      try {
        const st = await fetch(apiBase + '/smartthings/devices', { headers, signal: AbortSignal.timeout(20000) }).then(r=>r.json());
        const list = Array.isArray(st?.items) ? st.items : [];
        for (const d of list.slice(0,50)){
          try {
            const s = await fetch(`${apiBase}/smartthings/device/${encodeURIComponent(d.id)}/status`, { headers, signal: AbortSignal.timeout(20000) }).then(r=>r.json());
            const c = s?.status?.components?.main || {};
            const sw = String(c?.switch?.switch?.value || '').toLowerCase();
            const on = sw === 'on';
            const power = Number(c?.powerMeter?.power?.value ?? NaN);
            const energyKwh = Number(c?.energyMeter?.energy?.value ?? NaN);
            await insertDeviceHistory({ vendor:'smartthings', device_id: d.id, name: d.name, room: d.roomName||'', ts: Date.now(), state_on: on, power_w: Number.isFinite(power)? power : null, energy_wh: Number.isFinite(energyKwh)? (energyKwh*1000) : null, source: 'poll' });
          } catch {}
        }
      } catch {}

      // Tuya
      try {
        const tu = await fetch(apiBase + '/tuya/devices', { headers, signal: AbortSignal.timeout(20000) }).then(r=>r.json());
        const list = Array.isArray(tu?.items) ? tu.items : [];
        for (const d of list.slice(0,100)){
          try {
            const id = d.id || d.device_id || d.devId || '';
            const s = await fetch(`${apiBase}/tuya/device/${encodeURIComponent(id)}/status`, { headers, signal: AbortSignal.timeout(20000) }).then(r=>r.json());
            const comp = s?.status?.components?.main;
            let on = null; let power_w = null; let energy_wh = null;
            if (comp && comp.switch?.switch?.value) on = String(comp.switch.switch.value) === 'on';
            const map = (comp? null : (s?.status && typeof s.status === 'object' ? s.status : null)) || {};
            const powerCandidates = ['cur_power','power','power_w','pwr','va_power'];
            for (const k of powerCandidates){ if (map && map[k]!=null && Number.isFinite(Number(map[k]))) { power_w = Number(map[k]); break; } }
            const energyCandidates = ['add_ele','energy','kwh','elec_total'];
            for (const k of energyCandidates){ if (map && map[k]!=null && Number.isFinite(Number(map[k]))) { const v = Number(map[k]); energy_wh = (k.includes('kwh')||k.includes('ele')) ? (v*1000) : v; break; } }
            await insertDeviceHistory({ vendor:'tuya', device_id: id, name: d.name, room: d.roomName||'', ts: Date.now(), state_on: on, power_w, energy_wh, source: 'poll' });
          } catch {}
        }
      } catch {}
    } catch {}
  }

  (async function loop(){
    while(!stop){
      await pollOnce();
      await new Promise(r => setTimeout(r, intervalMs));
    }
  })();

  return { stop: () => { stop = true; } };
}

