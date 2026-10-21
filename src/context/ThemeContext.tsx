// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { createContext, useContext, useEffect, useState, useMemo, ReactNode } from 'react'

type Theme = 'light' | 'dark' | 'system'
type Wallpaper = 'default' | 'dark' | 'light' | 'gradient' | 'custom'

interface ThemeContextType {
  theme: Theme
  wallpaper: Wallpaper
  setTheme: (theme: Theme) => void
  setWallpaper: (wallpaper: Wallpaper) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [themeState, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem('anu_theme') as Theme | null
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
  })
  
  const [wallpaperState, setWallpaperState] = useState<Wallpaper>(() => {
    return (localStorage.getItem('anu_wallpaper') as Wallpaper) || 'default'
  })

  useEffect(() => {
    applyTheme(themeState)

    if (themeState !== 'system' || !globalThis.matchMedia) return

    const media = globalThis.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [themeState])

  const applyTheme = (newTheme: Theme) => {
    const prefersDark = globalThis.matchMedia
      ? globalThis.matchMedia('(prefers-color-scheme: dark)').matches
      : true

    if (newTheme === 'light' || (newTheme === 'system' && !prefersDark)) {
      document.documentElement.classList.remove('dark')
      document.documentElement.classList.add('light')
      document.documentElement.style.colorScheme = 'light'
    } else {
      document.documentElement.classList.remove('light')
      document.documentElement.classList.add('dark')
      document.documentElement.style.colorScheme = 'dark'
    }
  }

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme)
    localStorage.setItem('anu_theme', newTheme)
    applyTheme(newTheme)
  }

  const setWallpaper = (newWallpaper: Wallpaper) => {
    setWallpaperState(newWallpaper)
    localStorage.setItem('anu_wallpaper', newWallpaper)
  }

  const value = useMemo(() => ({
    theme: themeState,
    wallpaper: wallpaperState,
    setTheme,
    setWallpaper
  }), [themeState, wallpaperState]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
