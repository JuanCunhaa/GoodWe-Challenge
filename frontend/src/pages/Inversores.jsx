import { useEffect, useMemo, useState } from 'react'
import { goodweApi } from '../services/goodweApi.js'

function pairsToMap(block){
  const res = {}
  if (!block || typeof block !== 'object') return res
  for (const side of ['left','right']){
    for (const it of (block[side]||[])){
      if (it && it.key) res[it.key] = it
    }
  }
  return res
}

function badgeStatus(s){
  const txt = String(s||'').toLowerCase()
  if (txt.includes('grid') || txt.includes('generat')) return {label:'On grid', cls:'bg-emerald-500/10 text-emerald-400 border-emerald-400/30'}
  if (txt.includes('offline') || txt.includes('fault')) return {label:'Offline', cls:'bg-red-500/10 text-red-300 border-red-400/30'}
  return {label: s||'—', cls:'bg-sky-500/10 text-sky-300 border-sky-400/30'}
}

export default function Inversores(){
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function refresh(){
    const token = localStorage.getItem('token')
    const user = JSON.parse(localStorage.getItem('user')||'null')
    if (!token || !user?.powerstation_id) return
    setLoading(true); setError('')
    try{
      const j = await goodweApi.inverters(token, user.powerstation_id)
      if (String(j?.code) !== '0' && String(j?.code) !== '000') throw new Error(j?.msg || 'Falha ao consultar inversores')
      const items = j?.data?.inverterPoints || []
      setCount(Number(j?.data?.count ?? items.length))
      const mapped = items.map((inv) => {
        const m = pairsToMap(inv?.dict)
        const model = m.dmDeviceType?.value || m.serialNum?.value || inv?.name || inv?.sn
        const temp = m.innerTemp?.value
        const capacity = m.DeviceParameter_capacity?.value
        return {
          sn: inv?.sn,
          name: inv?.name || inv?.sn,
          model,
          out_pac: inv?.out_pac,
          eday: inv?.eday,
          soc: inv?.soc,
          temp,
          capacity,
          status: inv?.gridConnStatus || inv?.status,
          last: inv?.last_refresh_time || inv?.local_date,
        }
      })
      setRows(mapped)
    }catch(e){
      setError(String(e.message||e))
    }finally{ setLoading(false) }
  }

  useEffect(()=>{ refresh() },[])

  return (
    <section className="grid gap-6">
      <div className="card">
        <div className="h2 mb-2">Inversores {count!=null && <span className="muted text-sm">(total: {count})</span>}</div>
        <div className="flex items-center gap-3 mb-3">
          <button className="btn" onClick={refresh} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar'}</button>
          {error && <div className="text-red-500 text-sm">{error}</div>}
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="muted text-left">
              <tr>
                <th className="py-2">SN</th>
                <th>Modelo</th>
                <th>Potência</th>
                <th>Energia (dia)</th>
                <th>SOC</th>
                <th>Temp</th>
                <th>Status</th>
                <th>Atualizado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100/70 dark:divide-gray-800/70">
              {rows.map((r)=>{
                const b = badgeStatus(r.status)
                return (
                  <tr key={r.sn} className="text-gray-900 dark:text-gray-100">
                    <td className="py-3 font-mono">{r.sn}</td>
                    <td className="truncate max-w-[220px]" title={r.model}>{r.model || '—'}</td>
                    <td>{r.out_pac!=null ? `${Number(r.out_pac).toLocaleString('pt-BR')} W` : '—'}</td>
                    <td>{r.eday!=null ? `${Number(r.eday).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh` : '—'}</td>
                    <td>{r.soc || '—'}</td>
                    <td>{r.temp!=null ? `${r.temp} °C` : '—'}</td>
                    <td>
                      <span className={`px-2 py-1 rounded-lg text-xs border ${b.cls}`}>{b.label}</span>
                    </td>
                    <td className="whitespace-nowrap">{r.last || '—'}</td>
                  </tr>
                )
              })}
              {!loading && rows.length===0 && (
                <tr><td colSpan={8} className="py-6 text-center muted">Nenhum inversor retornado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
