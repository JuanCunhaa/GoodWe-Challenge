import { useEffect, useState, useMemo } from 'react'
import { habitsApi } from '../services/habitsApi.js'
import { automationsApi } from '../services/automationsApi.js'
import { loadSession } from '../services/authApi.js'
import { integrationsApi } from '../services/integrationsApi.js'

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
  return `Quando ${trig} -> ${String(it.trigger_event||'').toUpperCase()} entao ${act} -> ${String(it.action_event||'').toUpperCase()}`
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
  // filtros e ordenacao
  const [q, setQ] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [sortKey, setSortKey] = useState('confidence')
  const [showManual, setShowManual] = useState(false)
  // manual create form
  const [form, setForm] = useState({
    trigger_vendor: 'smartthings', trigger_device_id: '', trigger_event: 'on',
    action_vendor: 'smartthings', action_device_id: '', action_event: 'off',
    context_key: 'global', delay_s: ''
  })
  const [deviceOptions, setDeviceOptions] = useState([]) // [{vendor,id,name}]

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

  // load devices for manual create
  useEffect(()=>{
    (async ()=>{
      try{
        const token = localStorage.getItem('token'); if (!token) return;
        const out = [];
        try { const st = await integrationsApi.stDevices(token); (st.items||[]).forEach(d=> out.push({ vendor:'smartthings', id:d.id, name:d.name })) } catch {}
        try { const tu = await integrationsApi.tuyaDevices(token); (tu.items||[]).forEach(d=> out.push({ vendor:'tuya', id:(d.id||d.device_id||d.devId), name:d.name })) } catch {}
        setDeviceOptions(out);
      } catch {}
    })();
  },[])

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

  const countsByState = useMemo(()=>{
    const c = { shadow:0, suggested:0, active:0, paused:0, retired:0 };
    for (const it of items){ const k=String(it.state||'shadow'); if (c[k]!=null) c[k]++ }
    return c;
  }, [items])

  const filtered = useMemo(()=>{
    const needle = q.trim().toLowerCase();
    let arr = items.slice();
    if (stateFilter !== 'all') arr = arr.filter(it => String(it.state) === stateFilter);
    if (needle) {
      arr = arr.filter(it => {
        const s = `${it.trigger_vendor}:${it.trigger_device_id} ${it.action_vendor}:${it.action_device_id} ${it.trigger_event} ${it.action_event} ${it.context_key||''}`.toLowerCase();
        return s.includes(needle);
      });
    }
    arr.sort((a,b)=>{
      if (sortKey==='pairs') return (b.pairs_total||0) - (a.pairs_total||0);
      if (sortKey==='last_seen') return new Date(b.last_seen||0) - new Date(a.last_seen||0);
      return (b.confidence||0) - (a.confidence||0);
    });
    return arr;
  }, [items, q, stateFilter, sortKey])

  const groups = useMemo(()=>{
    const map = new Map()
    for (const it of filtered){ const k=String(it.state||'shadow'); if(!map.has(k)) map.set(k, []); map.get(k).push(it) }
    const order = ['active','suggested','paused','shadow','retired'];
    return Array.from(map.entries()).sort((a,b)=> order.indexOf(a[0]) - order.indexOf(b[0]))
  }, [filtered])

  return (
    <section className="grid gap-4">
      <div className="card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="h2">Habitos e Mini-Rotinas</div>
            <div className="muted text-sm">Padroes detectados a partir do historico de dispositivos; ative, pause ou arquive.</div>
          </div>
          <div className="flex items-center gap-2">
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar por dispositivo/evento..." className="panel px-3 py-2 text-sm outline-none" />
            <button className="btn" onClick={refresh} disabled={loading}>{loading? 'Atualizando...' : 'Atualizar'}</button>
            <button className="btn btn-primary" onClick={()=> setShowManual(true)}>Criar padrao</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {['all','active','suggested','paused','shadow','retired'].map(k => (
            <button key={k} onClick={()=> setStateFilter(k)} className={`pill ${stateFilter===k? 'pill-active':''}`}>
              {k} {k!=='all' && (<span className="ml-1 text-xs muted">({countsByState[k]||0})</span>)}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="muted">Ordenar por</span>
            <select value={sortKey} onChange={e=>setSortKey(e.target.value)} className="panel px-2 py-1 text-sm">
              <option value="confidence">confianca</option>
              <option value="last_seen">ultima ocorrencia</option>
              <option value="pairs">num pares</option>
            </select>
          </div>
        </div>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}
      {autoError && <div className="text-red-600 text-sm">{autoError}</div>}

      {false && (
      <div className="card">
        <div className="h2 mb-2">Criar padrao manualmente</div>
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="panel grid gap-2">
              <div className="font-semibold">Gatilho</div>
              <div className="grid grid-cols-[120px_1fr_120px] gap-2">
                <select className="panel" value={form.trigger_vendor} onChange={e=> setForm(v=>({...v, trigger_vendor:e.target.value}))}>
                  <option value="smartthings">smartthings</option>
                  <option value="tuya">tuya</option>
                </select>
                <select className="panel" value={form.trigger_device_id} onChange={e=> setForm(v=>({...v, trigger_device_id:e.target.value}))}>
                  <option value="">selecione dispositivo...</option>
                  {deviceOptions.filter(d=> d.vendor===form.trigger_vendor).map(d=> (
                    <option key={`${d.vendor}|${d.id}`} value={d.id}>{d.name || d.id}</option>
                  ))}
                </select>
                <select className="panel" value={form.trigger_event} onChange={e=> setForm(v=>({...v, trigger_event:e.target.value}))}>
                  <option value="on">on</option>
                  <option value="off">off</option>
                </select>
              </div>
            </div>
            <div className="panel grid gap-2">
              <div className="font-semibold">Ação</div>
              <div className="grid grid-cols-[120px_1fr_120px] gap-2">
                <select className="panel" value={form.action_vendor} onChange={e=> setForm(v=>({...v, action_vendor:e.target.value}))}>
                  <option value="smartthings">smartthings</option>
                  <option value="tuya">tuya</option>
                </select>
                <select className="panel" value={form.action_device_id} onChange={e=> setForm(v=>({...v, action_device_id:e.target.value}))}>
                  <option value="">selecione dispositivo...</option>
                  {deviceOptions.filter(d=> d.vendor===form.action_vendor).map(d=> (
                    <option key={`${d.vendor}|${d.id}`} value={d.id}>{d.name || d.id}</option>
                  ))}
                </select>
                <select className="panel" value={form.action_event} onChange={e=> setForm(v=>({...v, action_event:e.target.value}))}>
                  <option value="on">on</option>
                  <option value="off">off</option>
                </select>
              </div>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <select className="panel" value={form.context_key} onChange={e=> setForm(v=>({...v, context_key:e.target.value}))}>
              <option value="global">contexto: global</option>
              <option value="day">contexto: day</option>
              <option value="night">contexto: night</option>
            </select>
            <input className="panel" type="number" placeholder="atraso (s) opcional" value={form.delay_s} onChange={e=> setForm(v=>({...v, delay_s:e.target.value}))} />
            <div className="flex items-center">
              <button className="btn btn-primary" onClick={async ()=>{
                try{
                  const token = localStorage.getItem('token');
                  const payload = { ...form, delay_s: form.delay_s!==''? Number(form.delay_s): null };
                  await habitsApi.createManual(token, payload);
                  await refresh();
                } catch (e) { alert('Falha ao criar: '+ (e?.message||e)); }
              }}>Criar padrao</button>
            </div>
          </div>
        </div>
      </div>
      )}

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
                <div key={it.id} className="panel flex items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <div className="font-semibold">{rowTitle(it)}</div>
                    <div className="muted text-xs flex flex-wrap items-center gap-2">
                      <span>conf: {(Number(it.confidence)||0).toFixed(2)}</span>
                      <span>• pares: {it.pairs_total}</span>
                      <span>• disparos: {it.triggers_total}</span>
                      <span>• atraso medio: {it.avg_delay_s? Number(it.avg_delay_s).toFixed(1): '-' } s</span>
                      {it.context_key ? <span>• ctx: {it.context_key}</span> : null}
                      {it.last_seen ? <span>• visto: {new Date(it.last_seen).toLocaleDateString()}</span> : null}
                    </div>
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
          <div className="h2 mb-2">Timeline de decisoes</div>
          <div className="grid gap-2 max-h-[420px] overflow-auto pr-2">
            {logs.length===0 ? (
              <div className="muted text-sm">Sem eventos ainda.</div>
            ) : logs.map(l => (
              <div key={l.id} className="panel flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-sm">{new Date(l.ts||l.time||Date.now()).toLocaleString()} • {String(l.event)}</div>
                  <div className="muted text-xs">
                    {`${l.trigger_vendor}:${l.trigger_device_id} -> ${String(l.trigger_event||'').toUpperCase()}  =>  ${l.action_vendor}:${l.action_device_id} -> ${String(l.action_event||'').toUpperCase()}`} {l.context_key? ` • ctx:${l.context_key}`:''} {l.state? ` • ${l.state}`:''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
    {showManual && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={()=> setShowManual(false)}>
        <div className="absolute inset-0 bg-black/60" />
        <div className="card relative w-full max-w-3xl" onClick={(e)=> e.stopPropagation()}>
          <div className="flex items-center justify-between mb-3">
            <div className="h2">Criar padrao</div>
            <button className="btn btn-ghost" onClick={()=> setShowManual(false)}>Fechar</button>
          </div>
          <div className="grid gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="panel grid gap-2">
                <div className="font-semibold">Gatilho</div>
                <div className="grid grid-cols-[120px_1fr_120px] gap-2">
                  <select className="panel" value={form.trigger_vendor} onChange={e=> setForm(v=>({...v, trigger_vendor:e.target.value}))}>
                    <option value="smartthings">smartthings</option>
                    <option value="tuya">tuya</option>
                  </select>
                  <select className="panel" value={form.trigger_device_id} onChange={e=> setForm(v=>({...v, trigger_device_id:e.target.value}))}>
                    <option value="">selecione dispositivo...</option>
                    {deviceOptions.filter(d=> d.vendor===form.trigger_vendor).map(d=> (
                      <option key={`${d.vendor}|${d.id}`} value={d.id}>{d.name || d.id}</option>
                    ))}
                  </select>
                  <select className="panel" value={form.trigger_event} onChange={e=> setForm(v=>({...v, trigger_event:e.target.value}))}>
                    <option value="on">on</option>
                    <option value="off">off</option>
                  </select>
                </div>
              </div>
              <div className="panel grid gap-2">
                <div className="font-semibold">Acao</div>
                <div className="grid grid-cols-[120px_1fr_120px] gap-2">
                  <select className="panel" value={form.action_vendor} onChange={e=> setForm(v=>({...v, action_vendor:e.target.value}))}>
                    <option value="smartthings">smartthings</option>
                    <option value="tuya">tuya</option>
                  </select>
                  <select className="panel" value={form.action_device_id} onChange={e=> setForm(v=>({...v, action_device_id:e.target.value}))}>
                    <option value="">selecione dispositivo...</option>
                    {deviceOptions.filter(d=> d.vendor===form.action_vendor).map(d=> (
                      <option key={`${d.vendor}|${d.id}`} value={d.id}>{d.name || d.id}</option>
                    ))}
                  </select>
                  <select className="panel" value={form.action_event} onChange={e=> setForm(v=>({...v, action_event:e.target.value}))}>
                    <option value="on">on</option>
                    <option value="off">off</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <select className="panel" value={form.context_key} onChange={e=> setForm(v=>({...v, context_key:e.target.value}))}>
                <option value="global">contexto: global</option>
                <option value="day">contexto: day</option>
                <option value="night">contexto: night</option>
              </select>
              <input className="panel" type="number" placeholder="atraso (s) opcional" value={form.delay_s} onChange={e=> setForm(v=>({...v, delay_s:e.target.value}))} />
              <div className="flex items-center justify-end gap-2">
                <button className="btn" onClick={()=> setShowManual(false)}>Cancelar</button>
                <button className="btn btn-primary" onClick={async ()=>{
                  try{
                    const token = localStorage.getItem('token');
                    const payload = { ...form, delay_s: form.delay_s!==''? Number(form.delay_s): null };
                    if (!payload.trigger_device_id || !payload.action_device_id){ alert('Selecione os dispositivos'); return; }
                    await habitsApi.createManual(token, payload);
                    await refresh();
                    setShowManual(false);
                  } catch (e) { alert('Falha ao criar: '+ (e?.message||e)); }
                }}>Criar padrao</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
  )
}

