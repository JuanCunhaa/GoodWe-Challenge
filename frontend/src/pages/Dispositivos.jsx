import { useEffect, useMemo, useState } from 'react'
import { loadSession } from '../services/authApi.js'
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
  const [rooms, setRooms] = useState({}) // { roomId: roomName }
  const [room, setRoom] = useState('') // '' = todos, 'none' = sem cômodo

  // ---- Helpers Tuya ----
  function normalizeTuyaDevice(d){
    const id = String(d.id || d.uuid || '')
    const name = String(d.name || d.local_key || 'Device')
    const category = String(d.category || d.product_id || '').toLowerCase()
    const online = !!d.online
    // heurística simples p/ expor "switch" em categorias comuns
    const looksSwitch =
      category.includes('switch') ||
      category.includes('socket') ||
      category.includes('plug') ||
      category.includes('light') ||
      ['cz','dj'].some(k => category.includes(k)) // categorias Tuya comuns
    return {
      id,
      name,
      category,
      online,
      vendor: 'tuya',
      roomId: '', // sem cômodo por enquanto
      components: [{
        id: 'main',
        capabilities: looksSwitch ? [{ id:'switch' }] : []
      }],
    }
  }

  async function fetchDevices(){
    setErr(''); setLoading(true)
    try{
      const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')

      if (vendor === 'smartthings'){
        const j = await integrationsApi.stDevices(token)
        const list = Array.isArray(j?.items) ? j.items : []
        setItems(list)
        // Rooms (best-effort)
        try {
          const r = await integrationsApi.stRooms(token)
          const map = {}
          for (const it of (r?.items||[])) { if (it?.id) map[it.id] = it.name || '' }
          setRooms(map)
        } catch {}
        // Status em lote p/ quem tem switch (6 em paralelo)
        const capsFor = (d)=> (d.components?.[0]?.capabilities || []).map(c=> c.id||c.capability||'').filter(Boolean)
        const ids = list.filter(d => capsFor(d).includes('switch')).map(d=> d.id)
        const batch = async (arr, size=6) => {
          for (let i=0;i<arr.length;i+=size){
            await Promise.all(arr.slice(i,i+size).map(id => fetchStatus(id)))
          }
        }
        await batch(ids)

      } else if (vendor === 'philips-hue'){
        const j = await integrationsApi.hueDevices(token)
        const list = Array.isArray(j?.items) ? j.items : []
        setItems(list)
        setRooms({})
        setStatusMap({})

      } else if (vendor === 'tuya'){
        const j = await integrationsApi.tuyaDevices(token)
        const raw = Array.isArray(j?.items) ? j.items : []
        const list = raw.map(normalizeTuyaDevice)
        setItems(list)
        setRooms({})
        setStatusMap({}) // sem leitura de status Tuya por enquanto
      }
    }catch(e){ setErr(String(e.message||e)) }
    finally{ setLoading(false) }
  }

  useEffect(()=>{ fetchDevices() }, [vendor])

  useEffect(()=>{
    (async()=>{
      try{
        const { token } = loadSession(); if (!token) return;
        if (vendor==='smartthings'){
          const s = await integrationsApi.stStatus(token)
          const scopes = String(s?.scopes||'')
          setCanControl(scopes.includes('devices:commands') || scopes.includes('x:devices:*'))
        } else if (vendor==='tuya'){
          // temos POST /tuya/commands → habilita controle
          setCanControl(true)
        } else {
          setCanControl(false)
        }
      }catch{}
    })()
  }, [vendor])

  async function fetchStatus(id){
    try{
      const { token } = loadSession(); if (!token) return
      const j = await integrationsApi.stDeviceStatus(token, id)
      setStatusMap(m => ({ ...m, [id]: j?.status || {} }))
    }catch{}
  }

  async function sendSwitch(id, on, component){
    try{
      setBusy(b => ({ ...b, [id]: true }))
      const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')

      if (vendor === 'smartthings'){
        await integrationsApi.stSendCommands(token, id, { capability:'switch', command: on ? 'on' : 'off', component: component || 'main', arguments: [] })
        await fetchStatus(id)

      } else if (vendor === 'tuya'){
        // Tuya usa "commands: [{code,value}]" – tentamos 'switch' e fallback 'switch_led'
        const codes = ['switch', 'switch_led']
        let lastErr = null
        for (const code of codes){
          try{
            await integrationsApi.tuyaSendCommands(token, id, [{ code, value: !!on }])
            // status otimista p/ refletir na UI
            setStatusMap(m => ({
              ...m,
              [id]: {
                components: {
                  [component || 'main']: { switch: { switch: { value: on ? 'on' : 'off' } } }
                }
              }
            }))
            lastErr = null
            break
          }catch(e){ lastErr = e }
        }
        if (lastErr) throw lastErr

      } else {
        throw new Error('Comando não suportado para este fornecedor')
      }
    }catch(e){ setErr(String(e.message||e)) }
    finally{ setBusy(b => ({ ...b, [id]: false })) }
  }

  const list = useMemo(()=>{
    const qq = q.trim().toLowerCase();
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

  return (
    <section className="grid gap-4">
      <div className="card">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="h2">Dispositivos</div>
          <div className="flex items-center gap-2 flex-wrap">
            <select className="panel w-full sm:w-auto" value={vendor} onChange={e=>setVendor(e.target.value)}>
              <option value="smartthings">SmartThings</option>
              <option value="philips-hue">Philips Hue</option>
              <option value="tuya">Tuya</option>
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

        {err && (
          <div className="text-red-600 text-sm mb-2">
            {err}
            {/not linked|missing|401|403/i.test(err) && (
              <span className="ml-2">
                Verifique a conexão do fornecedor na página <a className="underline" href="/perfil">Perfil</a>.
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map(d => {
            const caps = (Array.isArray(d.components)? d.components : []).flatMap(c => (c.capabilities||[]).map(x=> x.id||x.capability||'')).filter(Boolean)
            const st = statusMap[d.id]
            const hasSwitch = caps.includes('switch')
            const comp = getSwitchComponent(d)
            const isOn = String(st?.components?.[comp]?.switch?.switch?.value||'').toLowerCase()==='on'
            return (
              <div key={d.id} className="panel h-full flex flex-col gap-2">
                <div>
                  <div className="font-semibold text-sm sm:text-base whitespace-normal break-words" title={d.name}>{d.name||'-'}</div>
                  <div className="muted text-xs truncate" title={d.deviceTypeName||d.manufacturer||d.category||''}>
                    {(d.deviceTypeName || d.manufacturer || d.category || 'Dispositivo')}
                  </div>
                  <div className="muted text-[11px]">Cômodo: {rooms[d.roomId] || (d.roomId ? d.roomId : '—')}</div>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  {hasSwitch ? (
                    <>
                      <span className={`px-2 py-0.5 rounded text-xs ${isOn ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'}`}>
                        {isOn ? 'ON' : 'OFF'}
                      </span>
                      {canControl ? (
                        isOn ? (
                          <button className="btn btn-danger" disabled={!!busy[d.id]} onClick={()=>sendSwitch(d.id,false, comp)}>{busy[d.id]? '...' : 'Desligar'}</button>
                        ) : (
                          <button className="btn btn-primary" disabled={!!busy[d.id]} onClick={()=>sendSwitch(d.id,true, comp)}>{busy[d.id]? '...' : 'Ligar'}</button>
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
