// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useNavigate, useLocation } from 'react-router-dom'
import { MessageCircle, Users, Settings, Phone, Archive } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { prefetchRoute } from '@/lib/routePrefetch'
import { MediaImg } from './MediaImg'

export function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile } = useAuth()
  // L'avatar vient directement du profile du contexte Auth, qui est déjà
  // synchronisé en temps réel via le canal `profile-changes` ouvert dans
  // AuthContext. On évite ainsi un canal Supabase supplémentaire qui se
  // recréait à chaque navigation (Sidebar étant dans MainLayout).
  const avatarUrl = profile?.avatar_url

  const navItems = [
    { path: '/chats', icon: MessageCircle, label: 'Discussions' },
    { path: '/calls', icon: Phone, label: 'Appels' },
    { path: '/archived', icon: Archive, label: 'Archivées' },
    { path: '/contacts', icon: Users, label: 'Contacts' },
    { path: '/settings', icon: Settings, label: 'Paramètres' },
  ]

  const isActive = (path: string) => location.pathname.startsWith(path)

  return (
    <div className="w-16 h-screen bg-bg-surface flex flex-col items-center py-4 gap-6">
      {/* Logo / Avatar */}
      <button
        type="button"
        className="w-10 h-10 rounded-full cursor-pointer hover:opacity-80 transition-opacity overflow-hidden p-0 border-none"
        onClick={() => navigate('/settings')}
        onMouseEnter={() => prefetchRoute('/settings')}
        onTouchStart={() => prefetchRoute('/settings')}
        title="Paramètres"
      >
        <MediaImg
          src={avatarUrl}
          alt={profile?.username || ''}
          className="w-full h-full object-cover"
          fallback={
            <div className="w-full h-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-sm">
              {profile?.username?.[0]?.toUpperCase() || 'N'}
            </div>
          }
        />
      </button>

      {/* Separator */}
      <div className="w-8 h-px bg-white/10" />

      {/* Navigation */}
      <div className="flex-1 flex flex-col gap-4">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.path)
          
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              onMouseEnter={() => prefetchRoute(item.path)}
              onTouchStart={() => prefetchRoute(item.path)}
              className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all relative group ${
                active
                  ? 'bg-primary-500 text-white'
                  : 'text-[#aebac1] hover:bg-bg-hover'
              }`}
              title={item.label}
            >
              <Icon size={22} />
              
              {/* Tooltip */}
              <div className="absolute left-14 px-2 py-1 bg-bg-surface text-text-primary text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none shadow-lg border border-bg-hover z-[100]">
                {item.label}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}