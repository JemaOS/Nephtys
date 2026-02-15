// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/MainLayout'
import { supabase, Contact, Profile } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { offlineStorage } from '@/lib/offlineStorage'
import { Search, UserPlus, MessageCircle, X, Check, Trash2, CheckSquare, Square } from 'lucide-react'

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

// Helper to find existing Saved Messages conversation (for self-contact)
const findSavedMessagesConversation = async (supabase: any, userId: string): Promise<{ exists: boolean; conversationId: string | null }> => {
  const { data: myConversations } = await supabase
    .from('conversations')
    .select('id')
    .eq('type', 'direct')
    .eq('created_by', userId)
  
  if (myConversations) {
    for (const conv of myConversations) {
      const { data: members } = await supabase
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', conv.id)
      
      if (members && members.length === 1 && members[0].user_id === userId) {
        return { exists: true, conversationId: conv.id }
      }
    }
  }
  return { exists: false, conversationId: null }
}

// Helper to find existing direct conversation with a contact
const findDirectConversation = async (supabase: any, userId: string, contactUserId: string): Promise<{ exists: boolean; conversationId: string | null }> => {
  const { data: existingMembers } = await supabase
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userId)

  if (existingMembers) {
    for (const member of existingMembers) {
      const { data: conversationData } = await supabase
        .from('conversations')
        .select('type')
        .eq('id', member.conversation_id)
        .maybeSingle()
      
      if (!conversationData || conversationData.type !== 'direct') {
        continue
      }

      const { data: otherMember } = await supabase
        .from('conversation_members')
        .select('*')
        .eq('conversation_id', member.conversation_id)
        .eq('user_id', contactUserId)
        .maybeSingle()

      if (otherMember) {
        return { exists: true, conversationId: member.conversation_id }
      }
    }
  }
  return { exists: false, conversationId: null }
}

// Helper to create a new conversation
const createNewConversation = async (supabase: any, userId: string, contactUserId: string, isSelfContact: boolean): Promise<string | null> => {
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .insert({
      type: 'direct',
      created_by: userId,
      is_encrypted: true,
      last_message_at: new Date().toISOString(),
      name: isSelfContact ? 'Messages enregistrés' : null,
    })
    .select()
    .maybeSingle()

  if (convError || !conversation) {
    console.error('Error creating conversation:', convError)
    return null
  }

  // Add members
  if (isSelfContact) {
    await supabase
      .from('conversation_members')
      .insert([
        { conversation_id: conversation.id, user_id: userId, role: 'admin', is_active: true }
      ])
  } else {
    await supabase
      .from('conversation_members')
      .insert([
        { conversation_id: conversation.id, user_id: userId, role: 'admin', is_active: true },
        { conversation_id: conversation.id, user_id: contactUserId, role: 'member', is_active: true }
      ])
  }
  
  console.log('Conversation created automatically:', conversation.id)
  return conversation.id
}

// Helper: Find cached conversation for contact (moved to module level to reduce complexity)
const findCachedConversation = async (
  cachedConversations: any[],
  isSelfContact: boolean,
  userId: string,
  contactId: string
): Promise<string | null> => {
  if (cachedConversations.length === 0) return null;
  
  if (isSelfContact) {
    const cachedConv = cachedConversations.find(c =>
      c.type === 'direct' &&
      c.created_by === userId &&
      c.name === 'Messages enregistrés'
    );
    return cachedConv?.id || null;
  } else {
    const cachedConv = cachedConversations.find(c =>
      c.type === 'direct' &&
      c.otherUserProfile?.id === contactId
    );
    return cachedConv?.id || null;
  }
};

