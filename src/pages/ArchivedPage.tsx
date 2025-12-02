import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/MainLayout'
import { supabase, Conversation, Profile, Message } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Archive, ArchiveRestore } from 'lucide-react'

interface ConversationWithDetails extends Conversation {
  otherUserProfile?: Profile
  lastMessage?: Message
}

export function ArchivedPage() {
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([])
  const { user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) {
      loadArchivedConversations()
    }
  }, [user])

  const loadArchivedConversations = async () => {
    if (!user) return

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
      }
    }
  }

  const handleUnarchive = async (conversationId: string) => {
    await supabase
      .from('conversation_members')
      .update({ is_archived: false })
      .eq('conversation_id', conversationId)
      .eq('user_id', user!.id)
    
    loadArchivedConversations()
  }

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col bg-bg-primary pb-14 md:pb-0">
        <div className="bg-bg-surface px-4 py-3">
          <h1 className="text-xl font-semibold text-text-primary">Discussions archivées</h1>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
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
                    {(conversation.type === 'direct' && conversation.otherUserProfile?.avatar_url) || conversation.avatar_url ? (
                      <img
                        src={conversation.type === 'direct' ? conversation.otherUserProfile?.avatar_url! : conversation.avatar_url!}
                        alt={displayName}
                        className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold text-lg flex-shrink-0">
                        {displayName[0]?.toUpperCase()}
                      </div>
                    )}
                    
                    <div className="flex-1 min-w-0 border-b border-bg-hover pb-3" onClick={() => navigate(`/chat/${conversation.id}`)}>
                      <h3 className="text-text-primary font-normal truncate">{displayName}</h3>
                      <p className="text-sm text-text-secondary">Archivée</p>
                    </div>

                    <button
                      onClick={() => handleUnarchive(conversation.id)}
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