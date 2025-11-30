import { useNavigate, useLocation } from 'react-router-dom'
import { MessageCircle, Users, Settings, Circle, Phone, Archive } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

export function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile } = useAuth()

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
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-sm cursor-pointer hover:opacity-80 transition-opacity"
           onClick={() => navigate('/settings')}>
        {profile?.username?.[0]?.toUpperCase() || 'A'}
      </div>

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