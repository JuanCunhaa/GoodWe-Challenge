import { useEffect, useMemo, useState } from 'react'
import { habitsApi } from '../services/habitsApi.js'
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

export default function Habitos(){
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // search and filter
  const [q, setQ] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const stateLabels = { all:'Todos', active:'Ativos', suggested:'Sugeridos', paused:'Pausados', shadow:'Observados', retired:'Arquivados' }

  // manual create
  const [showManual, setShowManual] = useState(false)
  const [form, setForm] = useState({
    trigger_vendor: 'smartthings', trigger_device_id: '', trigger_event: 'on',
    action_vendor: 'smartthings', action_device_id: '', action_event: 'off',
    context_key: 'global', delay_s: ''
  })

  const [deviceOptions, setDeviceOptions] = useState([])
  const [nameByKey, setNameByKey] = useState({})

  function deviceLabel(vendor, id){
    const key = `${String(vendor||'').toLowerCase()}|${String(id||'')}`
    const it = nameByKey[key]
    if (!it) return `${vendor}:${id}`
    return it.roomName ? `${it.name} (${it.roomName})` : it.name
  }

  async function refresh(){
    setLoading(true); setError('')
    try{
      const token = localStorage.getItem('token')
      const j = await habitsApi.list(token)
      setItems(Array.isArray(j.items)? j.items : [])
    }catch(e){ setError(String(e.message||e)) }
    finally{ setLoading(false) }
  }

  useEffect(()=>{ refresh() },[])

  // load devices for manual create
  useEffect(()=>{
    (async ()=>{
      try{
        const token = localStorage.getItem('token'); if (!token) return;
        const out = []
        try {
          const st = await integrationsApi.stDevices(token)
          ;(st.items||[]).forEach(d=> out.push({ vendor:'smartthings', id:d.id, name:d.name, roomName: d.roomName||'' }))
        } catch {}
        try {
          const tu = await integrationsApi.tuyaDevices(token)
          ;(tu.items||[]).forEach(d=> out.push({ vendor:'tuya', id:(d.id||d.device_id||d.devId), name:d.name, roomName: d.roomName||'' }))
        } catch {}
        setDeviceOptions(out)
      } catch {}
    })()
  },[])

  // quick label map vendor|id -> { name, roomName }
  useEffect(()=>{
    const m = {}
    for (const d of deviceOptions){
      const key = `${String(d.vendor||'').toLowerCase()}|${String(d.id||'')}`
      if (!key.includes('|')) continue
      m[key] = { name: d.name||String(d.id||''), roomName: d.roomName||'' }
    }
    setNameByKey(m)
  }, [deviceOptions])

  async function onState(it, state){
    try{ const token = localStorage.getItem('token'); await habitsApi.setState(token, it.id, state); await refresh() } catch {}
  }
  async function onUndo(it){ try{ const token = localStorage.getItem('token'); await habitsApi.undo(token, it.id); await refresh() } catch {} }

  const filtered = useMemo(()=>{
    let arr = Array.isArray(items)? items.slice(): []
    if (q.trim()){
      const s = q.trim().toLowerCase()
      arr = arr.filter(it => `${it.trigger_vendor}:${it.trigger_device_id} ${it.action_vendor}:${it.action_device_id} ${it.trigger_event} ${it.action_event} ${it.context_key||''}`.toLowerCase().includes(s))
    }
    if (stateFilter !== 'all') arr = arr.filter(it => String(it.state||'shadow') === stateFilter)
    return arr
  }, [items, q, stateFilter])

  const groups = useMemo(()=>{
    const map = new Map()
    for (const it of filtered){ const k=String(it.state||'shadow'); if(!map.has(k)) map.set(k, []); map.get(k).push(it) }
    const order = ['active','suggested','paused','shadow','retired']
    return Array.from(map.entries()).sort((a,b)=> order.indexOf(a[0]) - order.indexOf(b[0]))
  }, [filtered])

  return (
    <>
      <section className="grid gap-4">
        <div className="card">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="h2">Habitos e Mini-Rotinas</div>
              <div className="muted text-sm">Fluxo: Observados -> Sugeridos -> Ativos.</div>
            </div>
            <div className="flex items-center gap-2">
              <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar por dispositivo/evento..." className="panel px-3 py-2 text-sm outline-none" />
              <button className="btn" onClick={refresh} disabled={loading}>{loading? 'Atualizando...' : 'Atualizar'}</button>
              <button className="btn btn-primary" onClick={()=> setShowManual(true)}>Criar padrao</button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center rounded-full bg-gray-100/80 dark:bg-gray-800/60 p-1 border border-gray-200/60 dark:border-gray-700/60">
              {['all','active','suggested','paused','shadow','retired'].map((k) => {
                const active = stateFilter === k
                return (
                  <button
                    key={k}
                    onClick={()=> setStateFilter(k)}
                    className={`px-3 py-1.5 rounded-full text-sm transition ${active ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300 hover:bg-white/50 dark:hover:bg-gray-700/50'}`}
                    aria-pressed={active}
                  >
                    {stateLabels[k] || k}
                  </button>
                )
              })}
            </div>
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
                  <div key={it.id} className="panel flex items-start justify-between gap-3">
                    <div className="grid gap-1">
                      <div className="font-semibold">
                        {`Quando ${deviceLabel(it.trigger_vendor, it.trigger_device_id)} -> ${String(it.trigger_event||'').toUpperCase()} entao ${deviceLabel(it.action_vendor, it.action_device_id)} -> ${String(it.action_event||'').toUpperCase()}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {it.state==='suggested' && (
                        <button className="btn btn-primary" onClick={()=> onState(it, 'active')}>Ativar</button>
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
                      {it.state!=='retired' && (
                        <button className="btn btn-ghost" onClick={()=> onState(it, 'retired')}>Arquivar</button>
                      )}
                      {it.state==='retired' && (
                        <button className="btn" onClick={()=> onState(it, 'active')}>Desarquivar</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {showManual && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={()=> setShowManual(false)}>
          <div className="absolute inset-0 bg-black/60 z-10" />
          <div className="card relative z-20 w-full max-w-3xl max-h-[90vh] overflow-auto" onClick={(e)=> e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="h2">Criar padrao</div>
              <button className="btn btn-ghost" onClick={()=> setShowManual(false)}>Fechar</button>
            </div>
            <div className="grid gap-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="panel grid gap-2">
                  <div className="font-semibold">Gatilho</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select className="panel w-full" value={form.trigger_vendor} onChange={e=> setForm(v=>({...v, trigger_vendor:e.target.value}))}>
                      <option value="smartthings">smartthings</option>
                      <option value="tuya">tuya</option>
                    </select>
                    <select className="panel w-full" value={form.trigger_device_id} onChange={e=> setForm(v=>({...v, trigger_device_id:e.target.value}))}>
                      <option value="">selecione dispositivo...</option>
                      {deviceOptions.filter(d=> d.vendor===form.trigger_vendor).map(d=> (
                        <option key={`${d.vendor}|${d.id}`} value={d.id}>{d.name || d.id}</option>
                      ))}
                    </select>
                    <select className="panel w-full" value={form.trigger_event} onChange={e=> setForm(v=>({...v, trigger_event:e.target.value}))}>
                      <option value="on">on</option>
                      <option value="off">off</option>
                    </select>
                  </div>
                </div>
                <div className="panel grid gap-2">
                  <div className="font-semibold">Acao</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select className="panel w-full" value={form.action_vendor} onChange={e=> setForm(v=>({...v, action_vendor:e.target.value}))}>
                      <option value="smartthings">smartthings</option>
                      <option value="tuya">tuya</option>
                    </select>
                    <select className="panel w-full" value={form.action_device_id} onChange={e=> setForm(v=>({...v, action_device_id:e.target.value}))}>
                      <option value="">selecione dispositivo...</option>
                      {deviceOptions.filter(d=> d.vendor===form.action_vendor).map(d=> (
                        <option key={`${d.vendor}|${d.id}`} value={d.id}>{d.name || d.id}</option>
                      ))}
                    </select>
                    <select className="panel w-full" value={form.action_event} onChange={e=> setForm(v=>({...v, action_event:e.target.value}))}>
                      <option value="on">on</option>
                      <option value="off">off</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <select className="panel w-full" value={form.context_key} onChange={e=> setForm(v=>({...v, context_key:e.target.value}))}>
                  <option value="global">contexto: global</option>
                  <option value="day">contexto: day</option>
                  <option value="night">contexto: night</option>
                </select>
                <input className="panel w-full" type="number" placeholder="atraso (s) opcional" value={form.delay_s} onChange={e=> setForm(v=>({...v, delay_s:e.target.value}))} />
                <div className="flex items-center justify-end gap-2">
                  <button className="btn" onClick={()=> setShowManual(false)}>Cancelar</button>
                  <button className="btn btn-primary" onClick={async ()=>{
                    try{
                      const token = localStorage.getItem('token')
                      const payload = { ...form, delay_s: form.delay_s!==''? Number(form.delay_s): null }
                      if (!payload.trigger_device_id || !payload.action_device_id){ alert('Selecione os dispositivos'); return }
                      await habitsApi.createManual(token, payload)
                      await refresh()
                      setShowManual(false)
                    } catch (e) { alert('Falha ao criar: '+ (e?.message||e)) }
                  }}>Criar padrao</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