// Helper: Find existing conversation in database (moved to module level to reduce complexity)
const findExistingConversation = async (
  supabase: any,
  isSelfContact: boolean,
  userId: string,
  contactId: string
): Promise<string | null> => {
  if (isSelfContact) {
    const { data: savedMessagesConv } = await supabase
      .from('conversations')
      .select('id')
      .eq('type', 'direct')
      .eq('created_by', userId)
      .eq('name', 'Messages enregistrés')
      .maybeSingle();
    
    return savedMessagesConv?.id || null;
  } else {
    const { data: existingConv } = await supabase
      .from('conversation_members')
      .select(`
        conversation_id,
        conversations!conversation_members_conversation_id_fkey!inner(id, type)
      `)
      .eq('user_id', contactId)
      .eq('conversations.type', 'direct');
    
    if (existingConv && existingConv.length > 0) {
      const convIds = existingConv.map(c => c.conversation_id);
      const { data: userMembership } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', userId)
        .in('conversation_id', convIds)
        .limit(1)
        .maybeSingle();
      
      return userMembership?.conversation_id || null;
    }
    return null;
  }
};

// Helper: Create new conversation and add members (moved to module level to reduce complexity)
const createNewConversationAndAddMembers = async (
  supabase: any,
  userId: string,
  contactId: string,
  isSelfContact: boolean
): Promise<string | null> => {
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .insert({
      type: 'direct',
      created_by: userId,
      is_encrypted: true,
      last_message_at: new Date().toISOString(),
      name: isSelfContact ? 'Messages enregistrés' : null,
    })
    .select()
    .maybeSingle();

  if (convError || !conversation) {
    console.error('Error creating conversation:', convError);
    return null;
  }

  // Navigate immediately (optimistic)
  console.log('Conversation created, navigating immediately:', conversation.id);

  // Add members in background (non-blocking)
  const addMembers = async () => {
    try {
      if (isSelfContact) {
        await supabase
          .from('conversation_members')
          .insert([
            { conversation_id: conversation.id, user_id: userId, role: 'admin', is_active: true }
          ]);
      } else {
        await supabase
          .from('conversation_members')
          .insert([
            { conversation_id: conversation.id, user_id: userId, role: 'admin', is_active: true },
            { conversation_id: conversation.id, user_id: contactId, role: 'member', is_active: true }
          ]);
      }
      console.log('Members added successfully');
    } catch (err) {
      console.error('Error adding members:', err);
    }
  };
  
  // Execute in background without awaiting
  addMembers();
  return conversation.id;
};

