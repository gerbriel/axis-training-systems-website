import { useState, useEffect } from 'react'

export function useTheme() {
  const [isDark, setIsDark] = useState(() => {
    try { return localStorage.getItem('axis-theme') !== 'light' } catch { return true }
  })

  useEffect(() => {
    document.documentElement.classList.toggle('light', !isDark)
    try { localStorage.setItem('axis-theme', isDark ? 'dark' : 'light') } catch {}
  }, [isDark])

  // Apply on cold load before first render
  useEffect(() => {
    try {
      if (localStorage.getItem('axis-theme') === 'light') {
        document.documentElement.classList.add('light')
      }
    } catch {}
  }, [])

  return { isDark, toggle: () => setIsDark(d => !d) }
}
