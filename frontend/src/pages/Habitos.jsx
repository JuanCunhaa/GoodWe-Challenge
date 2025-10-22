import { useEffect, useState, useMemo } from 'react'
import { habitsApi } from '../services/habitsApi.js'
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

  async function onState(it, state){
    try{ const token = localStorage.getItem('token'); await habitsApi.setState(token, it.id, state); await refresh() } catch {}
  }
  async function onUndo(it){ try{ const token = localStorage.getItem('token'); await habitsApi.undo(token, it.id); await refresh() } catch {} }

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
        </div>
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}
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
