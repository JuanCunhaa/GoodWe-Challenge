import { useEffect, useMemo, useState } from 'react'
import { aiApi } from '../services/aiApi.js'

function StatusDot({ ok }){
  return <span className={ok? 'inline-block w-2.5 h-2.5 rounded-full bg-emerald-500' : 'inline-block w-2.5 h-2.5 rounded-full bg-rose-500'} />
}

function HourBars({ items=[] }){
  // Simple side-by-side bars per hour (gen vs cons)
  const max = useMemo(()=>{
    return items.reduce((m,it)=> Math.max(m, (it.generation_kwh||0), (it.consumption_kwh||0)), 0) || 1
  },[items])
  return (
    <div className="mt-2 overflow-x-auto">
      <div className="min-w-[720px] grid grid-cols-24 gap-1 items-end h-40">
        {items.map((it,i)=>{
          const g = (it.generation_kwh||0)/max
          const c = (it.consumption_kwh||0)/max
          const d = new Date(it.time); const hh = String(d.getHours()).padStart(2,'0')
          return (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="w-3 sm:w-4 flex gap-0.5 items-end">
                <div className="w-1.5 bg-emerald-500/70 rounded" style={{ height: `${Math.max(3,g*100)}%` }} title={`Geração ${hh}:00`} />
                <div className="w-1.5 bg-rose-500/70 rounded" style={{ height: `${Math.max(3,c*100)}%` }} title={`Consumo ${hh}:00`} />
              </div>
              <div className="text-[10px] muted">{hh}</div>
            </div>
          )
        })}
      </div>
      <div className="text-xs mt-2 flex items-center gap-3">
        <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-emerald-500/70 rounded"></span> Geração</div>
        <div className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-rose-500/70 rounded"></span> Consumo</div>
      </div>
    </div>
  )
}

export default function Sugestoes(){
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [forecast, setForecast] = useState(null)
  const [recs, setRecs] = useState([])
  const [devices, setDevices] = useState([])

  const totals = useMemo(()=>({
    gen: Number(forecast?.total_generation_kwh||0),
    cons: Number(forecast?.total_consumption_kwh||0),
  }),[forecast])

  useEffect(()=>{
    const token = localStorage.getItem('token')
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    if (!token || !user?.powerstation_id) { setErr('Sem autenticação'); setLoading(false); return }
    ;(async ()=>{
      try {
        const [f, r, d] = await Promise.all([
          aiApi.forecast(token, 24),
          aiApi.recommendations(token),
          aiApi.devicesOverview(token)
        ])
        // order by ascending time
        const items = (f?.items||[]).slice().sort((a,b)=> new Date(a.time)-new Date(b.time))
        setForecast({ ...f, items })
        setRecs(r?.recommendations || [])
        setDevices(d?.items || [])
      } catch (e) { setErr(String(e?.message||e)); }
      finally { setLoading(false) }
    })()
  }, [])

  const noData = !loading && !err && ((totals.gen+totals.cons) < 0.01)
  const topNow = useMemo(()=> devices.filter(d => d && d.on && Number.isFinite(+d.power_w)).sort((a,b)=> b.power_w - a.power_w).slice(0,5), [devices])

  return (
    <div className="grid gap-4">
      <div className="card">
        <div className="h2">Sugestões de Economia</div>
        <div className="muted">Previsões + dicas baseadas no seu histórico</div>
      </div>
      {loading ? (
        <div className="panel">Carregando…</div>
      ) : err ? (
        <div className="panel text-rose-500">{err}</div>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="panel">
              <div className="text-xs muted">Próximas {forecast?.hours||24}h</div>
              <div className="text-3xl font-extrabold mt-1">{totals.gen.toFixed(1)} kWh</div>
              <div className="muted text-xs">Geração estimada</div>
            </div>
            <div className="panel">
              <div className="text-xs muted">Próximas {forecast?.hours||24}h</div>
              <div className="text-3xl font-extrabold mt-1">{totals.cons.toFixed(1)} kWh</div>
              <div className="muted text-xs">Consumo estimado</div>
            </div>
            <div className="panel">
              <div className="text-xs muted">Clima</div>
              <div className="mt-1 text-sm">
                {recs.find(r=>/Previs[ãa]o clim|clim[aá]tica|nublado|chuva/i.test(r.text))?.text || 'Sem alerta climático no momento.'}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="h3">Geração x Consumo por hora</div>
            {noData ? (
              <div className="muted text-sm">Histórico insuficiente para prever por hora. Volte mais tarde após algumas horas de operação.</div>
            ) : (
              <HourBars items={forecast?.items||[]} />
            )}
          </div>

          <div className="card">
            <div className="h3 mb-2">Top consumidores agora</div>
            {topNow.length === 0 ? (
              <div className="muted text-sm">Nenhum dispositivo relevante em consumo no momento.</div>
            ) : (
              <div className="grid gap-2">
                {topNow.map((d,idx)=> (
                  <div key={idx} className="panel flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{d.name}{d.roomName? ` (${d.roomName})`: ''}</div>
                      <div className="muted text-xs">{d.vendor} • {d.on? 'Ligado':'Desligado'}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-extrabold">{Math.round(d.power_w)} W</div>
                      {Number.isFinite(+d.energy_kwh) && <div className="muted text-xs">{(+d.energy_kwh).toFixed(1)} kWh</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="h3 mb-1">Dicas personalizadas</div>
            <div className="grid gap-2">
              {recs.length === 0 && <div className="panel">Nada por aqui por enquanto.</div>}
              {recs.map((r,idx)=> (
                <div key={idx} className="panel flex items-start gap-3">
                  <StatusDot ok={!/acima|alto|pico|nublado|chuva/i.test(r?.text||'')} />
                  <div>
                    <div>{r.text}</div>
                    {r.metric && Object.keys(r.metric).length>0 && (
                      <div className="muted text-xs mt-1">{JSON.stringify(r.metric)}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
