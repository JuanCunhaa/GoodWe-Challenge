import { useEffect, useMemo, useState } from 'react'
import { goodweApi } from '../services/goodweApi.js'
import { Zap, PlugZap, Battery, Thermometer, Hash, Clock, LayoutGrid, Table as TableIcon } from 'lucide-react'

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

  const variant = useMemo(() => {
    const n = rows.length
    if (n <= 4) return 'large'
    if (n <= 12) return 'medium'
    return 'compact'
  }, [rows])

  const [view, setView] = useState(() => {
    try { return localStorage.getItem('inverters_view') || 'cards' } catch { return 'cards' }
  })
  useEffect(() => {
    try { localStorage.setItem('inverters_view', view) } catch {}
  }, [view])

  function InverterCard({ r }){
    const b = badgeStatus(r.status)
    const labelCls = variant === 'compact' ? 'text-[11px] muted' : 'text-xs muted'
    const valueCls = variant === 'large' ? 'text-lg font-extrabold' : (variant === 'medium' ? 'text-base font-bold' : 'text-sm font-semibold')
    return (
      <div className="panel">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
          <div className="min-w-0">
            <div className="font-semibold truncate" title={r.name}>{r.name}</div>
            <div className="text-[11px] muted truncate" title={r.model || ''}>{r.model || '—'}</div>
          </div>
          <span className={`px-2 py-1 rounded-lg text-xs border shrink-0 ${b.cls}`}>{b.label}</span>
        </div>
        <div className={`mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2`}> 
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-500"/>
            <div>
              <div className={labelCls}>Potência</div>
              <div className={valueCls}>{r.out_pac!=null ? `${Number(r.out_pac).toLocaleString('pt-BR')} W` : '—'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PlugZap className="w-4 h-4 text-amber-600"/>
            <div>
              <div className={labelCls}>Energia (dia)</div>
              <div className={valueCls}>{r.eday!=null ? `${Number(r.eday).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh` : '—'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Battery className="w-4 h-4 text-purple-500"/>
            <div>
              <div className={labelCls}>SOC</div>
              <div className={valueCls}>{r.soc || '—'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-sky-500"/>
            <div>
              <div className={labelCls}>Temperatura</div>
              <div className={valueCls}>{r.temp!=null ? `${r.temp} °C` : '—'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Hash className="w-4 h-4 text-gray-500"/>
            <div>
              <div className={labelCls}>SN</div>
              <div className={`${valueCls} font-mono break-all`}>{r.sn || '—'}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="grid gap-6">
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
          <div className="h2">Inversores {count!=null && <span className="muted text-sm">(total: {count})</span>}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="panel flex items-center gap-1 py-1 px-1">
              <span className="hidden sm:inline text-xs muted ml-1">Visualização:</span>
              <button className={`btn ${view==='cards' ? 'btn-primary' : ''}`} onClick={()=>setView('cards')} aria-label="Cards" title="Cards">
                <LayoutGrid className="w-4 h-4"/>
                <span className="hidden sm:inline">Cards</span>
              </button>
              <button className={`btn ${view==='table' ? 'btn-primary' : ''}`} onClick={()=>setView('table')} aria-label="Tabela" title="Tabela">
                <TableIcon className="w-4 h-4"/>
                <span className="hidden sm:inline">Tabela</span>
              </button>
            </div>
            <button className="btn" onClick={refresh} disabled={loading} aria-label="Atualizar" title="Atualizar">{loading ? 'Atualizando...' : 'Atualizar'}</button>
            {error && <div className="text-red-500 text-sm">{error}</div>}
          </div>
        </div>
        {(!loading && rows.length===0) ? (
          <div className="panel">Nenhum inversor retornado.</div>
        ) : (
          <>
            {view==='cards' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {rows.map((r)=> (
                  <InverterCard key={r.sn||r.name} r={r} />
                ))}
              </div>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="muted text-left">
                    <tr>
                      <th className="py-2 hidden sm:table-cell">SN</th>
                      <th>Modelo</th>
                      <th>Potência</th>
                      <th className="hidden md:table-cell">Energia (dia)</th>
                      <th className="hidden lg:table-cell">SOC</th>
                      <th className="hidden lg:table-cell">Temp</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100/70 dark:divide-gray-800/70">
                    {rows.map((r)=>{
                      const b = badgeStatus(r.status)
                      return (
                        <tr key={r.sn} className="text-gray-900 dark:text-gray-100">
                          <td className="py-3 font-mono hidden sm:table-cell">{r.sn}</td>
                          <td className="truncate max-w-[220px]" title={r.model}>{r.model || '—'}</td>
                          <td>{r.out_pac!=null ? `${Number(r.out_pac).toLocaleString('pt-BR')} W` : '—'}</td>
                          <td className="hidden md:table-cell">{r.eday!=null ? `${Number(r.eday).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh` : '—'}</td>
                          <td className="hidden lg:table-cell">{r.soc || '—'}</td>
                          <td className="hidden lg:table-cell">{r.temp!=null ? `${r.temp} °C` : '—'}</td>
                          <td>
                            <span className={`px-2 py-1 rounded-lg text-xs border ${b.cls}`}>{b.label}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
