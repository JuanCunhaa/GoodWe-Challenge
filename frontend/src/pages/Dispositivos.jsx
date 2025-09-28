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

  async function fetchDevices(){
    setErr(''); setLoading(true)
    try{
      const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
      const j = await integrationsApi.stDevices(token)
      const list = Array.isArray(j?.items) ? j.items : []
      setItems(list)
      // Auto-carrega status para dispositivos com switch (limita a 6 em paralelo)
      const capsFor = (d)=> (d.components?.[0]?.capabilities || []).map(c=> c.id||c.capability||'').filter(Boolean)
      const ids = list.filter(d => capsFor(d).includes('switch')).map(d=> d.id)
      const batch = async (arr, size=6) => {
        for (let i=0;i<arr.length;i+=size){
          await Promise.all(arr.slice(i,i+size).map(id => fetchStatus(id)))
        }
      }
      await batch(ids)
    }catch(e){ setErr(String(e.message||e)) }
    finally{ setLoading(false) }
  }

  useEffect(()=>{ fetchDevices() }, [])

  useEffect(()=>{
    (async()=>{
      try{
        const { token } = loadSession(); if (!token) return;
        const s = await integrationsApi.stStatus(token)
        const scopes = String(s?.scopes||'')
        setCanControl(/\bdevices:commands\b/.test(scopes))
      }catch{}
    })()
  }, [])

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
      await integrationsApi.stSendCommands(token, id, { capability:'switch', command: on ? 'on' : 'off', component: component || 'main', arguments: [] })
      await fetchStatus(id)
    }catch(e){ setErr(String(e.message||e)) }
    finally{ setBusy(b => ({ ...b, [id]: false })) }
  }

  const list = useMemo(()=>{
    const qq = q.trim().toLowerCase();
    return items
      .filter(d => !vendor || String(d.vendor||'')===vendor)
      .filter(d => !qq || (String(d.name||'').toLowerCase().includes(qq) || String(d.id||'').includes(qq)))
  }, [items, q, vendor])

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
            </select>
            <input className="panel outline-none w-full sm:w-64" placeholder="Buscar" value={q} onChange={e=>setQ(e.target.value)} />
            <button className="btn w-full sm:w-auto" onClick={fetchDevices} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar'}</button>
          </div>
        </div>
        {err && (
          <div className="text-red-600 text-sm mb-2">
            {err}
            {/not linked|missing token|401|403/i.test(err) && (
              <span className="ml-2">
                Verifique conexão com SmartThings na página <a className="underline" href="/perfil">Perfil</a>.
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
              <div key={d.id} className="panel">
                <div className="flex items-center justify-between gap-x-3 gap-y-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold whitespace-normal break-words" title={d.name}>{d.name||'-'}</div>
                    <div className="muted text-xs truncate" title={d.deviceTypeName||d.manufacturer||''}>
                      {(d.deviceTypeName || d.manufacturer || 'Dispositivo')}
                    </div>
                  </div>
                  {hasSwitch && (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-2 py-0.5 rounded text-xs ${isOn ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'}`}>
                        {isOn ? 'ON' : 'OFF'}
                      </span>
                      {canControl ? (
                        isOn ? (
                          <button className="btn btn-danger btn-sm" disabled={!!busy[d.id]} onClick={()=>sendSwitch(d.id,false, comp)}>{busy[d.id]? '...' : 'Desligar'}</button>
                        ) : (
                          <button className="btn btn-primary btn-sm" disabled={!!busy[d.id]} onClick={()=>sendSwitch(d.id,true, comp)}>{busy[d.id]? '...' : 'Ligar'}</button>
                        )
                      ) : (
                        <button className="btn btn-ghost btn-sm" disabled title="Conecte o SmartThings com devices:commands na página Perfil">Comando indisponível</button>
                      )}
                    </div>
                  )}
                </div>
                {!hasSwitch && (
                  <div className="mt-2 muted text-xs">Sem controle direto (switch não disponível)</div>
                )}
              </div>
            )
          })}
        </div>
        {(!loading && list.length===0) && <div className="muted text-sm">Nenhum dispositivo.</div>}
      </div>
    </section>
  )
}
