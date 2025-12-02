import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/MainLayout'
import { supabase, Conversation, Profile, Message } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Archive, ArchiveRestore } from 'lucide-react'

// Cache helpers for instant display like WhatsApp
const CACHE_PREFIX = 'anu_cache_'
const CACHE_EXPIRY = 5 * 60 * 1000 // 5 minutes

const getCache = <T,>(key: string): T | null => {
  try {
    const cached = localStorage.getItem(CACHE_PREFIX + key)
    if (cached) {
      const { data, timestamp } = JSON.parse(cached)
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        return data as T
      }
    }
  } catch (e) {
    // Ignore cache errors
  }
  return null
}

const setCache = <T,>(key: string, data: T) => {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
      data,
      timestamp: Date.now()
    }))
  } catch (e) {
    // Ignore cache errors (quota exceeded, etc.)
  }
}

interface ConversationWithDetails extends Conversation {
  otherUserProfile?: Profile
  lastMessage?: Message
}

export function ArchivedPage() {
  // Initialize from cache for instant display
  const [conversations, setConversations] = useState<ConversationWithDetails[]>(() =>
    getCache<ConversationWithDetails[]>('archived_conversations') || []
  )
  const [loading, setLoading] = useState(() => {
    const cached = getCache<ConversationWithDetails[]>('archived_conversations')
    return !cached || cached.length === 0
  })
  const { user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) {
      loadArchivedConversations()
    }
  }, [user])

  const loadArchivedConversations = async () => {
    if (!user) return

    // Only show loading if we don't have cached data
    const hasCachedData = conversations.length > 0
    if (!hasCachedData) {
      setLoading(true)
    }

    const { data: memberData } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', user.id)
      .eq('is_archived', true)

    if (memberData && memberData.length > 0) {
      const conversationIds = memberData.map(m => m.conversation_id)
      
      const { data } = await supabase
        .from('conversations')
        .select('*')
        .in('id', conversationIds)
        .order('last_message_at', { ascending: false })

      if (data) {
        const enriched = await Promise.all(
          data.map(async (conv) => {
            const enrichedConv: ConversationWithDetails = { ...conv }
            if (conv.type === 'direct') {
              const { data: members } = await supabase
                .from('conversation_members')
                .select('user_id')
                .eq('conversation_id', conv.id)
                .neq('user_id', user.id)

              if (members && members.length > 0) {
                const { data: profile } = await supabase
                  .from('profiles')
                  .select('*')
                  .eq('id', members[0].user_id)
                  .maybeSingle()
                if (profile) enrichedConv.otherUserProfile = profile
              }
            }
            return enrichedConv
          })
        )
        setConversations(enriched)
        setCache('archived_conversations', enriched) // Cache for instant display
      }
    } else {
      setConversations([])
      setCache('archived_conversations', [])
    }
    setLoading(false)
  }

  const handleUnarchive = async (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    
    // Mise à jour optimiste - retirer immédiatement de la liste
    setConversations(prev => prev.filter(c => c.id !== conversationId))
    
    // Puis mettre à jour en base de données
    const { error } = await supabase
      .from('conversation_members')
      .update({ is_archived: false })
      .eq('conversation_id', conversationId)
      .eq('user_id', user!.id)
    
    // En cas d'erreur, recharger les données
    if (error) {
      console.error('Erreur lors du désarchivage:', error)
      loadArchivedConversations()
    }
  }

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col bg-bg-primary pb-14 md:pb-0">
        <div className="bg-bg-surface px-4 py-3">
          <h1 className="text-xl font-semibold text-text-primary">Discussions archivées</h1>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center items-center h-full">
              <div className="w-8 h-8 rounded-full border-4 border-accent border-t-transparent animate-spin" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <Archive size={64} className="text-[#3b4a54] mb-4" />
              <h3 className="text-lg font-medium text-text-secondary mb-2">Aucune discussion archivée</h3>
              <p className="text-sm text-text-secondary">Les discussions archivées apparaîtront ici</p>
            </div>
          ) : (
            conversations.map((conversation) => {
              const displayName = conversation.type === 'group'
                ? conversation.name || 'Groupe'
                : conversation.otherUserProfile?.display_name || conversation.otherUserProfile?.username || 'Utilisateur'

              return (
                <div
                  key={conversation.id}
                  className="px-4 py-3 hover:bg-bg-surface transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {/* For direct conversations, show the other user's avatar if available */}
                    {/* For group conversations, show the group avatar if available */}
                    {conversation.type === 'direct' ? (
                      conversation.otherUserProfile?.avatar_url ? (
                        <img
                          src={conversation.otherUserProfile.avatar_url}
                          alt={displayName}
                          className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold text-lg flex-shrink-0">
                          {displayName[0]?.toUpperCase()}
                        </div>
                      )
                    ) : (
                      conversation.avatar_url ? (
                        <img
                          src={conversation.avatar_url}
                          alt={displayName}
                          className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold text-lg flex-shrink-0">
                          {displayName[0]?.toUpperCase()}
                        </div>
                      )
                    )}
                    
                    <div className="flex-1 min-w-0 border-b border-bg-hover pb-3" onClick={() => navigate(`/chat/${conversation.id}`)}>
                      <h3 className="text-text-primary font-normal truncate">{displayName}</h3>
                      <p className="text-sm text-text-secondary">Archivée</p>
                    </div>

                    <button
                      onClick={(e) => handleUnarchive(conversation.id, e)}
                      className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors flex-shrink-0"
                      title="Désarchiver"
                    >
                      <ArchiveRestore size={20} className="text-accent" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </MainLayout>
  )
}