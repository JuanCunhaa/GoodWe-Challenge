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
      await integrationsApi.stSendCommands(token, id, { capability:'switch', command: on ? 'on' : 'off', component:'main', arguments: [] })
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
        <div className="grid gap-3 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
          {list.map(d => {
            const caps = (d.components?.[0]?.capabilities || []).map(c=> c.id||c.capability||'').filter(Boolean)
            const st = statusMap[d.id]
            const hasSwitch = caps.includes('switch')
            const isOn = String(st?.components?.main?.switch?.switch?.value||'').toLowerCase()==='on'
            return (
              <div key={d.id} className="panel">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold break-words whitespace-normal" title={d.name}>{d.name||'-'}</div>
                    <div className="muted text-xs truncate" title={d.deviceTypeName||d.manufacturer||''}>
                      {(d.deviceTypeName || d.manufacturer || 'Dispositivo')}
                    </div>
                  </div>
                  {hasSwitch && (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-2 py-0.5 rounded text-xs ${isOn ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'}`}>
                        {isOn ? 'ON' : 'OFF'}
                      </span>
                      {isOn ? (
                        <button className="btn btn-danger" disabled={!!busy[d.id]} onClick={()=>sendSwitch(d.id,false)}>{busy[d.id]? '...' : 'Desligar'}</button>
                      ) : (
                        <button className="btn btn-primary" disabled={!!busy[d.id]} onClick={()=>sendSwitch(d.id,true)}>{busy[d.id]? '...' : 'Ligar'}</button>
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
