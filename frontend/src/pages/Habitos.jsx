import { useEffect, useState, useMemo } from 'react'
import { habitsApi } from '../services/habitsApi.js'
import { automationsApi } from '../services/automationsApi.js'
import { loadSession } from '../services/authApi.js'

function Badge({ state }){
  const cls = {
    shadow: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
    suggested: 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100',
    active: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100',
    paused: 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100',
    retired: 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100',
  }[state] || 'bg-slate-200'
  return <span className={`px-2 py-0.5 rounded text-xs ${cls}`}>{state}</span>
}

function rowTitle(it){
  const trig = `${it.trigger_vendor}:${it.trigger_device_id}`
  const act = `${it.action_vendor}:${it.action_device_id}`
  return `Quando ${trig} → ${it.trigger_event.toUpperCase()} então ${act} → ${it.action_event.toUpperCase()}`
}

export default function Habitos(){
  const [items, setItems] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [autos, setAutos] = useState([])
  const [autoLoading, setAutoLoading] = useState(false)
  const [autoError, setAutoError] = useState('')
  const [simById, setSimById] = useState({})

  async function refresh(){
    setLoading(true); setError('')
    try{
      const token = localStorage.getItem('token')
      const j = await habitsApi.list(token)
      setItems(Array.isArray(j.items)? j.items : [])
      const lj = await habitsApi.logs(token, { limit: 100 })
      setLogs(Array.isArray(lj.items)? lj.items : [])
    }catch(e){ setError(String(e.message||e)) }
    finally{ setLoading(false) }
  }

  useEffect(()=>{ refresh() },[])

  async function refreshAutos(){
    setAutoLoading(true); setAutoError('')
    try{
      const token = localStorage.getItem('token')
      const j = await automationsApi.list(token)
      const arr = Array.isArray(j.items)? j.items : []
      setAutos(arr)
    }catch(e){ setAutoError(String(e.message||e)) }
    finally{ setAutoLoading(false) }
  }

  useEffect(()=>{ refreshAutos() },[])

  async function onState(it, state){
    try{ const token = localStorage.getItem('token'); await habitsApi.setState(token, it.id, state); await refresh() } catch {}
  }
  async function onUndo(it){ try{ const token = localStorage.getItem('token'); await habitsApi.undo(token, it.id); await refresh() } catch {} }

  // Automations helpers/actions
  function parseJson(s, d={}){ try{ return s? JSON.parse(s): d } catch { return d } }
  function scheduleStr(a){ const sch = parseJson(a.schedule_json||'{}'); const days = Array.isArray(sch.days)? sch.days.join(','):'0-6'; return `${sch.start||'--:--'} - ${sch.end||'--:--'} (dias: ${days})` }
  function isExperimental(a){ const cond = parseJson(a.conditions_json||'{}'); return cond.experimental === true }
  async function simulateAuto(a){
    try{
      const token = localStorage.getItem('token')
      const routine = { name:a.name, kind:a.kind, schedule: parseJson(a.schedule_json||'{}'), actions: parseJson(a.actions_json||'{}') }
      const r = await automationsApi.simulate(token, routine)
      setSimById(prev => ({ ...prev, [a.id]: { pct: r.predicted_savings_pct, kwh: r.predicted_savings_kwh } }))
    }catch(e){ setSimById(prev => ({ ...prev, [a.id]: { error: String(e.message||e) } })) }
  }
  async function trainAuto(a, promote=false){
    try{
      const token = localStorage.getItem('token')
      await automationsApi.train(token, { automation_id: a.id, window_days: 7, k: 3, promoteIfReady: !!promote })
      await simulateAuto(a)
    }catch(e){ setAutoError(String(e.message||e)) }
  }
  async function toggleAuto(a){
    try{
      const token = localStorage.getItem('token')
      await automationsApi.update(token, a.id, { name:a.name, enabled: !a.enabled, kind:a.kind, schedule: parseJson(a.schedule_json||'{}'), conditions: parseJson(a.conditions_json||'{}'), actions: parseJson(a.actions_json||'{}') })
      await refreshAutos()
    }catch(e){ setAutoError(String(e.message||e)) }
  }

  const groups = useMemo(()=>{
    const map = new Map()
    for (const it of items){ const k=String(it.state||'shadow'); if(!map.has(k)) map.set(k, []); map.get(k).push(it) }
    return Array.from(map.entries()).sort((a,b)=> a[0].localeCompare(b[0]))
  }, [items])

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between">
        <div className="h2">Hábitos e Mini‑Rotinas</div>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={refresh} disabled={loading}>{loading? 'Atualizando...' : 'Atualizar'}</button>
          <button className="btn" onClick={refreshAutos} disabled={autoLoading}>{autoLoading? 'Carregando rotinas...' : 'Atualizar Rotinas'}</button>
        </div>
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {autoError && <div className="text-red-600 text-sm">{autoError}</div>}
      <div className="card">
        <div className="h2 mb-2">Rotinas de Energia</div>
        {autos.length===0 ? (
          <div className="muted text-sm">Sem rotinas cadastradas.</div>
        ) : (
          <div className="grid gap-2">
            {autos.map(a => {
              const sim = simById[a.id] || {}
              return (
                <div key={a.id} className="panel flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">{a.name} {a.enabled? <span className="text-emerald-600 text-xs ml-2">Ativa</span> : <span className="text-slate-500 text-xs ml-2">Inativa</span>} {isExperimental(a) && <span className="text-amber-600 text-xs ml-2">Experimental</span>}</div>
                    <div className="muted text-xs">tipo: {a.kind} • janela: {scheduleStr(a)}</div>
                    {sim.pct!=null && (
                      <div className="text-xs mt-0.5">Economia prevista: <span className="font-semibold">{Number(sim.pct).toFixed(1)}%</span> {sim.kwh!=null? `(${Number(sim.kwh).toFixed(2)} kWh)`: ''}</div>
                    )}
                    {sim.error && (<div className="text-xs text-red-600">{sim.error}</div>)}
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="btn" onClick={()=> simulateAuto(a)} disabled={autoLoading}>Simular</button>
                    <button className="btn" onClick={()=> trainAuto(a, false)} disabled={autoLoading}>Treinar</button>
                    <button className="btn" onClick={()=> trainAuto(a, true)} disabled={autoLoading}>Promover se pronto</button>
                    <button className="btn btn-ghost" onClick={()=> toggleAuto(a)}>{a.enabled? 'Desativar':'Ativar'}</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="grid gap-6">
        {groups.map(([state, list]) => (
          <div key={state} className="card">
            <div className="flex items-center justify-between mb-2">
              <div className="h3 flex items-center gap-2">Estado: <Badge state={state}/></div>
              <div className="muted text-sm">{list.length} itens</div>
            </div>
            <div className="grid gap-2">
              {list.map(it => (
                <div key={it.id} className="panel flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">{rowTitle(it)}</div>
                    <div className="muted text-xs">conf: {(Number(it.confidence)||0).toFixed(2)} • pares: {it.pairs_total} • disparos: {it.triggers_total} • atraso médio: {it.avg_delay_s? Number(it.avg_delay_s).toFixed(1): '-'} s • ctx: {it.context_key||'global'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {it.state==='suggested' && (
                      <button className="btn btn-primary" onClick={()=> onState(it, 'active')}>Ativar</button>
                    )}
                    {it.state==='shadow' && (
                      <button className="btn" onClick={()=> onState(it, 'suggested')}>Promover</button>
                    )}
                    {it.state==='active' && (
                      <>
                        <button className="btn" onClick={()=> onState(it, 'paused')}>Pausar</button>
                        <button className="btn btn-ghost" onClick={()=> onUndo(it)}>Desfazer</button>
                      </>
                    )}
                    {it.state==='paused' && (
                      <button className="btn" onClick={()=> onState(it, 'active')}>Retomar</button>
                    )}
                    <button className="btn btn-ghost" onClick={()=> onState(it, 'retired')}>Arquivar</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="card">
          <div className="h2 mb-2">Timeline de decisões</div>
          <div className="grid gap-2 max-h-[420px] overflow-auto pr-2">
            {logs.length===0 ? (
              <div className="muted text-sm">Sem eventos ainda.</div>
            ) : logs.map(l => (
              <div key={l.id} className="panel flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-sm">{new Date(l.ts||l.time||Date.now()).toLocaleString()} • {String(l.event)}</div>
                  <div className="muted text-xs">
                    {`${l.trigger_vendor}:${l.trigger_device_id} → ${String(l.trigger_event||'').toUpperCase()}  ⇒  ${l.action_vendor}:${l.action_device_id} → ${String(l.action_event||'').toUpperCase()}`} {l.context_key? ` • ctx:${l.context_key}`:''} {l.state? ` • ${l.state}`:''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
