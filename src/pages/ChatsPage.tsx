import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/MainLayout'
import { ConversationContextMenu } from '@/components/ConversationContextMenu'
import { supabase, Conversation, Profile, Message } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { MessageCircle, Search, Plus, MoreVertical, Check, UserPlus, Users, Pin, BellOff } from 'lucide-react'

interface ConversationWithDetails extends Omit<Conversation, 'is_pinned'> {
  otherUserProfile?: Profile
  lastMessage?: Message
  unreadCount?: number
  is_pinned?: boolean
  is_muted?: boolean
}

export function ChatsPage() {
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; conversationId: string } | null>(null)
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [activeFilter, setActiveFilter] = useState<'all' | 'unread' | 'groups'>('all')
  const { user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) {
      loadConversations()
      
      // Subscribe to conversation changes
      const conversationsChannel = supabase
        .channel('conversations')
        .on('postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'conversations'
          },
          () => loadConversations()
        )
        .subscribe()

      // Subscribe to profile changes for real-time avatar updates
      const profilesChannel = supabase
        .channel('profiles-updates')
        .on('postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'profiles'
          },
          (payload) => {
            console.log('Profile updated in ChatsPage:', payload)
            // Reload conversations to get updated profile data
            loadConversations()
          }
        )
        .subscribe()

      return () => {
        supabase.removeChannel(conversationsChannel)
        supabase.removeChannel(profilesChannel)
      }
    }
  }, [user])

  const loadConversations = async () => {
    if (!user) return

    console.log('📋 Loading conversations for user:', user.id)

    // Charger TOUTES les conversations de l'utilisateur avec leurs métadonnées
    const { data: memberData, error: memberError } = await supabase
      .from('conversation_members')
      .select('conversation_id, is_pinned, is_muted, is_archived')
      .eq('user_id', user.id)

    console.log('📋 Member data:', memberData)
    console.log('📋 Member count:', memberData?.length || 0)
    if (memberError) console.error('❌ Error loading members:', memberError)

    if (memberData && memberData.length > 0) {
      // Filtrer les non archivées
      const activeMembers = memberData.filter(m => !m.is_archived)
      const conversationIds = activeMembers.map(m => m.conversation_id)
      
      if (conversationIds.length === 0) {
        setConversations([])
        return
      }
      console.log('📋 Conversation IDs:', conversationIds)
      
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .in('id', conversationIds)
        .order('last_message_at', { ascending: false, nullsFirst: true })
        .order('created_at', { ascending: false })

      console.log('📋 Conversations loaded:', data)
      console.log('📋 Conversations count:', data?.length || 0)
      if (error) console.error('❌ Error loading conversations:', error)

      if (!error && data) {
        // Enrichir chaque conversation avec les détails
        const enrichedConversations = await Promise.all(
          data.map(async (conv) => {
            const memberInfo = activeMembers.find(m => m.conversation_id === conv.id)
            const enriched: ConversationWithDetails = {
              ...conv,
              is_pinned: memberInfo?.is_pinned || false,
              is_muted: memberInfo?.is_muted || false
            }

            // Pour les conversations directes, charger le profil de l'autre utilisateur
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

                if (profile) {
                  enriched.otherUserProfile = profile
                }
              }
            }

            // Charger le dernier message
            const { data: lastMsg } = await supabase
              .from('messages')
              .select('*')
              .eq('conversation_id', conv.id)
              .is('deleted_at', null)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()

            if (lastMsg) {
              enriched.lastMessage = lastMsg
            }

            // Compter les messages non lus (messages reçus avec status != 'read')
            const { count: unreadCount } = await supabase
              .from('messages')
              .select('*', { count: 'exact', head: true })
              .eq('conversation_id', conv.id)
              .neq('sender_id', user.id)
              .neq('status', 'read')
              .is('deleted_at', null)

            enriched.unreadCount = unreadCount || 0

            return enriched
          })
        )

        // Trier : épinglées en premier
        const sorted = enrichedConversations.sort((a, b) => {
          if (a.is_pinned && !b.is_pinned) return -1
          if (!a.is_pinned && b.is_pinned) return 1
          return 0
        })
        
        console.log('📋 Setting conversations state with', sorted.length, 'conversations')
        setConversations(sorted)
      }
    } else {
      console.log('📋 No conversation members found for user')
      setConversations([])
    }
  }

  const handleContextMenu = (e: React.MouseEvent, conversationId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, conversationId })
  }

  const handleMarkAsUnread = async (conversationId: string) => {
    const { data: messages } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .neq('sender_id', user!.id)
      .eq('status', 'read')

    if (messages && messages.length > 0) {
      await supabase
        .from('messages')
        .update({ status: 'delivered' })
        .in('id', messages.map(m => m.id))
      
      await loadConversations()
    }
  }

  const handlePinConversation = async (conversationId: string) => {
    const conv = conversations.find(c => c.id === conversationId)
    if (!conv) return

    await supabase
      .from('conversation_members')
      .update({ is_pinned: !(conv as any).is_pinned || false })
      .eq('conversation_id', conversationId)
      .eq('user_id', user!.id)
    
    await loadConversations()
  }

  const handleArchiveConversation = async (conversationId: string) => {
    await supabase
      .from('conversation_members')
      .update({ is_archived: true })
      .eq('conversation_id', conversationId)
      .eq('user_id', user!.id)
    
    await loadConversations()
  }

  const handleMuteConversation = async (conversationId: string) => {
    const conv = conversations.find(c => c.id === conversationId)
    if (!conv) return

    await supabase
      .from('conversation_members')
      .update({ is_muted: !(conv as any).is_muted || false })
      .eq('conversation_id', conversationId)
      .eq('user_id', user!.id)
    
    await loadConversations()
  }

  const handleDeleteConversation = async (conversationId: string) => {
    if (confirm('Voulez-vous vraiment supprimer cette conversation ? Tous les messages seront supprimés.')) {
      // Supprimer tous les messages
      await supabase
        .from('messages')
        .delete()
        .eq('conversation_id', conversationId)
      
      // Supprimer la conversation
      await supabase
        .from('conversation_members')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('user_id', user!.id)
      
      await loadConversations()
    }
  }

  const handleOpenInNewWindow = (conversationId: string) => {
    window.open(`/chat/${conversationId}`, '_blank')
  }

  const filteredConversations = conversations.filter(conv => {
    // Filtre par recherche
    if (searchQuery.trim() && !conv.name?.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false
    }
    
    // Filtre par type
    if (activeFilter === 'unread' && (conv.unreadCount || 0) === 0) {
      return false
    }
    if (activeFilter === 'groups' && conv.type !== 'group') {
      return false
    }
    
    return true
  })
  
  console.log('📋 Total conversations:', conversations.length)
  console.log('📋 Filtered conversations:', filteredConversations.length)
  console.log('📋 Search query:', searchQuery)

  return (
    <MainLayout>
      {/* Liste des conversations - Style WhatsApp */}
      <div className="w-full md:w-[420px] bg-bg-secondary flex flex-col md:border-r border-bg-hover pb-20 md:pb-0">
        {/* Header */}
        <div className="bg-bg-surface p-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-semibold text-text-primary">Discussions</h1>
            <div className="flex gap-2">
              <div className="relative">
                <button
                  onClick={() => setShowNewMenu(!showNewMenu)}
                  className="w-10 h-10 rounded-full bg-accent hover:bg-[#5a5ec9] flex items-center justify-center transition-colors"
                  title="Nouveau"
                >
                  <Plus size={20} className="text-white" />
                </button>
                
                {/* New Menu */}
                {showNewMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowNewMenu(false)} />
                    <div className="absolute right-0 top-12 z-50 min-w-[220px] bg-[#233138] rounded-2xl shadow-2xl py-2 border border-bg-hover">
                      <button
                        onClick={() => { navigate('/contacts'); setShowNewMenu(false) }}
                        className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                      >
                        <UserPlus size={18} />
                        <span>Nouveau contact</span>
                      </button>
                      <button
                        onClick={() => { navigate('/groups/new'); setShowNewMenu(false) }}
                        className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                      >
                        <Users size={18} />
                        <span>Nouveau groupe</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="relative">
                <button
                  onClick={() => setShowFilterMenu(!showFilterMenu)}
                  className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1]"
                  title="Filtres"
                >
                  <MoreVertical size={20} />
                </button>
                
                {/* Filter Menu */}
                {showFilterMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowFilterMenu(false)} />
                    <div className="absolute right-0 top-12 z-50 min-w-[200px] bg-[#233138] rounded-2xl shadow-2xl py-2 border border-bg-hover">
                      <button
                        onClick={() => { setActiveFilter('all'); setShowFilterMenu(false) }}
                        className="w-full px-4 py-2 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                      >
                        {activeFilter === 'all' && <Check size={16} className="text-[#00a884]" />}
                        <span className={activeFilter === 'all' ? 'ml-0' : 'ml-7'}>Toutes les discussions</span>
                      </button>
                      <button
                        onClick={() => { setActiveFilter('unread'); setShowFilterMenu(false) }}
                        className="w-full px-4 py-2 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                      >
                        {activeFilter === 'unread' && <Check size={16} className="text-[#00a884]" />}
                        <span className={activeFilter === 'unread' ? 'ml-0' : 'ml-7'}>Non lues</span>
                      </button>
                      <button
                        onClick={() => { setActiveFilter('groups'); setShowFilterMenu(false) }}
                        className="w-full px-4 py-2 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                      >
                        {activeFilter === 'groups' && <Check size={16} className="text-[#00a884]" />}
                        <span className={activeFilter === 'groups' ? 'ml-0' : 'ml-7'}>Groupes</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          
          {/* Barre de recherche */}
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              placeholder="Rechercher ou démarrer une discussion"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-10 pr-3 bg-bg-surface text-text-primary text-sm rounded-xl border-none outline-none placeholder:text-text-secondary focus:bg-bg-hover"
            />
          </div>
          
          {/* Filtres */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setActiveFilter('all')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                activeFilter === 'all' ? 'bg-[#00a884] text-white' : 'hover:bg-bg-hover text-text-secondary'
              }`}
            >
              Tous
            </button>
            <button
              onClick={() => setActiveFilter('unread')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                activeFilter === 'unread' ? 'bg-[#00a884] text-white' : 'hover:bg-bg-hover text-text-secondary'
              }`}
            >
              Non lus
            </button>
            <button
              onClick={() => setActiveFilter('groups')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                activeFilter === 'groups' ? 'bg-[#00a884] text-white' : 'hover:bg-bg-hover text-text-secondary'
              }`}
            >
              Groupes
            </button>
          </div>
        </div>

        {/* Liste des conversations */}
        <div className="flex-1 overflow-y-auto pb-4">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <MessageCircle size={64} className="text-[#3b4a54] mb-4" />
              <h3 className="text-lg font-medium text-text-secondary mb-2">Aucune conversation</h3>
              <p className="text-sm text-text-secondary">Commencez une nouvelle discussion</p>
            </div>
          ) : (
          filteredConversations.map((conversation) => {
            // Déterminer le nom à afficher
            const displayName = conversation.type === 'group'
              ? conversation.name || 'Groupe'
              : conversation.otherUserProfile?.display_name || conversation.otherUserProfile?.username || 'Utilisateur'

            // Déterminer l'aperçu du dernier message
            const lastMessagePreview = conversation.lastMessage
              ? conversation.lastMessage.type === 'text'
                ? conversation.lastMessage.content
                : conversation.lastMessage.type === 'image'
                ? '📷 Photo'
                : conversation.lastMessage.type === 'video'
                ? '🎥 Vidéo'
                : conversation.lastMessage.type === 'audio'
                ? '🎤 Message vocal'
                : '📎 Fichier'
              : 'Aucun message'

              const hasUnread = (conversation.unreadCount || 0) > 0
              
              // Formater la date
              const formatDate = (dateStr: string) => {
                const date = new Date(dateStr)
                const now = new Date()
                const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
                
                if (diffDays === 0) {
                  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                } else if (diffDays === 1) {
                  return 'Hier'
                } else if (diffDays < 7) {
                  return date.toLocaleDateString('fr-FR', { weekday: 'short' })
                } else {
                  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
                }
              }

              return (
                <div
                  key={conversation.id}
                  className={`px-4 py-3 cursor-pointer transition-colors ${
                    hasUnread ? 'bg-bg-surface' : 'hover:bg-bg-surface'
                  }`}
                  onClick={() => navigate(`/chat/${conversation.id}`)}
                  onContextMenu={(e) => handleContextMenu(e, conversation.id)}
                >
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="relative">
                      {conversation.avatar_url ? (
                        <img
                          src={conversation.avatar_url}
                          alt={displayName}
                          className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold text-lg flex-shrink-0">
                          {displayName[0]?.toUpperCase()}
                        </div>
                      )}
                      {conversation.is_pinned && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                          <Pin size={12} className="text-white" />
                        </div>
                      )}
                      {conversation.is_muted && (
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#8696a0] flex items-center justify-center">
                          <BellOff size={12} className="text-white" />
                        </div>
                      )}
                    </div>
                    
                    {/* Contenu */}
                    <div className="flex-1 min-w-0 border-b border-bg-hover pb-3">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className={`truncate ${hasUnread ? 'text-white font-medium' : 'text-text-secondary'}`}>
                          {displayName}
                        </h3>
                        {conversation.last_message_at && (
                          <span className={`text-xs flex-shrink-0 ${hasUnread ? 'text-[#00a884]' : 'text-text-secondary'}`}>
                            {formatDate(conversation.last_message_at)}
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-sm truncate ${hasUnread ? 'text-text-secondary font-medium' : 'text-text-secondary'}`}>
                          {lastMessagePreview}
                        </p>
                        {hasUnread && (
                          <div className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#00a884] flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-semibold text-text-primary">
                              {conversation.unreadCount! > 99 ? '99+' : conversation.unreadCount}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Zone de chat vide - Style WhatsApp - Desktop only */}
      <div className="hidden md:flex flex-1 bg-bg-primary flex-col items-center justify-center">
        <div className="text-center">
          <h2 className="text-3xl font-light text-text-secondary mb-4">Anu pour JemaOS</h2>
          <p className="text-text-secondary max-w-lg mx-auto leading-relaxed mb-6">
            Messagerie décentralisée qui protège votre vie privée.<br/>
            Vos conversations sont chiffrées de bout en bout et transitent directement entre vous et vos contacts, sans serveur intermédiaire.
          </p>
          
          <div className="space-y-3 max-w-md mx-auto">
            <div className="flex items-start gap-3 text-left">
              <svg width="20" height="20" viewBox="0 0 16 20" fill="#6b6fdb" className="flex-shrink-0 mt-0.5">
                <path d="M13 7h-1V5c0-2.21-1.79-4-4-4S4 2.79 4 5v2H3c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm-5 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H4.9V5c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
              </svg>
              <div>
                <p className="text-sm text-text-secondary font-medium">Chiffrement de bout en bout</p>
                <p className="text-xs text-text-secondary">Personne ne peut lire vos messages, même pas nous</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3 text-left">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b6fdb" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="3"/>
                <circle cx="19" cy="5" r="2"/>
                <circle cx="5" cy="19" r="2"/>
                <path d="M10.4 15.6L6.6 17.4"/>
                <path d="M13.6 8.4L17.4 6.6"/>
              </svg>
              <div>
                <p className="text-sm text-text-secondary font-medium">Peer-to-peer décentralisé</p>
                <p className="text-xs text-text-secondary">Vos messages transitent directement entre appareils</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3 text-left">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b6fdb" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
                <line x1="3" y1="3" x2="21" y2="21"/>
              </svg>
              <div>
                <p className="text-sm text-text-secondary font-medium">Zéro collecte de données</p>
                <p className="text-xs text-text-secondary">Aucun tracking, aucune publicité, aucun log</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ConversationContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onMarkAsUnread={() => handleMarkAsUnread(contextMenu.conversationId)}
          onPin={() => handlePinConversation(contextMenu.conversationId)}
          onArchive={() => handleArchiveConversation(contextMenu.conversationId)}
          onMute={() => handleMuteConversation(contextMenu.conversationId)}
          onDelete={() => handleDeleteConversation(contextMenu.conversationId)}
          onOpenInNewWindow={() => handleOpenInNewWindow(contextMenu.conversationId)}
        />
      )}
    </MainLayout>
  )
}
