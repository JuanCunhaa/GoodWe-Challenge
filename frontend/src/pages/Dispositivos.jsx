// src/pages/Dispositivos.jsx
import { useEffect, useMemo, useState } from 'react'
import { loadSession } from '../services/authApi.js'
import { adapters, adapterList } from '../features/devices/adapters/index.js'

export default function Dispositivos(){
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [vendor, setVendor] = useState('smartthings')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [statusMap, setStatusMap] = useState({})
  const [busy, setBusy] = useState({})
  const [canControl, setCanControl] = useState(true)
  const [rooms, setRooms] = useState({})
  const [room, setRoom] = useState('')

  const currentAdapter = adapters[vendor]

  async function fetchDevices(){
    setErr(''); setLoading(true)
    try{
      const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
      const list = await currentAdapter.listDevices(token, { setRooms, setStatusMap, setErr })
      setItems(Array.isArray(list) ? list : [])

      // permissões / capacidade de controlar
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

  const list = useMemo(()=>{
    const qq = q.trim().toLowerCase()
    let arr = items
      .filter(d => !vendor || String(d.vendor||'')===vendor)
      .filter(d => !qq || (String(d.name||'').toLowerCase().includes(qq) || String(d.id||'').includes(qq)))
    if (room) {
      if (room === 'none') arr = arr.filter(d => !d.roomId)
      else arr = arr.filter(d => String(d.roomId||'')===room)
    }
    return arr
  }, [items, q, vendor, room])

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
      if (status) {
        setStatusMap(m => ({ ...m, [id]: status }))
      }
    }catch(e){
      setErr(String(e?.message || e))
    }finally{
      setBusy(b => ({ ...b, [id]: false }))
    }
  }

  return (
    <section className="grid gap-4">
      <div className="card">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="h2">Dispositivos</div>
          <div className="flex items-center gap-2 flex-wrap">
            <select className="panel w-full sm:w-auto" value={vendor} onChange={e=>setVendor(e.target.value)}>
              {adapterList.map(a => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </select>
            <select className="panel w-full sm:w-auto" value={room} onChange={e=>setRoom(e.target.value)}>
              <option value="">Todos os cômodos</option>
              <option value="none">Sem cômodo</option>
              {Object.entries(rooms).map(([id,name]) => (
                <option key={id} value={id}>{name||id}</option>
              ))}
            </select>
            <input className="panel outline-none w-full sm:w-64" placeholder="Buscar" value={q} onChange={e=>setQ(e.target.value)} />
            <button className="btn w-full sm:w-auto" onClick={fetchDevices} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar'}</button>
          </div>
        </div>

        {!loading && !canControl && (
          <div className="panel border border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 text-sm mb-3">
            Comando indisponível para o fornecedor selecionado. Verifique permissões/conexão na página <a className="underline" href="/perfil">Perfil</a>.
          </div>
        )}

        {err && <div className="text-red-600 text-sm mb-2">{err}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map(d => {
            const caps = (Array.isArray(d.components)? d.components : []).flatMap(c => (c.capabilities||[]).map(x=> x.id||x.capability||'')).filter(Boolean)
            const st = statusMap[d.id]
            const hasSwitch = caps.includes('switch')
            const comp = getSwitchComponent(d)
            const isOn = String(st?.components?.[comp]?.switch?.switch?.value||'').toLowerCase()==='on'

            const debugBadge = currentAdapter.getDebugBadge?.(d.id)

            return (
              <div key={d.id} className="panel h-full flex flex-col gap-2">
                <div>
                  <div className="font-semibold text-sm sm:text-base whitespace-normal break-words" title={d.name}>{d.name||'-'}</div>
                  <div className="muted text-xs truncate" title={d.deviceTypeName||d.manufacturer||d.category||''}>
                    {(d.deviceTypeName || d.manufacturer || d.category || 'Dispositivo')}
                  </div>
                  <div className="muted text-[11px]">Cômodo: {rooms[d.roomId] || (d.roomId ? d.roomId : '—')}</div>
                  {d.vendor==='tuya' && d.online===false && <div className="text-[11px] text-red-500 mt-1">Offline</div>}
                  {debugBadge && <div className="text-[11px] text-gray-500 mt-1">{debugBadge}</div>}
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
              </div>
            )
          })}
        </div>

        {(!loading && list.length===0) && <div className="muted text-sm">Nenhum dispositivo.</div>}
      </div>
    </section>
  )
}
