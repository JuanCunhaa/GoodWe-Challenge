import { useEffect, useState } from 'react'
import { aiApi } from '../services/aiApi.js'

function StatusDot({ ok }){
  return <span className={ok? 'inline-block w-2.5 h-2.5 rounded-full bg-emerald-500' : 'inline-block w-2.5 h-2.5 rounded-full bg-rose-500'} />
}

export default function Sugestoes(){
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [forecast, setForecast] = useState(null)
  const [recs, setRecs] = useState([])

  useEffect(()=>{
    const token = localStorage.getItem('token')
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    if (!token || !user?.powerstation_id) { setErr('Sem autenticação'); setLoading(false); return }
    ;(async ()=>{
      try {
        const [f, r] = await Promise.all([
          aiApi.forecast(token, 24),
          aiApi.recommendations(token)
        ])
        setForecast(f)
        setRecs(r?.recommendations || [])
      } catch (e) { setErr(String(e?.message||e)); }
      finally { setLoading(false) }
    })()
  }, [])

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
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="card">
              <div className="h3 mb-1">Previsão (próximas {forecast?.hours||24}h)</div>
              <div className="muted mb-2">Geração e consumo estimados por hora</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="py-1 pr-2">Hora</th>
                      <th className="py-1 pr-2">Geração (kWh)</th>
                      <th className="py-1 pr-2">Consumo (kWh)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(forecast?.items||[]).map((it,i)=> {
                      const d = new Date(it.time); const hh = String(d.getHours()).padStart(2,'0')
                      return (
                        <tr key={i} className="border-t border-gray-200/50 dark:border-gray-800/50">
                          <td className="py-1 pr-2">{hh}:00</td>
                          <td className="py-1 pr-2">{(it.generation_kwh||0).toFixed(3)}</td>
                          <td className="py-1 pr-2">{(it.consumption_kwh||0).toFixed(3)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-sm">
                <div>Total geração: <span className="font-semibold">{(forecast?.total_generation_kwh||0).toFixed(2)} kWh</span></div>
                <div>Total consumo: <span className="font-semibold">{(forecast?.total_consumption_kwh||0).toFixed(2)} kWh</span></div>
              </div>
            </div>
            <div className="card lg:col-span-2">
              <div className="h3 mb-1">Dicas personalizadas</div>
              <div className="grid gap-2">
                {recs.length === 0 && <div className="panel">Nada por aqui por enquanto.</div>}
                {recs.map((r,idx)=> (
                  <div key={idx} className="panel flex items-start gap-3">
                    <StatusDot ok={!/acima|alto|pico/.test(r?.text||'')} />
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
          </div>
        </>
      )}
    </div>
  )
}

