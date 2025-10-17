import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Activity, Zap, Factory, Bell, Wrench, FileBarChart2, Wallet, Settings, Users, ShieldCheck, User, Search } from 'lucide-react'
import ThemeToggle from './ThemeToggle.jsx'
import logoW from '../assets/logoW.png'
import CommandPalette from './CommandPalette.jsx'
import AssistantPanel from './AssistantPanel.jsx'
import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { goodweApi } from '../services/goodweApi.js'
import { energyService } from '../services/energyService.js'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/geracao', label: 'Geração', icon: Zap },
  //{ to: '/consumo', label: 'Consumo', icon: Activity },
  { to: '/inversores', label: 'Inversores', icon: Factory },
  { to: '/rotina', label: 'Rotina', icon: FileBarChart2 },
  { to: '/sugestoes', label: 'Sugestões', icon: ShieldCheck },
  { to: '/dispositivos', label: 'Dispositivos', icon: Activity },
  //{ to: '/configuracoes', label: 'Configurações', icon: Settings },
  { to: '/perfil', label: 'Perfil', icon: User },
]

export default function Layout(){
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(true)
  const [showRight, setShowRight] = useState(true)
  const [inverterCount, setInverterCount] = useState(null)
  const [warningCount, setWarningCount] = useState(null)
  const searchRef = useRef(null)
  useEffect(()=>{
    const onKey = (e)=>{
      if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return ()=> window.removeEventListener('keydown', onKey)
  },[])

  useEffect(() => {
    const token = localStorage.getItem('token')
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    if (!token || !user?.powerstation_id) return
    ;(async () => {
      try {
        const j = await goodweApi.inverters(token, user.powerstation_id)
        const cnt = Number(j?.data?.count ?? (j?.data?.inverterPoints?.length ?? 0))
        setInverterCount(Number.isFinite(cnt) ? cnt : 0)
      } catch (e) {
        setInverterCount(null)
      }
    })()
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('token')
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    if (!token || !user?.powerstation_id) return
    ;(async () => {
      try {
        const j = await goodweApi.warnings(token, user.powerstation_id)
        const list = j?.data?.list || []
        const total = list.reduce((acc, it) => acc + ((it?.warning || []).length), 0)
        setWarningCount(total)
      } catch (e) {
        setWarningCount(null)
      }
    })()
  }, [])

  // Prefetch caches (day/week/month) logo apÃƒÂ³s carregar o layout
  useEffect(() => {
    const token = localStorage.getItem('token')
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    if (!token || !user?.powerstation_id) return
    const plantId = user.powerstation_id
    ;(async () => {
      try {
        await energyService.prewarm({ token, plantId, weekDays: 7, monthDays: 30, concurrency: 3 })
      } catch {}
    })()
    const intervalMs = Number(import.meta.env.VITE_INCREMENTAL_INTERVAL_MS || 600000)
    const id = setInterval(async () => {
      try {
        const todayStr = new Date().toISOString().slice(0,10)
        await energyService.getDayAggregatesCached(token, plantId, todayStr)
      } catch {}
    }, Math.max(60000, intervalMs))
    return () => clearInterval(id)
  }, [])

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[280px_1fr]">
      {/* Sidebar (hidden on mobile) */}
      <aside className={clsx("hidden lg:block sticky top-0 h-svh dock rounded-none !shadow-soft !border-r transition-all", open ? "lg:w-[280px]" : "lg:w-[96px]")}>
        <div className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-2xl bg-brand/20 border border-brand/30 animate-float" />
            <div className={clsx("font-extrabold text-lg text-gray-900 dark:text-gray-100 transition-all", !open && "lg:opacity-0 lg:w-0 lg:overflow-hidden")}>Grupo 04 Ã¢Â€Â¢ Projeto GoodWe</div>
          </div>
        </div>
        <div className="px-4 pb-4">
        </div>
        <nav className="px-2 space-y-1">
          {NAV.map(({to,label,icon:Icon})=> (
            <NavLink key={to} to={to} className={({isActive})=> clsx("pill flex items-center gap-3", isActive && "pill-active") }>
              <Icon className="w-5 h-5 shrink-0"/>
              <span className={clsx("truncate", !open && "lg:hidden")}>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main + Right Dock */}
      <main className="min-h-svh">
        {/* Topbar */}
        <div className="sticky top-0 z-10 border-b border-gray-200/60 dark:border-gray-800/60 bg-gradient-to-r from-red-700 via-red-600 to-white dark:to-black">
          <div className="mx-auto max-w-[1400px] px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={logoW} alt="Logo" className="h-8 w-8 rounded-md shadow-md" />
              <div>
                <h1 className="h1">Grupo 04 Ã¢Â€Â¢ Projeto GoodWe</h1>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <button className="btn btn-danger" onClick={()=>{ localStorage.removeItem('token'); localStorage.removeItem('user'); navigate('/login', { replace:true }); }}>Sair</button>
            </div>
          </div>
        </div>

        {/* Mobile quick nav (below topbar) */}
        <div className="lg:hidden mx-auto max-w-[1400px] px-4 py-2 overflow-x-auto">
          <div className="flex items-center gap-2 whitespace-nowrap">
            {NAV.map(({to,label})=> (
              <NavLink key={to} to={to} className={({isActive})=> clsx("pill", isActive && "pill-active") }>
                {label}
              </NavLink>
            ))}
          </div>
        </div>

        {/* Content area */}
        <div className="mx-auto max-w-[1400px] grid lg:grid-cols-[1fr_360px] gap-6 p-4 sm:p-6">
          <div className="grid gap-6">
            <Outlet />
          </div>
          {showRight && (
            <aside className="hidden lg:block">
              <div className="card">
                <div className="h2 mb-2">Resumo rÃƒÂ¡pido</div>
                <div className="grid gap-3">
                  <div className="panel">Inversores: {inverterCount ?? 'Ã¢Â€Â”'}</div>
                  <div className="panel">Alertas: <span className="text-secondary font-semibold">{warningCount ?? 'Ã¢Â€Â”'}</span></div>
                </div>
              </div>
              <div className="grid gap-2 mt-4">
                <AssistantPanel />
              </div>
            </aside>
          )}
        </div>

        <footer className="mx-auto max-w-[1400px] px-6 pb-8 text-center text-sm muted">
          Grupo 04 Ã¢Â€Â¢ Projeto GoodWe
        </footer>
      </main>

      {/* Command Palette (modal) */}
      <CommandPalette />
    </div>
  )
}

