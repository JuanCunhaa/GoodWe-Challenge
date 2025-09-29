import { useEffect } from 'react'

export function useTheme() {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('dark')
    localStorage.setItem('goodwee-theme', 'dark')
  }, [])

  return { theme: 'dark', setTheme: () => {} }
}
