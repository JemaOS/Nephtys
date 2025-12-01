import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/MainLayout'
import { supabase, Contact, Profile } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Search, UserPlus, MessageCircle, X, Check } from 'lucide-react'

export function ContactsPage() {
  const [contacts, setContacts] = useState<(Contact & { profile: Profile })[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [usernameToAdd, setUsernameToAdd] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) {
      loadContacts()
    }
  }, [user])

  const loadContacts = async () => {
    if (!user) return

    // 1. Load explicit contacts
    const { data: contactsData } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_blocked', false)
      .order('added_at', { ascending: false })

    // 2. Load users from existing conversations (chat contacts)
    const { data: myConversations } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', user.id)

    const conversationIds = myConversations?.map(c => c.conversation_id) || []
    
    // Get other members from these conversations
    let chatUserIds: string[] = []
    if (conversationIds.length > 0) {
      const { data: otherMembers } = await supabase
        .from('conversation_members')
        .select('user_id')
        .in('conversation_id', conversationIds)
        .neq('user_id', user.id)
      
      chatUserIds = [...new Set(otherMembers?.map(m => m.user_id) || [])]
    }

    // Get explicit contact user IDs
    const explicitContactIds = contactsData?.map(c => c.contact_user_id) || []
    
    // Combine and deduplicate
    const allContactIds = [...new Set([...explicitContactIds, ...chatUserIds])]

    if (allContactIds.length > 0) {
      // Fetch all profiles at once
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', allContactIds)

      if (profiles) {
        const contactsWithProfiles = profiles.map(profile => {
          // Check if this is an explicit contact
          const explicitContact = contactsData?.find(c => c.contact_user_id === profile.id)
          
          if (explicitContact) {
            return { ...explicitContact, profile }
          } else {
            // Create a virtual contact entry for chat contacts
            return {
              id: `chat-${profile.id}`,
              user_id: user.id,
              contact_user_id: profile.id,
              nickname: null,
              is_blocked: false,
              is_favorite: false,
              added_at: new Date().toISOString(),
              profile
            }
          }
        })

        setContacts(contactsWithProfiles.filter(c => c.profile) as (Contact & { profile: Profile })[])
      }
    } else {
      setContacts([])
    }
  }

  const addContact = async () => {
    if (!user || !usernameToAdd) return
    
    setLoading(true)
    setError('')

    try {
      // Rechercher l'utilisateur par pseudo
      const { data: profileData, error: searchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('username', usernameToAdd.trim())
        .maybeSingle()

      if (searchError || !profileData) {
        setError('Utilisateur introuvable')
        setLoading(false)
        return
      }

      if (profileData.id === user.id) {
        setError('Vous ne pouvez pas vous ajouter vous-même')
        setLoading(false)
        return
      }

      // Vérifier si déjà en contact
      const { data: existingContact } = await supabase
        .from('contacts')
        .select('*')
        .eq('user_id', user.id)
        .eq('contact_user_id', profileData.id)
        .maybeSingle()

      if (existingContact) {
        setError('Contact déjà ajouté')
        setLoading(false)
        return
      }

      // Ajouter le contact
      const { error: insertError } = await supabase
        .from('contacts')
        .insert({
          user_id: user.id,
          contact_user_id: profileData.id,
          is_blocked: false,
          is_favorite: false
        })

      if (insertError) {
        setError('Erreur lors de l\'ajout')
        setLoading(false)
        return
      }

      // Recharger la liste
      await loadContacts()
      setShowAddModal(false)
      setUsernameToAdd('')
    } catch (err) {
      setError('Erreur inattendue')
    } finally {
      setLoading(false)
    }
  }

  const createConversation = async (contactId: string) => {
    if (!user) return

    console.log('Creating conversation with contact:', contactId)

    try {
      // Check if conversation already exists
      const { data: existingMembers } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id)

      if (existingMembers) {
        for (const member of existingMembers) {
          const { data: otherMember } = await supabase
            .from('conversation_members')
            .select('*')
            .eq('conversation_id', member.conversation_id)
            .eq('user_id', contactId)
            .maybeSingle()

          if (otherMember) {
            console.log('Conversation already exists:', member.conversation_id)
            navigate(`/chat/${member.conversation_id}`)
            return
          }
        }
      }

      // Create new conversation
      const { data: conversation, error: convError } = await supabase
        .from('conversations')
        .insert({
          type: 'direct',
          created_by: user.id,
          is_encrypted: true,
          last_message_at: new Date().toISOString(),
        })
        .select()
        .maybeSingle()

      if (convError) {
        console.error('Error creating conversation:', convError)
        return
      }

      console.log('Conversation created:', conversation)

      if (conversation) {
        const { error: membersError } = await supabase
          .from('conversation_members')
          .insert([
            { conversation_id: conversation.id, user_id: user.id, role: 'admin', is_active: true },
            { conversation_id: conversation.id, user_id: contactId, role: 'member', is_active: true }
          ])

        if (membersError) {
          console.error('Error adding members:', membersError)
          return
        }

        console.log('Members added, navigating to chat')
        navigate(`/chat/${conversation.id}`)
      }
    } catch (err) {
      console.error('Error in createConversation:', err)
    }
  }

  const filteredContacts = contacts.filter(contact =>
    contact.profile.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.profile.display_name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col bg-bg-primary pb-14 md:pb-0">
        {/* Header */}
        <div className="bg-bg-surface px-4 py-3">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-semibold text-text-primary">Contacts</h1>
            <button
              onClick={() => setShowAddModal(true)}
              className="w-10 h-10 rounded-full bg-accent hover:bg-[#5a5ec9] flex items-center justify-center transition-colors"
            >
              <UserPlus size={20} className="text-white" />
            </button>
          </div>
          
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              placeholder="Rechercher un contact..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-10 pr-3 bg-bg-surface text-text-primary text-sm rounded-xl border-none outline-none placeholder:text-text-secondary focus:bg-bg-hover"
            />
          </div>
        </div>

        {/* Contacts List */}
        <div className="flex-1 overflow-y-auto pb-2">
          {filteredContacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <UserPlus size={64} className="text-[#3b4a54] mb-4" />
              <h3 className="text-lg font-medium text-text-secondary mb-2">Aucun contact</h3>
              <p className="text-sm text-text-secondary mb-4">Ajoutez des contacts pour commencer</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-6 py-2 rounded-lg bg-accent hover:bg-[#5a5ec9] text-white font-medium transition-colors"
              >
                Ajouter un contact
              </button>
            </div>
          ) : (
            filteredContacts.map((contact) => (
              <div key={contact.id} className="px-4 py-3 hover:bg-bg-surface transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold text-lg">
                    {contact.profile.username[0].toUpperCase()}
                  </div>
                  
                  <div className="flex-1 min-w-0 border-b border-bg-hover pb-3">
                    <h3 className="text-text-primary font-normal truncate">
                      {contact.nickname || contact.profile.display_name || contact.profile.username}
                    </h3>
                    <p className="text-sm text-text-secondary truncate">
                      @{contact.profile.username}
                    </p>
                  </div>

                  <button
                    onClick={() => createConversation(contact.contact_user_id)}
                    className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors flex-shrink-0"
                  >
                    <MessageCircle size={20} className="text-[#00a884]" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add Contact Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-md bg-bg-surface rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-text-primary">Ajouter un contact</h2>
              <button
                onClick={() => {
                  setShowAddModal(false)
                  setUsernameToAdd('')
                  setError('')
                }}
                className="w-8 h-8 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-text-secondary"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-[#00a884]">Nom d'utilisateur</label>
              <div className="relative">
                <UserPlus size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  type="text"
                  placeholder="pseudo_utilisateur"
                  value={usernameToAdd}
                  onChange={(e) => {
                    setUsernameToAdd(e.target.value)
                    setError('')
                  }}
                  className="w-full h-11 pl-10 pr-3 bg-bg-hover text-text-primary text-sm rounded-xl border-none outline-none placeholder:text-text-secondary"
                />
              </div>
              {error && <p className="text-sm text-[#ea4335]">{error}</p>}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowAddModal(false)
                  setUsernameToAdd('')
                  setError('')
                }}
                className="flex-1 py-2 rounded-xl bg-bg-hover hover:bg-[#3b4a54] text-white transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={addContact}
                disabled={!usernameToAdd.trim() || loading}
                className="flex-1 py-2 rounded-xl bg-accent hover:bg-[#5a5ec9] text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                ) : (
                  <>
                    <Check size={18} />
                    Ajouter
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  )
}
