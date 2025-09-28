import { useEffect, useMemo, useState } from 'react'
import { loadSession } from '../services/authApi.js'
import { integrationsApi } from '../services/integrationsApi.js'

export default function Dispositivos(){
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [vendor, setVendor] = useState('smartthings')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

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

  const list = useMemo(()=>{
    const qq = q.trim().toLowerCase();
    return items
      .filter(d => !vendor || String(d.vendor||'')===vendor)
      .filter(d => !qq || (String(d.name||'').toLowerCase().includes(qq) || String(d.id||'').includes(qq)))
  }, [items, q, vendor])

  return (
    <section className="grid gap-4">
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <div className="h2">Dispositivos (SmartThings)</div>
          <div className="flex items-center gap-2">
            <select className="panel" value={vendor} onChange={e=>setVendor(e.target.value)}>
              <option value="smartthings">SmartThings</option>
            </select>
            <input className="panel outline-none" placeholder="Buscar" value={q} onChange={e=>setQ(e.target.value)} />
            <button className="btn" onClick={fetchDevices} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar'}</button>
          </div>
        </div>
        {err && <div className="text-red-600 text-sm mb-2">{err}</div>}
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {list.map(d => (
            <div key={d.id} className="panel">
              <div className="font-semibold">{d.name||'-'}</div>
              <div className="muted text-xs">ID: {d.id}</div>
              <div className="muted text-xs">Vendor: {d.vendor||'smartthings'}</div>
              {d.deviceTypeName && <div className="muted text-xs">Tipo: {d.deviceTypeName}</div>}
              {d.manufacturer && <div className="muted text-xs">Fabricante: {d.manufacturer}</div>}
            </div>
          ))}
        </div>
        {(!loading && list.length===0) && <div className="muted text-sm">Nenhum dispositivo.</div>}
      </div>
    </section>
  )
}
