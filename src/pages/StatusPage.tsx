import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/MainLayout'
import { supabase, Status } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Plus, Eye, Info } from 'lucide-react'

export function StatusPage() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [statuses, setStatuses] = useState<(Status & { profile: any })[]>([])
  const [myStatus, setMyStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) {
      loadStatuses()
    }
  }, [user])

  const loadStatuses = async () => {
    if (!user) return

    setLoading(true)

    // Load user's own status
    const { data: ownStatus } = await supabase
      .from('statuses')
      .select('*')
      .eq('user_id', user.id)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (ownStatus) {
      setMyStatus(ownStatus)
    }

    // Load contacts' statuses
    const { data: contactIds } = await supabase
      .from('contacts')
      .select('contact_user_id')
      .eq('user_id', user.id)
      .eq('is_blocked', false)

    if (contactIds && contactIds.length > 0) {
      const ids = contactIds.map(c => c.contact_user_id)
      
      const { data: statusesData } = await supabase
        .from('statuses')
        .select('*')
        .in('user_id', ids)
        .gte('expires_at', new Date().toISOString())
        .eq('is_private', false)
        .order('created_at', { ascending: false })

      if (statusesData) {
        const statusesWithProfiles = await Promise.all(
          statusesData.map(async (status) => {
            const { data: profileData } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', status.user_id)
              .maybeSingle()

            return { ...status, profile: profileData }
          })
        )

        setStatuses(statusesWithProfiles.filter(s => s.profile))
      }
    }

    setLoading(false)
  }

  const createTextStatus = async () => {
    if (!user) return

    const content = prompt('Entrez votre statut texte:')
    if (!content) return

    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 24)

    const { error } = await supabase
      .from('statuses')
      .insert({
        user_id: user.id,
        type: 'text',
        content: content.trim(),
        background_color: '#6b6fdb',
        expires_at: expiresAt.toISOString(),
        is_private: false
      })

    if (!error) {
      loadStatuses()
    }
  }

  const formatTimeRemaining = (expiresAt: string) => {
    const now = new Date()
    const expires = new Date(expiresAt)
    const diffHours = Math.floor((expires.getTime() - now.getTime()) / (1000 * 60 * 60))
    
    if (diffHours < 1) {
      const diffMinutes = Math.floor((expires.getTime() - now.getTime()) / (1000 * 60))
      return `${diffMinutes} min`
    }
    return `${diffHours}h`
  }

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col bg-bg-primary pb-14 md:pb-0">
        {/* Header */}
        <div className="bg-bg-surface px-4 py-3">
          <h1 className="text-xl font-semibold text-text-primary">Statuts</h1>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* My Status */}
          <div className="px-4 py-3 cursor-pointer hover:bg-bg-surface transition-colors" onClick={createTextStatus}>
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-xl">
                  {profile?.username[0].toUpperCase()}
                </div>
                <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-[#787add] border-2 border-[#111b21] flex items-center justify-center">
                  <Plus size={14} className="text-white" />
                </div>
              </div>
              
              <div className="flex-1 border-b border-bg-hover pb-3">
                {myStatus ? (
                  <>
                    <p className="text-text-primary font-normal">Mon statut</p>
                    <p className="text-sm text-text-secondary">
                      Il y a {formatTimeRemaining(myStatus.expires_at)}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-text-primary font-normal">Mon statut</p>
                    <p className="text-sm text-text-secondary">Appuyez pour ajouter une mise à jour</p>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Separator */}
          <div className="px-4 py-2 bg-bg-secondary">
            <p className="text-xs text-text-secondary uppercase tracking-wide">Mises à jour récentes</p>
          </div>

          {/* Contacts' Statuses */}
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 rounded-full border-4 border-[#787add] border-t-transparent animate-spin" />
            </div>
          ) : statuses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
              <Eye size={64} className="text-[#3b4a54] mb-4" />
              <p className="text-text-secondary">Aucun statut disponible</p>
              <p className="text-sm text-text-secondary mt-2">
                Les statuts de vos contacts apparaîtront ici
              </p>
            </div>
          ) : (
            statuses.map((status) => (
              <div key={status.id} className="px-4 py-3 cursor-pointer hover:bg-bg-surface transition-colors">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-14 h-14 rounded-full p-0.5 bg-gradient-to-r from-[#787add] to-[#9a9ae8]">
                      <div className="w-full h-full rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-xl">
                        {status.profile.username[0].toUpperCase()}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex-1 min-w-0 border-b border-bg-hover pb-3">
                    <h3 className="text-text-primary font-normal truncate">
                      {status.profile.display_name || status.profile.username}
                    </h3>
                    <p className="text-sm text-text-secondary">
                      Il y a {formatTimeRemaining(status.expires_at)}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Info */}
          <div className="px-4 py-6 mt-4">
            <div className="flex items-start gap-3 p-4 bg-bg-surface rounded-lg">
              <Info size={20} className="text-[#787add] flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-text-primary mb-1">À propos des statuts</p>
                <p className="text-xs text-text-secondary">
                  Les statuts disparaissent automatiquement après 24 heures. Seuls vos contacts peuvent les voir.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  )
}
