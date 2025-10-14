// src/pages/Dispositivos.jsx
import { useEffect, useMemo, useState } from 'react'
import { loadSession } from '../services/authApi.js'
import { metaApi } from '../services/metaApi.js'
import { adapters, adapterList } from '../features/devices/adapters/index.js'
import { integrationsApi } from '../services/integrationsApi.js'

export default function Dispositivos(){
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [vendor, setVendor] = useState('smartthings')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [statusMap, setStatusMap] = useState({})
  const [busy, setBusy] = useState({})
  const [canControl, setCanControl] = useState(true)
  const [rooms, setRooms] = useState({}) // vendor rooms (SmartThings)
  const [appRooms, setAppRooms] = useState([]) // App Rooms (Perfil)
  const [metaMap, setMetaMap] = useState({}) // key: vendor|device_id -> { room_id, priority }
  const [appRoomFilter, setAppRoomFilter] = useState('') // '' | 'none' | id
  const [uptimeLive, setUptimeLive] = useState({}) // key -> { on:boolean, since:number|null, totalMs:number }
  const [editingDevice, setEditingDevice] = useState(null)
  const [editForm, setEditForm] = useState({ room_id: '', priority: '' })

  const currentAdapter = adapters[vendor]

  async function fetchDevices(){
    setErr(''); setLoading(true)
    try{
      const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
      const list = await currentAdapter.listDevices(token, { setRooms, setStatusMap, setErr })
      setItems(Array.isArray(list) ? list : [])
      const ok = await (currentAdapter.canControl?.(token) ?? false)
      setCanControl(!!ok)
    }catch(e){
      setErr(String(e?.message || e))
      setItems([])
      setRooms({})
    }finally{
      setLoading(false)
    }
  }

  useEffect(()=>{ fetchDevices() }, [vendor])

  // Load App Rooms (Perfil) and current device meta map
  useEffect(()=>{
    (async()=>{
      try{
        const { token } = loadSession(); if (!token) return
        const r = await metaApi.listRooms(token)
        setAppRooms(Array.isArray(r?.items)? r.items : [])
      } catch {}
      try{
        const { token } = loadSession(); if (!token) return
        const m = await metaApi.getDeviceMeta(token)
        const items = m?.items || m
        setMetaMap(items || {})
      } catch {}
    })()
  }, [])

  const list = useMemo(()=>{
    const qq = q.trim().toLowerCase()
    let arr = items
      .filter(d => !vendor || String(d.vendor||'')===vendor)
      .filter(d => !qq || (String(d.name||'').toLowerCase().includes(qq) || String(d.id||'').includes(qq)))
    if (appRoomFilter) {
      if (appRoomFilter === 'none') arr = arr.filter(d => !(metaMap[`${d.vendor||''}|${d.id||''}`]?.room_id))
      else arr = arr.filter(d => String(metaMap[`${d.vendor||''}|${d.id||''}`]?.room_id||'')===String(appRoomFilter))
    }
    return arr
  }, [items, q, vendor, appRoomFilter, metaMap])

  // Live uptime (sessão): poll status periodicamente e acumula tempo "on"
  useEffect(()=>{
    let stop = false;
    const tick = async () => {
      try{
        const { token } = loadSession(); if (!token) return;
        const subset = list.slice(0, 20);
        for (const d of subset){
          try{
            const key = `${d.vendor||''}|${d.id||''}`;
            let status = null; let isOn = null;
            if (d.vendor === 'smartthings') {
              const s = await integrationsApi.stDeviceStatus(token, d.id);
              status = s?.status || null;
              const v = status?.components?.main?.switch?.switch?.value;
              isOn = String(v||'').toLowerCase() === 'on';
            } else if (d.vendor === 'tuya') {
              const s = await integrationsApi.tuyaDeviceStatus(token, d.id);
              status = s?.status || null;
              const v = status?.components?.main?.switch?.switch?.value;
              isOn = String(v||'').toLowerCase() === 'on';
            } else {
              continue;
            }
            if (status) setStatusMap(m => ({ ...m, [d.id]: status }))
            const now = Date.now();
            setUptimeLive(m => {
              const prev = m[key] || { on:false, since:null, totalMs:0 };
              if (isOn === true){
                return prev.on ? m : { ...m, [key]: { on:true, since: now, totalMs: prev.totalMs } };
              } else if (isOn === false){
                if (prev.on && prev.since){
                  const add = Math.max(0, now - prev.since);
                  return { ...m, [key]: { on:false, since: null, totalMs: prev.totalMs + add } };
                } else {
                  return { ...m, [key]: { on:false, since: null, totalMs: prev.totalMs } };
                }
              }
              return m;
            })
          } catch {}
        }
      } catch {}
    };
    const id = setInterval(()=> { if (!stop) tick() }, 15000);
    tick();
    return () => { stop = true; clearInterval(id) };
  }, [list])

  function getSwitchComponent(d){
    const comps = Array.isArray(d.components) ? d.components : []
    for (const c of comps){
      const cid = c.id || c.component || 'main'
      const caps = (c.capabilities||[]).map(x=> x.id||x.capability||'')
      if (caps.includes('switch')) return cid
    }
    return 'main'
  }

  async function sendSwitch(id, on, component){
    try{
      setBusy(b => ({ ...b, [id]: true }))
      const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
      const dev = items.find(x => x.id === id)
      if (dev?.vendor === 'tuya' && dev.online === false) throw new Error('Dispositivo offline')
      const status = await currentAdapter.sendSwitch?.(token, { id, on, component })
      if (status) setStatusMap(m => ({ ...m, [id]: status }))
    }catch(e){ setErr(String(e?.message || e)) }
    finally{ setBusy(b => ({ ...b, [id]: false })) }
  }

  const linkErr = /not\s*linked|missing\s*uid|missing\s*token|unauthorized|401|403/i.test(err)
  const keyOf = (d) => `${d.vendor||''}|${d.id||''}`
  const appRoomName = (room_id) => { const r = appRooms.find(x => String(x.id) === String(room_id)); return r ? (r.name || r.id) : '' }
  function startEdit(d){
    const meta = metaMap[keyOf(d)] || {}
    setEditingDevice(d)
    setEditForm({ room_id: meta.room_id || '', priority: meta.priority ?? '' })
  }
  function closeEdit(){ setEditingDevice(null) }
  async function saveEdit(){
    try{
      const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
      const d = editingDevice; if (!d) return
      const k = keyOf(d)
      const payload = { vendor: d.vendor, device_id: d.id }
      payload.room_id = (editForm.room_id===''||editForm.room_id==null)? null : editForm.room_id
      payload.priority = (editForm.priority===''||editForm.priority==null)? null : Number(editForm.priority)
      const res = await metaApi.upsertDeviceMeta(token, payload)
      const item = res?.item || payload
      setMetaMap(m => ({ ...m, [k]: { ...(m[k]||{}), room_id: item.room_id ?? payload.room_id ?? null, priority: item.priority ?? payload.priority ?? null } }))
      closeEdit()
    } catch(e) { alert(String(e?.message||e)) }
  }

  return (
    <section className="grid gap-4">
      <div className="card">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="h2">Dispositivos</div>
          <div className="flex items-center gap-2 flex-wrap">
            <select className="panel w-full sm:w-auto" value={vendor} onChange={e=>setVendor(e.target.value)}>
              {adapterList.map(a => (<option key={a.key} value={a.key}>{a.label}</option>))}
            </select>
            <select className="panel w-full sm:w-auto" value={appRoomFilter} onChange={e=>setAppRoomFilter(e.target.value)}>
              <option value="">Todos os comodos (App)</option>
              <option value="none">Sem comodo (App)</option>
              {appRooms.map(r => (<option key={r.id} value={String(r.id)}>{r.name||r.id}</option>))}
            </select>
            <input className="panel outline-none w-full sm:w-64" placeholder="Buscar" value={q} onChange={e=>setQ(e.target.value)} />
            <button className="btn w-full sm:w-auto" onClick={fetchDevices} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar'}</button>
          </div>
        </div>

        {!loading && !canControl && !linkErr && (
          <div className="panel border border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 text-sm mb-3">
            Comando indisponível para o fornecedor selecionado. Verifique permissões/conexão na página <a className="underline" href="/perfil">Perfil</a>.
          </div>
        )}

        {!loading && vendor === 'smartthings' && linkErr && (
          <div className="panel border border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300 text-sm mb-3">
            Para usar o SmartThings aqui, conecte sua conta na página <a className="underline" href="/perfil">Perfil</a>.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map(d => {
            const caps = (Array.isArray(d.components)? d.components : []).flatMap(c => (c.capabilities||[]).map(x=> x.id||x.capability||'')).filter(Boolean)
            const st = statusMap[d.id]
            const hasSwitch = caps.includes('switch')
            const comp = getSwitchComponent(d)
            const rawVal = st?.components?.[comp]?.switch?.switch?.value
            let isOn = false
            if (typeof rawVal === 'string') isOn = rawVal.toLowerCase() === 'on'
            else if (typeof rawVal === 'boolean') isOn = !!rawVal
            else if (typeof rawVal === 'number') isOn = rawVal === 1
            const k = keyOf(d)
            const meta = metaMap[k] || {}

            return (
              <div key={d.id} className="panel h-full flex flex-col gap-2">
                <div>
                  <div className="font-semibold text-sm sm:text-base whitespace-normal break-words" title={d.name}>{d.name||'-'}</div>
                  <div className="muted text-xs truncate" title={d.deviceTypeName||d.manufacturer||d.category||''}>
                    {(d.deviceTypeName || d.manufacturer || d.category || 'Dispositivo')}
                  </div>
                  <div className="muted text-[11px]">Cômodo: {rooms[d.roomId] || d.roomName || 'Não especificado'}</div>
                  {d.vendor==='tuya' && d.online===false && <div className="text-[11px] text-red-500 mt-1">Offline</div>}
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded text-[11px] bg-gray-500/10 text-gray-600 dark:text-gray-300">Cômodo (App): {meta.room_id ? (appRoomName(meta.room_id) || meta.room_id) : '-'}</span>
                    <span className="px-2 py-0.5 rounded text-[11px] bg-gray-500/10 text-gray-600 dark:text-gray-300">Prioridade: {meta.priority===3?'Alta': meta.priority===2?'Média': meta.priority===1?'Baixa':'-'}</span>
                    <button className="btn btn-ghost text-xs" onClick={()=>startEdit(d)}>Editar</button>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  {hasSwitch ? (
                    <>
                      <span className={`px-2 py-0.5 rounded text-xs ${isOn ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'}`}>
                        {isOn ? 'ON' : 'OFF'}
                      </span>
                      {canControl ? (
                        isOn ? (
                          <button className="btn btn-danger" disabled={!!busy[d.id] || (d.vendor==='tuya' && d.online===false)} onClick={()=>sendSwitch(d.id,false, comp)}>{busy[d.id]? '...' : 'Desligar'}</button>
                        ) : (
                          <button className="btn btn-primary" disabled={!!busy[d.id] || (d.vendor==='tuya' && d.online===false)} onClick={()=>sendSwitch(d.id,true, comp)}>{busy[d.id]? '...' : 'Ligar'}</button>
                        )
                      ) : (
                        <button className="btn btn-ghost" disabled title="Conecte com escopo de comandos na página Perfil">Comando indisponível</button>
                      )}
                    </>
                  ) : (
                    <span className="muted text-xs">Sem controle direto (switch não disponível)</span>
                  )}
                </div>
                {(() => {
                  const u = uptimeLive[k];
                  if (!u) return null;
                  const now = Date.now();
                  const total = u.totalMs + (u.on && u.since ? (now - u.since) : 0);
                  const minutes = Math.round(total/60000);
                  return <div className="muted text-xs mt-1">Uptime (sessão): {minutes} min</div>
                })()}
              </div>
            )
          })}
        </div>

        {(!loading && list.length===0 && !(vendor==='smartthings' && linkErr)) && (
          <div className="muted text-sm">Nenhum dispositivo.</div>
        )}
      </div>

      {editingDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={closeEdit} />
          <div className="relative z-10 w-full max-w-md dock p-4">
            <div className="h3 mb-1">Editar dispositivo</div>
            <div className="muted text-sm mb-3">{editingDevice?.name} ({editingDevice?.vendor})</div>
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="muted">Cômodo (App)</span>
                <select className="panel" value={String(editForm.room_id ?? '')} onChange={e=> setEditForm(f => ({ ...f, room_id: e.target.value===''? '' : e.target.value }))}>
                  <option value="">Sem cômodo (App)</option>
                  {appRooms.map(r => (<option key={r.id} value={String(r.id)}>{r.name||r.id}</option>))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="muted">Prioridade</span>
                <select className="panel" value={String(editForm.priority ?? '')} onChange={e=> setEditForm(f => ({ ...f, priority: e.target.value===''? '' : Number(e.target.value) }))}>
                  <option value="">Sem prioridade</option>
                  <option value="1">Baixa</option>
                  <option value="2">Média</option>
                  <option value="3">Alta</option>
                </select>
              </label>
              <div className="flex items-center justify-end gap-2">
                <button className="btn btn-ghost" onClick={closeEdit}>Cancelar</button>
                <button className="btn btn-primary" onClick={saveEdit}>Salvar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

