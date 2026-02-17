// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useNavigate, useLocation } from 'react-router-dom'
import { MessageCircle, Users, Settings, Phone, Archive } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile, user } = useAuth()
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url)

  // Update avatar when profile changes
  useEffect(() => {
    setAvatarUrl(profile?.avatar_url)
  }, [profile?.avatar_url])

  // Subscribe to profile updates for real-time avatar changes
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel('sidebar-profile-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`
        },
        (payload: any) => {
          console.log('Sidebar: Profile avatar updated', payload.new.avatar_url)
          setAvatarUrl(payload.new.avatar_url)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

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
        title="Paramètres"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={profile?.username}
            className="w-full h-full object-cover"
            key={avatarUrl}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-sm">
            {profile?.username?.[0]?.toUpperCase() || 'N'}
          </div>
        )}
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
              className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all relative group ${
                active 
                  ? 'bg-primary-500 text-white' 
                  : 'text-[#aebac1] hover:bg-bg-hover'
              }`}
              title={item.label}
            >
              <Icon size={22} />
              
              {/* Tooltip */}
              <div className="absolute left-14 px-2 py-1 bg-bg-surface text-text-primary text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none shadow-lg border border-bg-hover">
                {item.label}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}