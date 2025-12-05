// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type Theme = 'light' | 'dark' | 'system'
type Wallpaper = 'default' | 'dark' | 'light' | 'gradient' | 'custom'

interface ThemeContextType {
  theme: Theme
  wallpaper: Wallpaper
  setTheme: (theme: Theme) => void
  setWallpaper: (wallpaper: Wallpaper) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem('anu_theme') as Theme) || 'dark'
  })
  
  const [wallpaper, setWallpaperState] = useState<Wallpaper>(() => {
    return (localStorage.getItem('anu_wallpaper') as Wallpaper) || 'default'
  })

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const applyTheme = (newTheme: Theme) => {
    if (newTheme === 'light') {
      document.documentElement.classList.remove('dark')
      document.documentElement.classList.add('light')
    } else if (newTheme === 'dark') {
      document.documentElement.classList.remove('light')
      document.documentElement.classList.add('dark')
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.classList.toggle('dark', prefersDark)
      document.documentElement.classList.toggle('light', !prefersDark)
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

  return (
    <ThemeContext.Provider value={{ theme, wallpaper, setTheme, setWallpaper }}>
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