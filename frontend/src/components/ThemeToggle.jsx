import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../hooks/useTheme.js'

export default function ThemeToggle(){
  const { theme, setTheme } = useTheme()
  const isDark = theme === 'dark'
  return;
}
