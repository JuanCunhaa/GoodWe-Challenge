import { useEffect, useState } from 'react'
const KEY='goodwee-theme'
export function useTheme(){
  const [theme, setTheme] = useState(() => {
    const v = localStorage.getItem(KEY)
    if (v==='light' || v==='dark') return v
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(()=>{
    const root = document.documentElement
    if (theme==='dark') root.classList.add('dark'); else root.classList.remove('dark')
    localStorage.setItem(KEY, theme)
  }, [theme])
  return { theme, setTheme }
}
