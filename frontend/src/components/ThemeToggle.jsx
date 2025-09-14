import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../hooks/useTheme.js'

export default function ThemeToggle(){
  const { theme, setTheme } = useTheme()
  const isDark = theme === 'dark'
  return (
    <button className="btn" onClick={()=> setTheme(isDark ? 'light':'dark')}>
      {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      <span className="hidden sm:inline">{isDark ? 'Claro' : 'Escuro'}</span>
    </button>
  )
}
