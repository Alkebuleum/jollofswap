import { create } from 'zustand'

type Theme = 'light' | 'dark'
type ThemeState = {
  theme: Theme
  setTheme: (t: Theme) => void
  toggleTheme: () => void
  init: () => void
}

const applyTheme = (t: Theme) => {
  const root = document.documentElement
  if (t === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'light',
  setTheme: (t) => {
    localStorage.setItem('theme', t)
    applyTheme(t)
    set({ theme: t })
  },
  toggleTheme: () => {
    const t = get().theme === 'light' ? 'dark' : 'light'
    localStorage.setItem('theme', t)
    applyTheme(t)
    set({ theme: t })
  },
  init: () => {
    const saved = (localStorage.getItem('theme') as Theme) || 'light'
    applyTheme(saved)
    set({ theme: saved })
  }
}))
