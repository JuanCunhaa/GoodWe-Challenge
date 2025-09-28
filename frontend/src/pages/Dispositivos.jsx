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

  async function fetchDevices(){
    setErr(''); setLoading(true)
    try{
      const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
      const j = await integrationsApi.stDevices(token)
      setItems(Array.isArray(j?.items) ? j.items : [])
    }catch(e){ setErr(String(e.message||e)) }
    finally{ setLoading(false) }
  }

  useEffect(()=>{ fetchDevices() }, [])

  async function fetchStatus(id){
    try{
      const { token } = loadSession(); if (!token) return
      const j = await integrationsApi.stDeviceStatus(token, id)
      setStatusMap(m => ({ ...m, [id]: j?.status || {} }))
    }catch{}
  }

  async function sendSwitch(id, on){
    try{
      setBusy(b => ({ ...b, [id]: true }))
      const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
      await integrationsApi.stSendCommands(token, id, { capability:'switch', command: on ? 'on' : 'off', component:'main' })
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
        {err && <div className="text-red-600 text-sm mb-2">{err}</div>}
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {list.map(d => {
            const caps = (d.components?.[0]?.capabilities || []).map(c=> c.id||c.capability||'').filter(Boolean)
            const st = statusMap[d.id]
            const hasSwitch = caps.includes('switch')
            const isOn = String(st?.components?.main?.switch?.switch?.value||'').toLowerCase()==='on'
            return (
              <div key={d.id} className="panel">
                <div className="font-semibold truncate" title={d.name}>{d.name||'-'}</div>
                <div className="muted text-xs break-all">ID: {d.id}</div>
                <div className="muted text-xs">Vendor: {d.vendor||'smartthings'}</div>
                {d.deviceTypeName && <div className="muted text-xs">Tipo: {d.deviceTypeName}</div>}
                {d.manufacturer && <div className="muted text-xs">Fabricante: {d.manufacturer}</div>}
                <div className="mt-2 flex flex-wrap gap-1">
                  {caps.slice(0,8).map(c=> (<span key={c} className="px-2 py-0.5 rounded-full text-xs bg-gray-200/60 dark:bg-gray-800/60">{c}</span>))}
                  {caps.length===0 && <span className="muted text-xs">Sem capabilities</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="btn btn-ghost w-full sm:w-auto" onClick={()=>fetchStatus(d.id)}>Status</button>
                  {hasSwitch && (
                    isOn ? (
                      <button className="btn btn-danger w-full sm:w-auto" disabled={!!busy[d.id]} onClick={()=>sendSwitch(d.id,false)}>{busy[d.id]? '...' : 'Desligar'}</button>
                    ) : (
                      <button className="btn btn-primary w-full sm:w-auto" disabled={!!busy[d.id]} onClick={()=>sendSwitch(d.id,true)}>{busy[d.id]? '...' : 'Ligar'}</button>
                    )
                  )}
                </div>
                {st && (
                  <pre className="mt-2 text-xs overflow-auto max-h-40 bg-gray-100 dark:bg-gray-900 p-2 rounded">{JSON.stringify(st.components?.main?.switch || st.components?.main || st, null, 2)}</pre>
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
