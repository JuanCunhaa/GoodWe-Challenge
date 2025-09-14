import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, Activity, Zap, Factory, Bell, Wrench, FileBarChart2, Wallet, Settings, Users, ShieldCheck, User, Search } from 'lucide-react'
import ThemeToggle from './ThemeToggle.jsx'
import logoW from '../assets/logoW.png'
import CommandPalette from './CommandPalette.jsx'
import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/live', label: 'Live Monitor', icon: Activity },
  { to: '/fluxo', label: 'Fluxo de Energia', icon: Zap },
  { to: '/geracao', label: 'Geração', icon: Zap },
  { to: '/consumo', label: 'Consumo', icon: Activity },
  { to: '/inversores', label: 'Inversores', icon: Factory },
  { to: '/alertas', label: 'Alertas', icon: Bell },
  { to: '/manutencao', label: 'Manutenção', icon: Wrench },
  { to: '/relatorios', label: 'Relatórios', icon: FileBarChart2 },
  { to: '/faturamento', label: 'Faturamento', icon: Wallet },
  { to: '/admin', label: 'Admin Usuários', icon: Users },
  { to: '/auditoria', label: 'Auditoria', icon: ShieldCheck },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
  { to: '/perfil', label: 'Perfil', icon: User },
]

export default function Layout(){
  const { pathname } = useLocation()
  const [open, setOpen] = useState(true)
  const [showRight, setShowRight] = useState(true)
  const searchRef = useRef(null)
  useEffect(()=>{
    const onKey = (e)=>{
      if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return ()=> window.removeEventListener('keydown', onKey)
  },[])

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[280px_1fr]">
      {/* Sidebar */}
      <aside className={clsx("sticky top-0 h-svh dock rounded-none !shadow-soft !border-r transition-all", open ? "lg:w-[280px]" : "lg:w-[96px]")}>
        <div className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-2xl bg-brand/20 border border-brand/30 animate-float" />
            <div className={clsx("font-extrabold text-lg text-gray-900 dark:text-gray-100 transition-all", !open && "lg:opacity-0 lg:w-0 lg:overflow-hidden")}>GoodWee Supreme</div>
          </div>
          <button className="btn burger-2 text-gray-800 dark:text-gray-100" aria-expanded={open} onClick={()=>setOpen(!open)} aria-label="Alternar menu">
            <span></span><span></span>
          </button>
        </div>
        <div className="px-4 pb-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 muted"/>
            <input ref={searchRef} className={clsx("w-full pl-9 pr-3 py-2 rounded-xl border outline-none focus:ring-2 focus:ring-brand border-gray-200 dark:border-gray-700 dark:bg-gray-900", !open && "lg:opacity-0 lg:w-0 lg:overflow-hidden")} placeholder="Buscar (Ctrl/Cmd+K)"/>
          </div>
        </div>
        <nav className="px-2 space-y-1">
          {NAV.map(({to,label,icon:Icon})=> (
            <NavLink key={to} to={to} className={({isActive})=> clsx("pill flex items-center gap-3", isActive && "pill-active") }>
              <Icon className="w-5 h-5 shrink-0"/>
              <span className={clsx("truncate", !open && "lg:hidden")}>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className={clsx("p-5 muted text-xs", !open && "lg:hidden")}>
          Rota atual: <span className="font-medium">{pathname}</span>
        </div>
      </aside>

      {/* Main + Right Dock */}
      <main className="min-h-svh">
        {/* Topbar */}
        <div className="sticky top-0 z-10 border-b border-gray-200/60 dark:border-gray-800/60 bg-gradient-to-r from-red-700 via-red-600 to-white dark:to-black">
          <div className="mx-auto max-w-[1400px] px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={logoW} alt="Logo" className="h-8 w-8 rounded-md shadow-md" />
              <div>
                <h1 className="h1">Painel Avançado</h1>
              <p className="muted text-sm">UI hiper moderna com palette GoodWee</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <button className="btn">Notificações</button>
              <button className="btn">Conta</button>
            </div>
          </div>
        </div>

        {/* Content area */}
        <div className="mx-auto max-w-[1400px] grid lg:grid-cols-[1fr_360px] gap-6 p-6">
          <div className="grid gap-6">
            <Outlet />
          </div>
          {showRight && (
            <aside className="hidden lg:block">
              <div className="card">
                <div className="h2 mb-2">Resumo rápido</div>
                <div className="grid gap-3">
                  <div className="panel">Plantas: 4</div>
                  <div className="panel">Inversores: 12</div>
                  <div className="panel">Alertas: <span className="text-secondary font-semibold">3</span></div>
                </div>
              </div>
<div className="grid gap-2">
                  <button className="btn btn-primary">Adicionar inversor</button>
                  <button className="btn">Criar alerta</button>
                  <button className="btn">Exportar relatório</button>
                </div>
            </aside>
          )}
        </div>

        <footer className="mx-auto max-w-[1400px] px-6 pb-8 text-center text-sm muted">
          Feito com ❤️ • GoodWee Supreme UI
        </footer>
      </main>

      {/* Command Palette (modal) */}
      <CommandPalette />
    </div>
  )
}