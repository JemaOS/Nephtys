import { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { MobileBottomNav } from './MobileBottomNav'

interface MainLayoutProps {
  children: ReactNode
  showSidebar?: boolean
}

export function MainLayout({ children, showSidebar = true }: MainLayoutProps) {
  return (
    <div className="h-screen-safe flex bg-bg-secondary overflow-hidden">
      {/* Sidebar - Desktop only */}
      {showSidebar && <div className="hidden md:block"><Sidebar /></div>}
      
      {/* Main content */}
      <div className="flex-1 flex overflow-hidden h-full-safe">
        {children}
      </div>
      
      {/* Bottom Navigation - Mobile only */}
      <MobileBottomNav />
    </div>
  )
}