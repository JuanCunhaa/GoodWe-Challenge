import { useEffect, useMemo, useState } from 'react'
import { loadSession } from '../services/authApi.js'
import { aiApi } from '../services/aiApi.js'

function hh(h){ const x = Number(h)||0; return String(x).padStart(2,'0')+':00' }

export default function Rotina(){
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [hours, setHours] = useState([]) // { hour, energy_kwh, on_minutes }
  const [suggestions, setSuggestions] = useState([])
  const [cost, setCost] = useState(null)
  const [battery, setBattery] = useState(null)

  useEffect(()=>{
    (async()=>{
      setLoading(true); setErr('')
      try{
        const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
        const [sug, cp, bt] = await Promise.all([
          aiApi.automationsSuggest(token, 7).catch(()=>null),
          aiApi.costProjection(token, { hours: 24 }).catch(()=>null),
          aiApi.batteryStrategy(token, { hours: 24 }).catch(()=>null),
        ])
        if (sug?.hours) setHours(Array.isArray(sug.hours)? sug.hours : [])
        if (Array.isArray(sug?.suggestions)) setSuggestions(sug.suggestions)
        if (cp && cp.ok!==false) setCost(cp)
        if (bt && bt.ok!==false) setBattery(bt)
      } catch(e){ setErr(String(e?.message||e)) }
      finally{ setLoading(false) }
    })()
  }, [])

  const metrics = useMemo(()=>{
    const total = hours.reduce((s,h)=> s + (h.energy_kwh||0), 0)
    const top = [...hours].sort((a,b)=> (b.energy_kwh||0)-(a.energy_kwh||0)).slice(0,3)
    const peakHour = top[0]?.hour ?? null
    const firstOn = hours.find(h=> (h.on_minutes||0) >= 5)?.hour ?? null
    const peakWindow = (suggestions.find(s=> s.kind==='peak_saver')?.schedule) || null
    return { total_kwh: +total.toFixed(3), top, peakHour, firstOn, peakWindow }
  }, [hours, suggestions])

  return (
    <section className="grid gap-4">
      <div className="card">
        <div className="h2">Rotina de Energia</div>
        <div className="muted text-sm">Horas de início, picos e janelas sugeridas</div>
      </div>

      {loading ? (
        <div className="panel">Carregando…</div>
      ) : err ? (
        <div className="panel text-rose-600">{err}</div>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="panel">
              <div className="muted text-xs">Maior consumo (24h)</div>
              <div className="text-3xl font-extrabold mt-1">{metrics.peakHour!=null? hh(metrics.peakHour): '-'}</div>
              <div className="muted text-xs">Top hora de energia</div>
            </div>
            <div className="panel">
              <div className="muted text-xs">Primeiras ligações (24h)</div>
              <div className="text-3xl font-extrabold mt-1">{metrics.firstOn!=null? hh(metrics.firstOn): '-'}</div>
              <div className="muted text-xs">Primeira hora com atividade relevante</div>
            </div>
            <div className="panel">
              <div className="muted text-xs">Energia total (24h)</div>
              <div className="text-3xl font-extrabold mt-1">{metrics.total_kwh.toFixed(3)} kWh</div>
              <div className="muted text-xs">Somatório das últimas 24h</div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="card">
              <div className="h3 mb-1">Janela sugerida (pico)</div>
              {metrics.peakWindow ? (
                <div className="muted">{metrics.peakWindow.start} → {metrics.peakWindow.end} (seg–sex)</div>
              ) : (
                <div className="muted">Sem janela específica no momento.</div>
              )}
              <div className="mt-2 grid gap-1">
                {suggestions.map((s, i)=> (
                  <div key={i} className="panel text-sm">
                    <div className="font-semibold">{s.name}</div>
                    <div className="muted">{s.reason||''}</div>
                    {s.schedule && <div className="muted text-xs">{s.schedule.start} → {s.schedule.end}</div>}
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="h3 mb-1">Top horas (24h)</div>
              {metrics.top.length===0 ? (
                <div className="muted text-sm">Sem dados recentes.</div>
              ) : (
                <div className="grid gap-2">
                  {metrics.top.map((h,i)=> (
                    <div key={i} className="panel flex items-center justify-between">
                      <div className="font-semibold">{hh(h.hour)}</div>
                      <div className="muted text-sm">{(+h.energy_kwh).toFixed(3)} kWh · {Math.round(h.on_minutes||0)} min</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="panel">
              <div className="muted text-xs">Projeção de custo (24h)</div>
              <div className="text-2xl font-extrabold mt-1">{cost? (`R$ ${(cost.projected_cost_brl||0).toFixed(2)}`) : '-'}</div>
              <div className="muted text-xs">Importação líquida: {cost? ((cost.net_import_kwh||0).toFixed(2)+' kWh') : '-'}</div>
            </div>
            <div className="panel">
              <div className="muted text-xs">Bateria</div>
              <div className="mt-1 text-sm">
                {battery && Array.isArray(battery.windows) && battery.windows.length
                  ? battery.windows.map((w,idx)=> (
                      <div key={idx}>• {w.action==='charge'?'Carregar':'Descarregar'} em {new Date(w.from).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                    ))
                  : 'Sem janelas recomendadas.'}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