export function ContactsPage() {
  // Initialize from cache for instant display
  const [contacts, setContacts] = useState<(Contact & { profile: Profile })[]>(() =>
    getCache<(Contact & { profile: Profile })[]>('contacts') || []
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [usernameToAdd, setUsernameToAdd] = useState('')
  const [loading, setLoading] = useState(() => {
    const cached = getCache<(Contact & { profile: Profile })[]>('contacts')
    return !cached || cached.length === 0
  })
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

    // Only show loading if we don't have cached data
    const hasCachedContacts = contacts.length > 0
    if (!hasCachedContacts) {
      setLoading(true)
    }

    try {
      // OPTIMIZATION: Run both queries in parallel instead of sequentially
      const [contactsResult, conversationsResult] = await Promise.all([
        // 1. Load explicit contacts
        supabase
          .from('contacts')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_blocked', false)
          .order('added_at', { ascending: false }),
        
        // 2. Load conversation members in a single optimized query
        supabase
          .from('conversation_members')
          .select('conversation_id, user_id')
          .neq('user_id', user.id)
      ])

      const contactsData = contactsResult.data
      
      // Deduplicate contacts by contact_user_id, keeping the most recent entry (first due to DESC order)
      const uniqueContactsMap = new Map<string, typeof contactsData extends (infer T)[] ? T : never>()
      for (const contact of (contactsData || [])) {
        if (!uniqueContactsMap.has(contact.contact_user_id)) {
          uniqueContactsMap.set(contact.contact_user_id, contact)
        }
      }
      const deduplicatedContacts = Array.from(uniqueContactsMap.values())
      
      // Get my conversation IDs first (we need to filter)
      const { data: myConversations } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id)
      
      const myConversationIds = new Set(myConversations?.map(c => c.conversation_id) || [])
      
      // Filter other members to only those in my conversations
      const chatUserIds = [...new Set(
        (conversationsResult.data || [])
          .filter(m => myConversationIds.has(m.conversation_id))
          .map(m => m.user_id)
      )]

      // Get explicit contact user IDs (from deduplicated list)
      const explicitContactIds = deduplicatedContacts.map(c => c.contact_user_id)
      
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
            // Check if this is an explicit contact (use deduplicated list)
            const explicitContact = deduplicatedContacts.find(c => c.contact_user_id === profile.id)
            
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

          const filteredContacts = contactsWithProfiles.filter(c => c.profile) as (Contact & { profile: Profile })[]
          setContacts(filteredContacts)
          setCache('contacts', filteredContacts) // Cache for instant display
        }
      } else {
        setContacts([])
        setCache('contacts', [])
      }
    } catch (error) {
      console.error('Error loading contacts:', error)
    } finally {
      setLoading(false)
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

      // Vérifier si déjà en contact (non bloqué)
      const { data: existingContact } = await supabase
        .from('contacts')
        .select('*')
        .eq('user_id', user.id)
        .eq('contact_user_id', profileData.id)
        .maybeSingle()

      if (existingContact && !existingContact.is_blocked) {
        setError('Contact déjà ajouté')
        setLoading(false)
        return
      }

      // Ajouter ou mettre à jour le contact (upsert pour gérer les re-ajouts après suppression)
      // Utiliser upsert pour éviter les problèmes de doublons ou de contraintes uniques
      const { error: upsertError } = await supabase
        .from('contacts')
        .upsert({
          user_id: user.id,
          contact_user_id: profileData.id,
          is_blocked: false,
          is_favorite: existingContact?.is_favorite || false,
          added_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,contact_user_id'
        })

      if (upsertError) {
        console.error('Error upserting contact:', upsertError)
        setError('Erreur lors de l\'ajout')
        setLoading(false)
        return
      }

      // Créer automatiquement une conversation avec ce contact
      // Cas spécial: "Saved Messages" (conversation avec soi-même)
      const isSelfContact = profileData.id === user.id
      
      // Find or create conversation using helpers
      let existingConversationId: string | null = null
      
      if (isSelfContact) {
        const result = await findSavedMessagesConversation(supabase, user.id)
        existingConversationId = result.conversationId
      } else {
        const result = await findDirectConversation(supabase, user.id, profileData.id)
        existingConversationId = result.conversationId
      }

      // Si pas de conversation existante, en créer une nouvelle
      if (!existingConversationId) {
        existingConversationId = await createNewConversation(supabase, user.id, profileData.id, isSelfContact)
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
      const cachedConvId = await findCachedConversation(
        cachedConversations,
        isSelfContact,
        user.id,
        contactId
      )
      
      if (cachedConvId) {
        console.log('Found conversation in cache, navigating immediately:', cachedConvId)
        navigate(`/chat/${cachedConvId}`)
        return
      }

      // Mark as creating to prevent duplicates
      creatingConversationRef.current.add(contactId)

      // OPTIMIZATION 2: Single optimized query to find existing conversation
      const existingConvId = await findExistingConversation(
        supabase,
        isSelfContact,
        user.id,
        contactId
      )

      if (existingConvId) {
        console.log('Existing conversation found:', existingConvId)
        creatingConversationRef.current.delete(contactId)
        navigate(`/chat/${existingConvId}`)
        return
      }

      // OPTIMIZATION 3: Create conversation and navigate optimistically
      const newConvId = await createNewConversationAndAddMembers(
        supabase,
        user.id,
        contactId,
        isSelfContact
      )

      if (newConvId) {
        navigate(`/chat/${newConvId}`)
      }
      
      creatingConversationRef.current.delete(contactId)
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

  // Helper function to delete a Saved Messages conversation
  const deleteSavedMessagesConversation = async (
    userId: string,
    myConversations: { conversation_id: string }[]
  ): Promise<boolean> => {
    for (const conv of myConversations) {
      const { data: conversationData } = await supabase
        .from('conversations')
        .select('type, created_by')
        .eq('id', conv.conversation_id)
        .maybeSingle()
      
      if (!conversationData || conversationData.type !== 'direct') continue

      const { data: allMembers } = await supabase
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', conv.conversation_id)

      if (!allMembers) continue

      // Saved Messages: conversation with only 1 member (self)
      if (allMembers.length === 1 && allMembers[0].user_id === userId) {
        await supabase.from('conversation_members').delete().eq('conversation_id', conv.conversation_id)
        await supabase.from('messages').delete().eq('conversation_id', conv.conversation_id)
        await supabase.from('conversations').delete().eq('id', conv.conversation_id)
        return true
      }
    }
    return false
  }

  // Helper function to delete a direct conversation with a contact
  const deleteDirectConversation = async (
    userId: string,
    contactUserId: string,
    isVirtual: boolean,
    myConversations: { conversation_id: string }[]
  ): Promise<boolean> => {
    for (const conv of myConversations) {
      const { data: conversationData } = await supabase
        .from('conversations')
        .select('type, created_by')
        .eq('id', conv.conversation_id)
        .maybeSingle()
      
      if (!conversationData || conversationData.type !== 'direct') continue

      const { data: allMembers } = await supabase
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', conv.conversation_id)

      if (!allMembers) continue

      const hasOtherMember = allMembers.some(m => m.user_id === contactUserId)
      if (hasOtherMember && allMembers.length === 2) {
        const weCreatedIt = conversationData.created_by === userId
        
        if (weCreatedIt || !isVirtual) {
          // Delete the whole conversation
          await supabase.from('conversation_members').delete().eq('conversation_id', conv.conversation_id)
          await supabase.from('messages').delete().eq('conversation_id', conv.conversation_id)
          await supabase.from('conversations').delete().eq('id', conv.conversation_id)
        } else {
          // Leave the conversation (virtual contact)
          await supabase.from('conversation_members').delete()
            .eq('conversation_id', conv.conversation_id)
            .eq('user_id', userId)
        }
        return true
      }
    }
    return false
  }

  // Helper function to remove contact from shared groups
  const removeContactFromGroups = async (
    userId: string,
    contactUserId: string,
    myConversations: { conversation_id: string }[]
  ): Promise<void> => {
    for (const conv of myConversations) {
      const { data: groupData } = await supabase
        .from('conversations')
        .select('type, created_by')
        .eq('id', conv.conversation_id)
        .maybeSingle()
      
      if (!groupData || groupData.type !== 'group') continue
      
      const { data: groupMembers } = await supabase
        .from('conversation_members')
        .select('user_id, role')
        .eq('conversation_id', conv.conversation_id)
      
      if (!groupMembers) continue
      
      const contactInGroup = groupMembers.find(m => m.user_id === contactUserId)
      if (!contactInGroup) continue
      
      const myRole = groupMembers.find(m => m.user_id === userId)?.role
      const isAdmin = myRole === 'admin' || groupData.created_by === userId
      
      if (isAdmin) {
        // Remove the contact from the group
        await supabase.from('conversation_members').delete()
          .eq('conversation_id', conv.conversation_id)
          .eq('user_id', contactUserId)
      } else {
        // Leave the group ourselves
        await supabase.from('conversation_members').delete()
          .eq('conversation_id', conv.conversation_id)
          .eq('user_id', userId)
      }
    }
    
    // Block the contact to prevent re-appearing
    await supabase.from('contacts').upsert({
      user_id: userId,
      contact_user_id: contactUserId,
      is_blocked: true,
      is_favorite: false,
      added_at: new Date().toISOString()
    }, {
      onConflict: 'user_id,contact_user_id'
    })
  }

// Helper: Process a single contact for deletion
const processContactForDeletion = async (
  supabase: any,
  userId: string,
  contact: { id: string; contact_user_id: string },
  myConversations: { conversation_id: string }[] | null
): Promise<boolean> => {
  const contactUserId = contact.contact_user_id;
  const isVirtual = contact.id.startsWith('chat-');
  const isSelfContact = contactUserId === userId;
  
  if (!myConversations) return false;
  
  let foundConversation = false;
  
  // Handle Saved Messages (self-contact)
  if (isSelfContact) {
    foundConversation = await deleteSavedMessagesConversation(userId, myConversations);
    if (foundConversation) {
      console.log('Deleted Saved Messages conversation');
    }
  } else {
    // Handle normal direct conversation
    foundConversation = await deleteDirectConversation(
      userId, 
      contactUserId, 
      isVirtual, 
      myConversations
    );
    if (foundConversation) {
      console.log('Deleted direct conversation');
    }
  }
  
  // Handle virtual contacts from group conversations
  if (!foundConversation && isVirtual) {
    console.log('Virtual contact from group conversation - removing from shared groups');
    await removeContactFromGroups(userId, contactUserId, myConversations);
  }
  
  return foundConversation;
};

// Helper: Get contacts to delete and categorize them
const getContactsToDelete = (
  contacts: (Contact & { profile: Profile })[],
  selectedContacts: Set<string>
): { explicit: (Contact & { profile: Profile })[]; virtual: (Contact & { profile: Profile })[] } => {
  const contactsToDelete = contacts.filter(c => selectedContacts.has(c.id));
  const explicit = contactsToDelete.filter(c => !c.id.startsWith('chat-'));
  const virtual = contactsToDelete.filter(c => c.id.startsWith('chat-'));
  return { explicit, virtual };
};

  const deleteSelectedContacts = useCallback(async () => {
    if (selectedContacts.size === 0 || !user) return
    
    const confirmMessage = selectedContacts.size === 1
      ? 'Voulez-vous vraiment supprimer ce contact ? La conversation associée sera également supprimée.'
      : `Voulez-vous vraiment supprimer ces ${selectedContacts.size} contacts ? Les conversations associées seront également supprimées.`
    
    if (!confirm(confirmMessage)) return

    console.log('Starting contact deletion...')
    console.log('Selected contacts:', Array.from(selectedContacts))

    try {
      // Get the contact_user_ids for the selected contacts
      const contactsToDelete = contacts.filter(c => selectedContacts.has(c.id))
      console.log('Contacts to delete:', contactsToDelete.map(c => ({ id: c.id, contact_user_id: c.contact_user_id, isVirtual: c.id.startsWith('chat-') })))
      
      // Get the conversations for the user
      const { data: myConversations } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id)

      console.log('My conversations count:', myConversations?.length)

      // Process each contact
      for (const contact of contactsToDelete) {
        await processContactForDeletion(
          supabase,
          user.id,
          contact,
          myConversations
        );
      }
      
      // Delete explicit contacts from contacts table
      const { explicit } = getContactsToDelete(contacts, selectedContacts);
      const realContactIds = explicit.map(c => c.id)

      if (realContactIds.length > 0) {
        console.log('Deleting explicit contacts with IDs:', realContactIds)
        const { error } = await supabase
          .from('contacts')
          .delete()
          .in('id', realContactIds)

        if (error) {
          console.error('Error deleting contacts:', error)
        } else {
          console.log('Explicit contacts deleted successfully')
        }
      }

      // Clear cache to ensure fresh data
      localStorage.removeItem(CACHE_PREFIX + 'contacts')
      console.log('Cache cleared')
      
      // Reload contacts
      await loadContacts()
      setSelectedContacts(new Set())
      setIsSelectionMode(false)
      console.log('Contacts reloaded successfully')
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
                    onClick={() => {
                      console.log('Delete button clicked, selectedContacts:', selectedContacts.size)
                      deleteSelectedContacts()
                    }}
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
          {loading ? (
            // Skeleton loading for better UX
            <div className="space-y-0">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="px-4 py-3 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-bg-hover flex-shrink-0" />
                    <div className="flex-1 min-w-0 border-b border-bg-hover pb-3">
                      <div className="h-4 bg-bg-hover rounded w-32 mb-2" />
                      <div className="h-3 bg-bg-hover rounded w-24" />
                    </div>
                    <div className="w-10 h-10 rounded-full bg-bg-hover flex-shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredContacts.length === 0 ? (
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
