import { useEffect, useState } from 'react'
import { goodweApi } from '../services/goodweApi.js'
import { AlertTriangle, Info } from 'lucide-react'

function levelBadge(level) {
  const n = Number(level || 0)
  if (n >= 2) return { label: 'Alto', cls: 'border-red-400/40 bg-red-500/10 text-red-300', Icon: AlertTriangle }
  if (n === 1) return { label: 'Médio', cls: 'border-amber-400/40 bg-amber-400/10 text-amber-300', Icon: AlertTriangle }
  return { label: 'Info', cls: 'border-sky-400/40 bg-sky-400/10 text-sky-300', Icon: Info }
}

export default function Alertas(){
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function refresh() {
    const token = localStorage.getItem('token')
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    if (!token || !user?.powerstation_id) return
    setLoading(true); setError('')
    try {
      const j = await goodweApi.warnings(token, user.powerstation_id)
      if (String(j?.code) !== '0') throw new Error(j?.msg || 'Falha ao consultar alertas')
      const lst = j?.data?.list || []
      const flat = []
      for (const inv of lst) {
        const warnings = inv?.warning || []
        for (const w of warnings) {
          flat.push({
            sn: inv?.sn,
            sn_name: inv?.sn_name || inv?.sn,
            happen_time: w?.happen_time,
            recovery_time: w?.recovery_time,
            warning_level: w?.warning_level,
            warning_code: w?.warning_code,
            status: w?.status,
          })
        }
      }
      flat.sort((a,b) => new Date(b.happen_time || 0) - new Date(a.happen_time || 0))
      setItems(flat)
    } catch (e) {
      setError(String(e.message || e))
    } finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  const total = items.length

  return (
    <section className="grid gap-6">
      <div className="card">
        <div className="h2 mb-2">Alertas</div>
        <div className="flex items-center gap-3 mb-3">
          <button className="btn" onClick={refresh} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar'}</button>
          <div className="muted text-sm">Total: {total}</div>
        </div>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        {!loading && !error && total === 0 && (
          <div className="muted">Nenhum alerta para esta planta.</div>
        )}
        {total > 0 && (
          <div className="rounded-2xl border border-gray-100/60 dark:border-gray-800/60">
            {items.map((a, i)=>{
              const badge = levelBadge(a.warning_level)
              return (
                <div key={i} className="p-4 flex items-center justify-between hover:bg-gray-50/60 dark:hover:bg-gray-800/40 transition border-b border-gray-100/60 dark:border-gray-800/60 last:border-b-0 rounded-xl">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-1 h-8 rounded-full ${badge.label==='Alto' ? 'bg-red-500/70' : badge.label==='Médio' ? 'bg-amber-400/70' : 'bg-sky-400/70'}`}></div>
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{a.warning_code}</div>
                      <div className="text-xs muted truncate">SN: {a.sn_name || a.sn} • Início: {a.happen_time || '-'} {a.recovery_time ? `• Fim: ${a.recovery_time}` : ''}</div>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-xl text-xs border ${badge.cls}`}>
                    {badge.Icon ? <badge.Icon className="w-3.5 h-3.5"/> : null}
                    {badge.label}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

