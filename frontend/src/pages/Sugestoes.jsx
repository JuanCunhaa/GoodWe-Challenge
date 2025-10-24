import { useEffect, useMemo, useState } from 'react'
import { aiApi } from '../services/aiApi.js'

function StatusDot({ ok }){
  return <span className={ok? 'inline-block w-2.5 h-2.5 rounded-full bg-emerald-500' : 'inline-block w-2.5 h-2.5 rounded-full bg-rose-500'} />
}

// (GrÃ¡fico removido a pedido; manter UI clean)

export default function Sugestoes(){
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [forecast, setForecast] = useState(null)
  const [recs, setRecs] = useState([])
  const [devices, setDevices] = useState([])
  const [uptime, setUptime] = useState({})
  const [usage, setUsage] = useState({}) // key -> { kwh, cost_brl? }

  const totals = useMemo(()=>({
    gen: Number(forecast?.total_generation_kwh||0),
    cons: Number(forecast?.total_consumption_kwh||0),
  }),[forecast])

  useEffect(()=>{
    const token = localStorage.getItem('token')
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    if (!token || !user?.powerstation_id) { setErr('Sem autenticaÃ§Ã£o'); setLoading(false); return }
    ;(async ()=>{
      try {
        const s = await aiApi.suggestions(token, 24, '60')
        const f = s?.forecast || null
        const items = (f?.items||[]).slice().sort((a,b)=> new Date(a.time)-new Date(b.time))
        setForecast(f? { ...f, items } : null)
        setRecs(Array.isArray(s?.recommendations) ? s.recommendations : [])
        setDevices(Array.isArray(s?.devices) ? s.devices : [])
      } catch (e) {
        // fallback para rotas antigas
        try {
          const [f, r, d] = await Promise.all([
            aiApi.forecast(token, 24),
            aiApi.recommendations(token),
            aiApi.devicesOverview(token)
          ])
          const items = (f?.items||[]).slice().sort((a,b)=> new Date(a.time)-new Date(b.time))
          setForecast({ ...f, items })
          setRecs(r?.recommendations || [])
          setDevices(d?.items || [])
        } catch(err2){ setErr(String(err2?.message||err2)); }
      } finally { setLoading(false) }
    })()
  }, [])

  const topNow = useMemo(()=> devices.filter(d => d && d.on && Number.isFinite(+d.power_w)).sort((a,b)=> b.power_w - a.power_w).slice(0,3), [devices])

  // Removido: cálculo de "Top cômodos" para focar apenas em dicas

  // Fetch uptime (24h) and energy usage (24h) for top devices
  useEffect(()=>{
    const run = async () => {
      try{
        const token = localStorage.getItem('token'); if (!token) return;
        const tariff = (import.meta.env.VITE_TARIFF_BRL_PER_KWH!=null) ? Number(import.meta.env.VITE_TARIFF_BRL_PER_KWH) : undefined;
        await Promise.all(topNow.map(async (d)=>{
          try{
            const key = d.vendor+'|'+d.id;
            const r = await aiApi.iotUptime(token, d.vendor, d.id, '24h');
            if (r && typeof r.total_on_minutes === 'number') setUptime(m => ({ ...m, [key]: r.total_on_minutes }));
            const u = await aiApi.deviceUsageByHour(token, d.vendor, d.id, '24h', tariff);
            const kwh = Number(u?.total_energy_kwh || 0);
            const cost = Number(u?.total_cost_brl || NaN);
            setUsage(m => ({ ...m, [key]: { kwh, cost_brl: Number.isFinite(cost)? cost : undefined } }));
          } catch {}
        }))
      } catch {}
    };
    if (topNow.length) run();
  }, [topNow])

  function formatMinutes(total){
    const m = Math.round(Number(total||0));
    const h = Math.floor(m/60);
    const mm = m % 60;
    if (h <= 0) return `${m} min`;
    return `${h}h ${mm}m`;
  }

  return (
    <div className="grid gap-4">
      <div className="card">
        <div className="h2">SugestÃµes de Economia</div>
        <div className="muted">PrevisÃµes + dicas baseadas no seu histÃ³rico</div>
      </div>
      {loading ? (
        <div className="panel">Carregandoâ€¦</div>
      ) : err ? (
        <div className="panel text-rose-500">{err}</div>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="panel">
              <div className="text-xs muted">PrÃ³ximas {forecast?.hours||24}h</div>
              <div className="text-3xl font-extrabold mt-1">{totals.gen.toFixed(1)} kWh</div>
              <div className="muted text-xs">GeraÃ§Ã£o estimada</div>
            </div>
            <div className="panel">
              <div className="text-xs muted">PrÃ³ximas {forecast?.hours||24}h</div>
              <div className="text-3xl font-extrabold mt-1">{totals.cons.toFixed(1)} kWh</div>
              <div className="muted text-xs">Consumo estimado</div>
            </div>
            <div className="panel">
              <div className="text-xs muted">Clima</div>
              <div className="mt-1 text-sm">
                {recs.find(r=>/Previs[Ã£a]o clim|clim[aÃ¡]tica|nublado|chuva/i.test(r.text))?.text || 'Sem alerta climÃ¡tico no momento.'}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="h3 mb-2">Top consumidores agora</div>
            {topNow.length === 0 ? (
              <div className="muted text-sm">Nenhum dispositivo relevante em consumo no momento.</div>
            ) : (
              <div className="grid gap-2">
                {topNow.map((d,idx)=> (
                  <div key={idx} className="panel flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold truncate" title={d.name}>{d.name}{d.roomName? ` (${d.roomName})`: ''}</div>
                      <div className="muted text-xs truncate">{d.vendor} â€¢ {d.on? 'Ligado':'Desligado'}</div>
                    </div>
                    <div className="text-right shrink-0">
                      {(() => {
                        const key = d.vendor+'|'+d.id; const u = usage[key];
                        const kwh = (u && typeof u.kwh === 'number') ? u.kwh : (Number(d.energy_kwh)||0);
                        const cost = (u && Number.isFinite(u.cost_brl)) ? u.cost_brl : null;
                        const costText = (cost!=null) ? (' - R$ ' + cost.toFixed(2)) : '';
                        return (
                          <>
                            <div className="text-lg font-extrabold">{(kwh||0).toFixed(2)} kWh</div>
                            <div className="muted text-xs">Potência agora: {Math.round(Number(d.power_w)||0)} W{costText}</div>
                          </>
                        );
                      })()}
                      {typeof uptime[d.vendor+'|'+d.id] === 'number' && <div className="mt-0.5 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Uptime 24h: {formatMinutes(uptime[d.vendor+'|'+d.id])}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Seção "Top cômodos" removida a pedido do cliente */}
            <div className="h3 mb-1">Dicas personalizadas</div>
            <div className="grid gap-2">
              {recs.length === 0 && <div className="panel">Nada por aqui por enquanto.</div>}
              {recs.map((r,idx)=> (
                <div key={idx} className="panel flex items-start gap-3">
                  <StatusDot ok={!/acima|alto|pico|nublado|chuva/i.test(r?.text||'')} />
                  <div><div>{r.text}</div></div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
