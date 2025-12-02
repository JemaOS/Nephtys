import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/MainLayout'
import { supabase, Contact, Profile } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { offlineStorage } from '@/lib/offlineStorage'
import { Search, UserPlus, MessageCircle, X, Check, Trash2, CheckSquare, Square } from 'lucide-react'

export function ContactsPage() {
  const [contacts, setContacts] = useState<(Contact & { profile: Profile })[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [usernameToAdd, setUsernameToAdd] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set())
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

      // Allow adding yourself (like "Saved Messages" in Telegram)
      // This creates a conversation with yourself for notes/saved messages

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

      // Créer automatiquement une conversation avec ce contact
      // Cas spécial: "Saved Messages" (conversation avec soi-même)
      const isSelfContact = profileData.id === user.id
      
      // Vérifier d'abord si une conversation existe déjà
      let conversationExists = false
      let existingConversationId: string | null = null
      
      if (isSelfContact) {
        // Pour "Saved Messages", chercher une conversation où l'utilisateur est le seul membre
        // ou une conversation de type 'direct' créée par soi-même avec soi-même
        const { data: myConversations } = await supabase
          .from('conversations')
          .select('id')
          .eq('type', 'direct')
          .eq('created_by', user.id)
        
        if (myConversations) {
          for (const conv of myConversations) {
            const { data: members } = await supabase
              .from('conversation_members')
              .select('user_id')
              .eq('conversation_id', conv.id)
            
            // Si la conversation n'a qu'un seul membre et c'est nous, c'est "Saved Messages"
            if (members && members.length === 1 && members[0].user_id === user.id) {
              conversationExists = true
              existingConversationId = conv.id
              break
            }
          }
        }
      } else {
        // Cas normal: chercher une conversation DIRECTE avec l'autre utilisateur
        // On doit vérifier que c'est bien une conversation de type 'direct' et non un groupe
        const { data: existingMembers } = await supabase
          .from('conversation_members')
          .select('conversation_id')
          .eq('user_id', user.id)

        if (existingMembers) {
          for (const member of existingMembers) {
            // Vérifier d'abord que c'est une conversation directe (pas un groupe)
            const { data: conversationData } = await supabase
              .from('conversations')
              .select('type')
              .eq('id', member.conversation_id)
              .maybeSingle()
            
            // Si ce n'est pas une conversation directe, passer à la suivante
            if (!conversationData || conversationData.type !== 'direct') {
              continue
            }

            const { data: otherMember } = await supabase
              .from('conversation_members')
              .select('*')
              .eq('conversation_id', member.conversation_id)
              .eq('user_id', profileData.id)
              .maybeSingle()

            if (otherMember) {
              conversationExists = true
              existingConversationId = member.conversation_id
              break
            }
          }
        }
      }

      // Si pas de conversation existante, en créer une nouvelle
      if (!conversationExists) {
        const { data: conversation, error: convError } = await supabase
          .from('conversations')
          .insert({
            type: 'direct',
            created_by: user.id,
            is_encrypted: true,
            last_message_at: new Date().toISOString(),
            // Pour "Saved Messages", on peut ajouter un nom spécial
            name: isSelfContact ? 'Messages enregistrés' : null,
          })
          .select()
          .maybeSingle()

        if (!convError && conversation) {
          if (isSelfContact) {
            // Pour "Saved Messages", un seul membre (soi-même)
            await supabase
              .from('conversation_members')
              .insert([
                { conversation_id: conversation.id, user_id: user.id, role: 'admin', is_active: true }
              ])
          } else {
            // Cas normal: deux membres
            await supabase
              .from('conversation_members')
              .insert([
                { conversation_id: conversation.id, user_id: user.id, role: 'admin', is_active: true },
                { conversation_id: conversation.id, user_id: profileData.id, role: 'member', is_active: true }
              ])
          }
          
          console.log('Conversation créée automatiquement:', conversation.id)
          existingConversationId = conversation.id
        }
      }
      
      // Naviguer vers la conversation créée ou existante
      if (existingConversationId) {
        navigate(`/chat/${existingConversationId}`)
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

  // Track ongoing conversation creation to prevent duplicates
  const creatingConversationRef = useRef<Set<string>>(new Set())

  const createConversation = async (contactId: string) => {
    if (!user) return

    // Prevent duplicate creation attempts
    if (creatingConversationRef.current.has(contactId)) {
      console.log('Already creating conversation with:', contactId)
      return
    }

    console.log('Creating conversation with contact:', contactId)
    
    // Cas spécial: "Saved Messages" (conversation avec soi-même)
    const isSelfContact = contactId === user.id

    try {
      // OPTIMIZATION 1: Check IndexedDB cache first for instant navigation
      const cachedConversations = await offlineStorage.getConversations()
      
      if (cachedConversations.length > 0) {
        let cachedConv = null
        
        if (isSelfContact) {
          // For "Saved Messages", find conversation with only self as member
          cachedConv = cachedConversations.find(c =>
            c.type === 'direct' &&
            c.created_by === user.id &&
            c.name === 'Messages enregistrés'
          )
        } else {
          // For normal contacts, find direct conversation with this user
          cachedConv = cachedConversations.find(c =>
            c.type === 'direct' &&
            c.otherUserProfile?.id === contactId
          )
        }
        
        if (cachedConv) {
          console.log('Found conversation in cache, navigating immediately:', cachedConv.id)
          navigate(`/chat/${cachedConv.id}`)
          return
        }
      }

      // Mark as creating to prevent duplicates
      creatingConversationRef.current.add(contactId)

      // OPTIMIZATION 2: Single optimized query to find existing conversation
      if (isSelfContact) {
        // Pour "Saved Messages", chercher une conversation où l'utilisateur est le seul membre
        const { data: savedMessagesConv } = await supabase
          .from('conversations')
          .select('id')
          .eq('type', 'direct')
          .eq('created_by', user.id)
          .eq('name', 'Messages enregistrés')
          .maybeSingle()
        
        if (savedMessagesConv) {
          console.log('Saved Messages conversation found:', savedMessagesConv.id)
          creatingConversationRef.current.delete(contactId)
          navigate(`/chat/${savedMessagesConv.id}`)
          return
        }
      } else {
        // Optimized: Use a single query with join to find direct conversation
        const { data: existingConv } = await supabase
          .from('conversation_members')
          .select(`
            conversation_id,
            conversations!inner(id, type)
          `)
          .eq('user_id', contactId)
          .eq('conversations.type', 'direct')
        
        if (existingConv && existingConv.length > 0) {
          // Check if user is also a member of any of these conversations
          const convIds = existingConv.map(c => c.conversation_id)
          const { data: userMembership } = await supabase
            .from('conversation_members')
            .select('conversation_id')
            .eq('user_id', user.id)
            .in('conversation_id', convIds)
            .limit(1)
            .maybeSingle()
          
          if (userMembership) {
            console.log('Direct conversation found:', userMembership.conversation_id)
            creatingConversationRef.current.delete(contactId)
            navigate(`/chat/${userMembership.conversation_id}`)
            return
          }
        }
      }

      // OPTIMIZATION 3: Create conversation and navigate optimistically
      // Generate a temporary ID for optimistic navigation
      const { data: conversation, error: convError } = await supabase
        .from('conversations')
        .insert({
          type: 'direct',
          created_by: user.id,
          is_encrypted: true,
          last_message_at: new Date().toISOString(),
          name: isSelfContact ? 'Messages enregistrés' : null,
        })
        .select()
        .maybeSingle()

      if (convError) {
        console.error('Error creating conversation:', convError)
        creatingConversationRef.current.delete(contactId)
        return
      }

      if (conversation) {
        // Navigate immediately (optimistic)
        console.log('Conversation created, navigating immediately:', conversation.id)
        navigate(`/chat/${conversation.id}`)

        // Add members in background (non-blocking)
        const addMembers = async () => {
          try {
            if (isSelfContact) {
              await supabase
                .from('conversation_members')
                .insert([
                  { conversation_id: conversation.id, user_id: user.id, role: 'admin', is_active: true }
                ])
            } else {
              await supabase
                .from('conversation_members')
                .insert([
                  { conversation_id: conversation.id, user_id: user.id, role: 'admin', is_active: true },
                  { conversation_id: conversation.id, user_id: contactId, role: 'member', is_active: true }
                ])
            }
            console.log('Members added successfully')
          } catch (err) {
            console.error('Error adding members:', err)
          } finally {
            creatingConversationRef.current.delete(contactId)
          }
        }
        
        // Execute in background without awaiting
        addMembers()
      } else {
        creatingConversationRef.current.delete(contactId)
      }
    } catch (err) {
      console.error('Error in createConversation:', err)
      creatingConversationRef.current.delete(contactId)
    }
  }

  const filteredContacts = contacts.filter(contact =>
    contact.profile.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.profile.display_name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Selection mode handlers
  const toggleSelectionMode = useCallback(() => {
    setIsSelectionMode(prev => !prev)
    setSelectedContacts(new Set())
  }, [])

  const toggleContactSelection = useCallback((contactId: string) => {
    setSelectedContacts(prev => {
      const newSet = new Set(prev)
      if (newSet.has(contactId)) {
        newSet.delete(contactId)
      } else {
        newSet.add(contactId)
      }
      return newSet
    })
  }, [])

  const selectAllContacts = useCallback(() => {
    if (selectedContacts.size === filteredContacts.length) {
      setSelectedContacts(new Set())
    } else {
      setSelectedContacts(new Set(filteredContacts.map(c => c.id)))
    }
  }, [filteredContacts, selectedContacts.size])

  const deleteSelectedContacts = useCallback(async () => {
    if (selectedContacts.size === 0 || !user) return
    
    const confirmMessage = selectedContacts.size === 1
      ? 'Voulez-vous vraiment supprimer ce contact ? La conversation associée sera également supprimée.'
      : `Voulez-vous vraiment supprimer ces ${selectedContacts.size} contacts ? Les conversations associées seront également supprimées.`
    
    if (!confirm(confirmMessage)) return

    try {
      // Get the contact_user_ids for the selected contacts
      const contactsToDelete = contacts.filter(c => selectedContacts.has(c.id))
      
      // Get all contact_user_ids (both explicit and chat contacts)
      const contactUserIds = contactsToDelete.map(c => c.contact_user_id)
      
      // Delete explicit contacts from contacts table
      const realContactIds = contactsToDelete
        .filter(c => !c.id.startsWith('chat-'))
        .map(c => c.id)

      if (realContactIds.length > 0) {
        const { error } = await supabase
          .from('contacts')
          .delete()
          .in('id', realContactIds)

        if (error) {
          console.error('Error deleting contacts:', error)
        }
      }

      // Find and delete associated direct conversations
      for (const contactUserId of contactUserIds) {
        // Special case: "Saved Messages" (self-contact)
        const isSelfContact = contactUserId === user.id
        
        // Find conversations where both users are members
        const { data: myConversations } = await supabase
          .from('conversation_members')
          .select('conversation_id')
          .eq('user_id', user.id)

        if (myConversations) {
          for (const conv of myConversations) {
            // Check if it's a direct conversation
            const { data: allMembers } = await supabase
              .from('conversation_members')
              .select('user_id')
              .eq('conversation_id', conv.conversation_id)

            if (!allMembers) continue

            // For "Saved Messages": conversation with only 1 member (self)
            if (isSelfContact && allMembers.length === 1 && allMembers[0].user_id === user.id) {
              // Delete the conversation members first
              await supabase
                .from('conversation_members')
                .delete()
                .eq('conversation_id', conv.conversation_id)

              // Delete messages in the conversation
              await supabase
                .from('messages')
                .delete()
                .eq('conversation_id', conv.conversation_id)

              // Delete the conversation
              await supabase
                .from('conversations')
                .delete()
                .eq('id', conv.conversation_id)

              console.log('Deleted Saved Messages conversation:', conv.conversation_id)
              continue
            }

            // For normal contacts: check if this is a direct conversation with the contact
            if (!isSelfContact) {
              const hasOtherMember = allMembers.some(m => m.user_id === contactUserId)

              if (hasOtherMember && allMembers.length === 2) {
                // Delete the conversation members first
                await supabase
                  .from('conversation_members')
                  .delete()
                  .eq('conversation_id', conv.conversation_id)

                // Delete messages in the conversation
                await supabase
                  .from('messages')
                  .delete()
                  .eq('conversation_id', conv.conversation_id)

                // Delete the conversation
                await supabase
                  .from('conversations')
                  .delete()
                  .eq('id', conv.conversation_id)

                console.log('Deleted conversation:', conv.conversation_id)
              }
            }
          }
        }
      }

      // Reload contacts
      await loadContacts()
      setSelectedContacts(new Set())
      setIsSelectionMode(false)
    } catch (err) {
      console.error('Error deleting contacts:', err)
      alert('Erreur lors de la suppression des contacts')
    }
  }, [selectedContacts, contacts, user])

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col bg-bg-primary pb-14 md:pb-0">
        {/* Header */}
        <div className="bg-bg-surface px-4 py-3">
          <div className="flex items-center justify-between mb-4">
            {isSelectionMode ? (
              <>
                <div className="flex items-center gap-3">
                  <button
                    onClick={toggleSelectionMode}
                    className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-text-secondary"
                  >
                    <X size={20} />
                  </button>
                  <span className="text-text-primary font-medium">
                    {selectedContacts.size} sélectionné{selectedContacts.size > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={selectAllContacts}
                    className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-text-secondary"
                    title={selectedContacts.size === filteredContacts.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                  >
                    {selectedContacts.size === filteredContacts.length ? (
                      <CheckSquare size={20} className="text-accent" />
                    ) : (
                      <Square size={20} />
                    )}
                  </button>
                  <button
                    onClick={deleteSelectedContacts}
                    disabled={selectedContacts.size === 0}
                    className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#ea4335] disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Supprimer"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <h1 className="text-xl font-semibold text-text-primary">Contacts</h1>
                <div className="flex items-center gap-2">
                  {contacts.length > 0 && (
                    <button
                      onClick={toggleSelectionMode}
                      className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-text-secondary"
                      title="Sélectionner"
                    >
                      <CheckSquare size={20} />
                    </button>
                  )}
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="w-10 h-10 rounded-full bg-accent hover:bg-[#5a5ec9] flex items-center justify-center transition-colors"
                  >
                    <UserPlus size={20} className="text-white" />
                  </button>
                </div>
              </>
            )}
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
              <div
                key={contact.id}
                className={`px-4 py-3 hover:bg-bg-surface transition-colors cursor-pointer ${
                  selectedContacts.has(contact.id) ? 'bg-accent/10' : ''
                }`}
                onClick={() => {
                  if (isSelectionMode) {
                    toggleContactSelection(contact.id)
                  }
                }}
              >
                <div className="flex items-center gap-3">
                  {/* Selection checkbox */}
                  {isSelectionMode && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleContactSelection(contact.id)
                      }}
                      className={`w-6 h-6 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
                        selectedContacts.has(contact.id)
                          ? 'bg-accent text-white'
                          : 'bg-bg-hover text-text-tertiary border border-bg-hover'
                      }`}
                    >
                      <Check size={14} />
                    </button>
                  )}
                  
                  {/* Avatar with profile photo */}
                  {contact.profile.avatar_url ? (
                    <img
                      src={contact.profile.avatar_url}
                      alt={contact.profile.display_name || contact.profile.username}
                      className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold text-lg flex-shrink-0">
                      {(contact.profile.display_name || contact.profile.username)[0].toUpperCase()}
                    </div>
                  )}
                  
                  <div className="flex-1 min-w-0 border-b border-bg-hover pb-3">
                    <h3 className="text-text-primary font-normal truncate">
                      {contact.nickname || contact.profile.display_name || contact.profile.username}
                    </h3>
                    <p className="text-sm text-text-secondary truncate">
                      @{contact.profile.username}
                    </p>
                  </div>

                  {!isSelectionMode && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        createConversation(contact.contact_user_id)
                      }}
                      className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors flex-shrink-0"
                    >
                      <MessageCircle size={20} className="text-[#787add]" />
                    </button>
                  )}
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
              <label className="text-sm text-[#787add]">Nom d'utilisateur</label>
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
