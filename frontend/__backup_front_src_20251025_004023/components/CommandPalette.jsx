import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
const LINKS = [
  {label:'Dashboard', to:'/'}, {label:'Live Monitor', to:'/live'},
  {label:'Fluxo de Energia', to:'/fluxo'},
  {label:'Geração', to:'/geracao'},
  {label:'Consumo', to:'/consumo'},
  {label:'Inversores', to:'/inversores'},
  {label:'Alertas', to:'/alertas'},
  {label:'Manutenção', to:'/manutencao'},
  {label:'Relatórios', to:'/relatorios'},
  {label:'Faturamento', to:'/faturamento'},
  {label:'Admin Usuários', to:'/admin'},
  {label:'Auditoria', to:'/auditoria'},
  {label:'Configurações', to:'/configuracoes'},
  {label:'Perfil', to:'/perfil'},
]

export default function CommandPalette(){
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const nav = useNavigate()

  useEffect(()=>{
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'){
        e.preventDefault(); setOpen(v=>!v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const results = LINKS.filter(l => l.label.toLowerCase().includes(q.toLowerCase())).slice(0,8)

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4" onClick={()=>setOpen(false)}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 w-full max-w-xl dock p-2" onClick={(e)=>e.stopPropagation()}>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 muted"/>
          <input
            autoFocus
            value={q} onChange={e=>setQ(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl border outline-none focus:ring-2 focus:ring-brand border-gray-200 dark:border-gray-700 dark:bg-gray-900"
            placeholder="Buscar páginas… (Ctrl/Cmd+K)"
            onKeyDown={(e)=>{
              if (e.key === 'Enter' && results[0]) { nav(results[0].to); setOpen(false) }
            }}
          />
        </div>
        <ul className="mt-2 max-h-64 overflow-auto">
          {results.map((r, i)=>(
            <li key={i}>
              <Link to={r.to} onClick={()=>setOpen(false)} className="block pill">{r.label}</Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
