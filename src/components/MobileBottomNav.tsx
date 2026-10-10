// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useNavigate, useLocation } from 'react-router-dom'
import { MessageCircle, Users, Settings, Phone, Lock } from 'lucide-react'
import { prefetchRoute } from '@/lib/routePrefetch'
import { useI18n } from '@/i18n'

export function MobileBottomNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useI18n()

  const navItems = [
    { path: '/chats', icon: MessageCircle, label: t('navChats'), badge: 0 },
    { path: '/calls', icon: Phone, label: t('navCalls'), badge: 0 },
    { path: '/contacts', icon: Users, label: t('navContacts'), badge: 0 },
    { path: '/private', icon: Lock, label: 'Privé', badge: 0 },
    { path: '/settings', icon: Settings, label: t('navSettings'), badge: 0 },
  ]

  const isActive = (path: string) => location.pathname.startsWith(path)

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-bg-surface border-t border-bg-hover safe-area-bottom z-50">
      <div className="grid grid-cols-5 h-14">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.path)
          
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              onTouchStart={() => prefetchRoute(item.path)}
              className="flex flex-col items-center justify-center gap-0.5 relative"
            >
              <div className="relative">
                <Icon size={22} className={active ? 'text-[#7578db]' : 'text-text-secondary'} />
                {item.badge > 0 && (
                  <div className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#7578db] flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">{item.badge > 99 ? '99+' : item.badge}</span>
                  </div>
                )}
              </div>
              <span className={`text-[10px] ${active ? 'text-[#7578db]' : 'text-text-secondary'}`}>
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}