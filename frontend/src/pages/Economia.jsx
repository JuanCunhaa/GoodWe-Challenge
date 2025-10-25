import { useEffect, useMemo, useState } from 'react'
import { energyService } from '../services/energyService.js'
import { automationsApi } from '../services/automationsApi.js'

function toDateStr(d){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}` }

function Panel({ title, children }){
  return (
    <div className="card">
      <div className="h2 mb-2">{title}</div>
      <div className="grid gap-2">{children}</div>
    </div>
  )
}

function currencyBRL(v){
  try { return (Number(v)||0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' }) } catch { return `R$ ${(Number(v)||0).toFixed(2)}` }
}

export default function Economia(){
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [today, setToday] = useState({ kwh: 0, brl: 0 })
  const [month, setMonth] = useState({ kwh: 0, brl: 0 })
  const [autos, setAutos] = useState([])
  const [autoLoading, setAutoLoading] = useState(false)
  const [autoErr, setAutoErr] = useState('')
  const [autoSavings, setAutoSavings] = useState({}) // id -> { kwh, brl }

  const tariffBRL = useMemo(()=>{
    const n = Number(import.meta.env.VITE_TARIFF_BRL_KWH)
    return Number.isFinite(n) && n>0 ? n : 1.0
  },[])

  function computeSavings({ load, grid, gridExp }){
    const imp = Math.max(0, Number(grid||0) - Number(gridExp||0))
    const self = Math.max(0, Number(load||0) - imp)
    const brl = self * tariffBRL
    return { kwh: +self.toFixed(3), brl: +brl.toFixed(2) }
  }

  useEffect(()=>{
    const token = localStorage.getItem('token')
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    if (!token || !user?.powerstation_id) return
    const plantId = user.powerstation_id
    ;(async()=>{
      setLoading(true); setError('')
      try{
        // Hoje
        const ds = new Date().toISOString().slice(0,10)
        const r = await energyService.getDayAggregatesCached(token, plantId, ds)
        const t = computeSavings({ load:r.energy.load, grid:r.energy.grid, gridExp:r.energy.gridExp })
        setToday(t)
        // Mês atual
        const now = new Date();
        const start = toDateStr(new Date(now.getFullYear(), now.getMonth(), 1))
        const end = toDateStr(now)
        const range = await energyService.getRangeAggregates({ token, plantId, start, end })
        let sumKwh = 0
        for (const it of (range.items||[])){
          const s = computeSavings({ load:it.energy?.load, grid:it.energy?.grid, gridExp:it.energy?.gridExp })
          sumKwh += s.kwh
        }
        const brl = sumKwh * tariffBRL
        setMonth({ kwh:+sumKwh.toFixed(3), brl:+brl.toFixed(2) })
      }catch(e){ setError(String(e.message||e)) }
      finally{ setLoading(false) }
    })()
  },[])

  async function refreshAutos(){
    const token = localStorage.getItem('token')
    if (!token) return
    setAutoLoading(true); setAutoErr('')
    try{
      const j = await automationsApi.list(token)
      const arr = Array.isArray(j.items)? j.items : []
      setAutos(arr)
      // compute savings per automation (estimativa acumulada)
      const now = new Date();
      for (const a of arr){
        try{
          const created = a.created_at ? new Date(a.created_at) : null
          const days = created? Math.max(1, Math.floor((now - created)/86400000)) : 14
          const r = await automationsApi.train(token, { automation_id: a.id, window_days: days, k:0, promoteIfReady:false })
          const m = r?.metrics || {}
          const perDayKwh = Number(m.savings_wh||0)/1000
          const cumKwh = Math.max(0, perDayKwh * Number(m.days_cur||days))
          const brl = cumKwh * tariffBRL
          setAutoSavings(prev => ({ ...prev, [a.id]: { kwh:+cumKwh.toFixed(3), brl:+brl.toFixed(2) } }))
        }catch{}
      }
    }catch(e){ setAutoErr(String(e.message||e)) }
    finally{ setAutoLoading(false) }
  }

  useEffect(()=>{ refreshAutos() },[])

  return (
    <section className="grid gap-6">
      <Panel title="Economia Solar (R$)">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="panel">
            <div className="muted text-sm">Hoje</div>
            <div className="text-2xl font-extrabold text-emerald-700">{currencyBRL(today.brl)}</div>
            <div className="muted text-xs">{today.kwh.toLocaleString('pt-BR')} kWh</div>
          </div>
          <div className="panel">
            <div className="muted text-sm">Mês atual</div>
            <div className="text-2xl font-extrabold text-emerald-700">{currencyBRL(month.brl)}</div>
            <div className="muted text-xs">{month.kwh.toLocaleString('pt-BR')} kWh</div>
          </div>
        </div>
        {error && <div className="text-red-600 text-sm mt-2">{error}</div>}
      </Panel>

      <Panel title="Economia por Rotina (estimada)">
        {autos.length===0 ? (
          <div className="muted text-sm">Nenhuma rotina cadastrada.</div>
        ) : (
          <div className="grid gap-2">
            {autos.map(a => {
              const sv = autoSavings[a.id] || { kwh: 0, brl: 0 }
              return (
                <div key={a.id} className="panel flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">{a.name}</div>
                    <div className="muted text-xs">{a.enabled? 'Ativa' : 'Inativa'} • desde {a.created_at ? new Date(a.created_at).toLocaleDateString('pt-BR') : '-'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-emerald-700">{currencyBRL(sv.brl)}</div>
                    <div className="muted text-xs">{sv.kwh.toLocaleString('pt-BR')} kWh</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {autoErr && <div className="text-red-600 text-sm mt-2">{autoErr}</div>}
      </Panel>
    </section>
  )
}

