// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/MainLayout'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { signFieldsBatch } from '@/lib/mediaUrl'
import { MediaImg } from '@/components/MediaImg'
import { useCall } from '@/context/CallContext'
import { useIsMobile } from '@/hooks/use-mobile'
import { Phone, Video, Search, Star, Link2, X, Trash2, UserPlus, Check, ArrowLeft, CheckCheck, Users } from 'lucide-react'
import { CallItem, CallDetailsContent } from './CallsPageComponents'

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
  } catch {
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
  } catch {
    // Ignore cache errors (quota exceeded, etc.)
  }
}

interface CallLog {
  id: string
  conversation_id: string
  caller_id: string
  callee_id: string | null
  type: 'audio' | 'video'
  status: 'initiated' | 'answered' | 'missed' | 'rejected' | 'ended'
  started_at: string
  ended_at: string | null
  duration: number | null
  caller_profile?: any
  callee_profile?: any
  // Group call info
  is_group_call?: boolean
  conversation_name?: string
  conversation_avatar?: string
}

// Module-level helper: Format call duration
export const formatCallDuration = (seconds: number | null): string => {
  if (!seconds) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// Module-level helper: Format date
export const formatCallDate = (dateStr: string): string => {
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

export function CallsPage() {
  // Initialize from cache for instant display
  const [calls, setCalls] = useState<CallLog[]>(() => getCache<CallLog[]>('calls') || [])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(() => {
    const cached = getCache<CallLog[]>('calls')
    return !cached || cached.length === 0
  })
  const [showContactsModal, setShowContactsModal] = useState(false)
  const [showFavoritesModal, setShowFavoritesModal] = useState(false)
  const [showAddContactModal, setShowAddContactModal] = useState(false)
  const [usernameToAdd, setUsernameToAdd] = useState('')
  const [addContactLoading, setAddContactLoading] = useState(false)
  const [addContactError, setAddContactError] = useState('')
  const [contacts, setContacts] = useState<any[]>(() => getCache<any[]>('calls_contacts') || [])
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null)
  const [favorites, setFavorites] = useState<string[]>([])
  const [favoriteGroups, setFavoriteGroups] = useState<Map<string, { name: string; avatar_url: string | null }>>(new Map())
  const [contextMenuCall, setContextMenuCall] = useState<CallLog | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [adjustedContextMenuPosition, setAdjustedContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // Adjust context menu position to stay within viewport
  useEffect(() => {
    if (contextMenuPosition && contextMenuRef.current) {
      const rect = contextMenuRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      
      let newX = contextMenuPosition.x
      let newY = contextMenuPosition.y
      
      if (newX + rect.width > viewportWidth) {
        newX = viewportWidth - rect.width - 10
      }
      
      if (newY + rect.height > viewportHeight) {
        newY = viewportHeight - rect.height - 10
      }
      
      setAdjustedContextMenuPosition({ x: newX, y: newY })
    } else {
      setAdjustedContextMenuPosition(null)
    }
  }, [contextMenuPosition])
  
  // Selection mode state (WhatsApp-style)
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedCalls, setSelectedCalls] = useState<Set<string>>(new Set())
  
  // Long press detection refs
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const longPressTriggeredRef = useRef(false)
  
  const { user } = useAuth()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  
  // Long press duration (ms) - WhatsApp uses ~500ms
  const LONG_PRESS_DURATION = 500
  
  // Use CallContext for all calls
  const {
    startCall,
    startGroupCall,
    // We don't need call state here as it's handled by PersistentCallScreen
  } = useCall()

  // Cleanup long press timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
      }
    }
  }, [])
  
  // Exit selection mode when pressing Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSelectionMode) {
        exitSelectionMode()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isSelectionMode])
  
  // Selection mode handlers
  const enterSelectionMode = useCallback((callId: string) => {
    setIsSelectionMode(true)
    setSelectedCalls(new Set([callId]))
    // Close context menu if open
    handleCloseContextMenu()
  }, [])
  
  const exitSelectionMode = useCallback(() => {
    setSelectedCalls(new Set())
    setIsSelectionMode(false)
  }, [])
  
  const toggleCallSelection = useCallback((callId: string) => {
    setSelectedCalls(prev => {
      const newSet = new Set(prev)
      if (newSet.has(callId)) {
        newSet.delete(callId)
        // Exit selection mode if no calls selected
        if (newSet.size === 0) {
          setIsSelectionMode(false)
        }
      } else {
        newSet.add(callId)
      }
      return newSet
    })
  }, [])
  
  // Long press handlers for touch devices
  const handleTouchStart = useCallback((callId: string) => {
    longPressTriggeredRef.current = false
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true
      if (isSelectionMode) {
        toggleCallSelection(callId)
      } else {
        enterSelectionMode(callId)
      }
      // Vibrate on mobile if supported (WhatsApp-like feedback)
      if (navigator.vibrate) {
        navigator.vibrate(50)
      }
    }, LONG_PRESS_DURATION)
  }, [isSelectionMode, enterSelectionMode, toggleCallSelection])
  
  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])
  
  const handleTouchMove = useCallback(() => {
    // Cancel long press if user moves finger
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])
  
  // Click handler for calls
  const handleCallClick = useCallback((call: CallLog) => {
    // If long press was triggered, don't open details
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false
      return
    }
    
    if (isSelectionMode) {
      toggleCallSelection(call.id)
    } else {
      setSelectedCall(call)
    }
  }, [isSelectionMode, toggleCallSelection])
  
  // Bulk delete for selected calls
  const handleBulkDelete = async () => {
    const selectedIds = Array.from(selectedCalls)
    const count = selectedIds.length
    
    if (!confirm(`Voulez-vous vraiment supprimer ${count} appel${count > 1 ? 's' : ''} ?`)) {
      return
    }
    
    try {
      // Delete all selected calls
      for (const callId of selectedIds) {
        await supabase
          .from('call_logs')
          .delete()
          .eq('id', callId)
      }
      
      // Refresh the list
      loadCalls()
      exitSelectionMode()
    } catch (error) {
      console.error('Erreur lors de la suppression:', error)
    }
  }

  useEffect(() => {
    if (user) {
      loadCalls()
      loadContacts()
      loadFavorites()
      
      // S'abonner aux nouveaux appels en temps réel
      const channel = supabase
        .channel('call_logs')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'call_logs'
        }, () => {
          console.log('📞 New call log detected, reloading...')
          loadCalls()
        })
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }
  }, [user])

  const loadContacts = async () => {
    if (!user) return

    try {
      // Use cached contacts if available (already set in useState)
      // 1. Load explicit contacts
      const { data: contactsData } = await supabase
        .from('contacts')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_blocked', false)

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

        // Signer les avatars (bucket privé)
        await signFieldsBatch(profiles as any[] | null, ['avatar_url'])

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
                created_at: new Date().toISOString(),
                profile
              }
            }
          })

          const filteredContacts = contactsWithProfiles.filter(c => c.profile)
          setContacts(filteredContacts)
          setCache('calls_contacts', filteredContacts) // Cache for instant display
        } else {
          setContacts([])
          setCache('calls_contacts', [])
        }
      } else {
        setContacts([])
        setCache('calls_contacts', [])
      }
    } catch (err) {
      console.error('Error loading contacts:', err)
      setContacts([])
    }
  }

  const loadFavorites = async () => {
    const saved = localStorage.getItem('anu_call_favorites')
    if (saved) {
      const favIds: string[] = JSON.parse(saved)
      setFavorites(favIds)
      
      // Load group conversation info for favorites that are conversation IDs
      // Group conversation IDs are UUIDs that don't match any contact_user_id
      const groupConvIds: string[] = []
      for (const favId of favIds) {
        // Check if this is a contact or a group conversation
        const isContact = contacts.some(c => c.contact_user_id === favId)
        if (!isContact) {
          groupConvIds.push(favId)
        }
      }
      
      if (groupConvIds.length > 0) {
        const { data: conversations } = await supabase
          .from('conversations')
          .select('id, name, avatar_url, type')
          .in('id', groupConvIds)
          .eq('type', 'group')

        if (conversations) {
          await signFieldsBatch(conversations as any[], ['avatar_url'])
          const groupMap = new Map<string, { name: string; avatar_url: string | null }>()
          conversations.forEach(conv => {
            groupMap.set(conv.id, { name: conv.name || 'Groupe', avatar_url: conv.avatar_url })
          })
          setFavoriteGroups(groupMap)
        }
      }
    }
  }

  const toggleFavorite = async (id: string, isGroupConversation: boolean = false) => {
    const newFavorites = favorites.includes(id)
      ? favorites.filter(fid => fid !== id)
      : [...favorites, id]
    
    setFavorites(newFavorites)
    localStorage.setItem('anu_call_favorites', JSON.stringify(newFavorites))
    
    // If adding a group conversation, load its info
    if (isGroupConversation && !favorites.includes(id)) {
      const { data: conversation } = await supabase
        .from('conversations')
        .select('id, name, avatar_url')
        .eq('id', id)
        .maybeSingle()

      if (conversation) {
        await signFieldsBatch([conversation as any], ['avatar_url'])
        setFavoriteGroups(prev => {
          const newMap = new Map(prev)
          newMap.set(conversation.id, { name: conversation.name || 'Groupe', avatar_url: conversation.avatar_url })
          return newMap
        })
      }
    } else if (isGroupConversation && favorites.includes(id)) {
      // Removing a group from favorites
      setFavoriteGroups(prev => {
        const newMap = new Map(prev)
        newMap.delete(id)
        return newMap
      })
    }
  }

  // Extract call data fetching to helper function
  const fetchCallData = async (userId: string, userConversationIds: string[]) => {
    // Fetch direct calls
    const { data: directCalls, error: directError } = await supabase
      .from('call_logs')
      .select('*')
      .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
      .order('started_at', { ascending: false })
      .limit(100)
    
    // Fetch group calls
    let groupCalls: any[] = []
    if (userConversationIds.length > 0) {
      const { data: conversationCalls, error: groupError } = await supabase
        .from('call_logs')
        .select('*')
        .in('conversation_id', userConversationIds)
        .order('started_at', { ascending: false })
        .limit(200)
      
      if (!groupError && conversationCalls) {
        groupCalls = conversationCalls.filter(call => call.caller_id === call.callee_id)
      }
    }
    
    // Merge calls
    const allCallsMap = new Map<string, any>()
    if (directCalls) {
      directCalls.forEach(call => allCallsMap.set(call.id, call))
    }
    groupCalls.forEach(call => allCallsMap.set(call.id, call))
    
    return {
      calls: Array.from(allCallsMap.values())
        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
        .slice(0, 100),
      error: directError
    }
  }

  // Extract user and conversation ID collection to helper
  const collectUserAndConversationIds = (callsData: any[]) => {
    const userIds = new Set<string>()
    const groupCallConversationIds = new Set<string>()
    
    callsData.forEach(call => {
      userIds.add(call.caller_id)
      if (call.callee_id) {
        userIds.add(call.callee_id)
      }
      if (call.caller_id === call.callee_id) {
        groupCallConversationIds.add(call.conversation_id)
      }
    })
    
    return { userIds, groupCallConversationIds }
  }

  // Extract profile enrichment to helper
  const enrichCallsWithProfiles = async (callsData: any[], userIds: Set<string>, groupCallConversationIds: Set<string>) => {
    // Fetch profiles
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .in('id', Array.from(userIds))

    // Signer les avatars (bucket privé)
    await signFieldsBatch(profiles as any[] | null, ['avatar_url'])

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || [])

    // Fetch conversations
    let conversationMap = new Map<string, { name: string; avatar_url: string | null }>()
    if (groupCallConversationIds.size > 0) {
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id, name, avatar_url')
        .in('id', Array.from(groupCallConversationIds))

      if (conversations) await signFieldsBatch(conversations as any[], ['avatar_url'])
      conversationMap = new Map(conversations?.map(c => [c.id, { name: c.name, avatar_url: c.avatar_url }]) || [])
    }

    // Enrich calls
    return callsData.map(call => {
      const isGroupCall = call.caller_id === call.callee_id
      const conversationInfo = conversationMap.get(call.conversation_id)
      
      return {
        ...call,
        caller_profile: profileMap.get(call.caller_id) || null,
        callee_profile: call.callee_id ? profileMap.get(call.callee_id) : null,
        is_group_call: isGroupCall,
        conversation_name: isGroupCall ? (conversationInfo?.name || 'Groupe') : null,
        conversation_avatar: isGroupCall ? conversationInfo?.avatar_url : null,
      }
    })
  }

  const loadCalls = async () => {
    if (!user) return
    
    const hasCachedCalls = calls.length > 0
    if (!hasCachedCalls) {
      setLoading(true)
    }

    try {
      console.log('📞 Loading calls for user:', user.id)
      
      // Get user conversations
      const { data: memberConversations } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id)
      
      const userConversationIds = memberConversations?.map(m => m.conversation_id) || []
      console.log('📞 User is member of conversations:', userConversationIds.length)
      
      // Fetch calls
      const { calls: callsData, error } = await fetchCallData(user.id, userConversationIds)

      if (error) {
        console.error('Error loading calls:', error)
        setCalls([])
        setLoading(false)
        return
      }

      if (!callsData || callsData.length === 0) {
        setCalls([])
        setLoading(false)
        return
      }

      // Collect IDs
      const { userIds, groupCallConversationIds } = collectUserAndConversationIds(callsData)

      // Enrich with profiles
      const enrichedCalls = await enrichCallsWithProfiles(callsData, userIds, groupCallConversationIds)

      setCalls(enrichedCalls)
      setCache('calls', enrichedCalls)
    } catch (err) {
      console.error('Error loading calls:', err)
      setCalls([])
    } finally {
      setLoading(false)
    }
  }

  // Use module-level formatCallDuration and formatCallDate

  const handleStartCall = () => {
    setShowContactsModal(true)
  }

  const handleAddContact = () => {
    setShowAddContactModal(true)
  }

  const addContact = async () => {
    if (!user || !usernameToAdd) return
    
    setAddContactLoading(true)
    setAddContactError('')

    try {
      // Search for user by username
      const { data: profileData, error: searchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('username', usernameToAdd.trim())
        .maybeSingle()

      if (searchError || !profileData) {
        setAddContactError('Utilisateur introuvable')
        setAddContactLoading(false)
        return
      }

      // Check if already a contact using helper
      const existingContact = await findExistingContact(user.id, profileData.id)
      if (existingContact) {
        setAddContactError('Contact déjà ajouté')
        setAddContactLoading(false)
        return
      }

      // Add the contact
      const insertError = await addNewContact(user.id, profileData.id)
      if (insertError) {
        setAddContactError('Erreur lors de l\'ajout')
        setAddContactLoading(false)
        return
      }

      // Find or create conversation
      const isSelfContact = profileData.id === user.id
      const conversationId = await findOrCreateConversation(user.id, profileData.id, isSelfContact)
      
      // Navigate to the conversation
      if (conversationId) {
        navigate(`/chat/${conversationId}`)
      }

      // Reload contacts and close modal
      await loadContacts()
      setShowAddContactModal(false)
      setUsernameToAdd('')
    } catch {
      setAddContactError('Erreur inattendue')
    } finally {
      setAddContactLoading(false)
    }
  }

  // Helper: Find existing contact
  const findExistingContact = async (userId: string, contactUserId: string) => {
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('contact_user_id', contactUserId)
      .maybeSingle()
    return data
  }

  // Helper: Add new contact to database
  const addNewContact = async (userId: string, contactUserId: string) => {
    const { error } = await supabase
      .from('contacts')
      .insert({
        user_id: userId,
        contact_user_id: contactUserId,
        is_blocked: false,
        is_favorite: false
      })
    return error
  }

  // Helper: Find or create conversation with contact
  const findOrCreateConversation = async (userId: string, contactUserId: string, isSelfContact: boolean): Promise<string | null> => {
    // Check if conversation already exists
    let conversationId: string | null = null
    
    if (isSelfContact) {
      conversationId = await findSavedMessagesConversation(userId)
    } else {
      conversationId = await findDirectConversation(userId, contactUserId)
    }

    // Create new conversation if needed
    if (!conversationId) {
      conversationId = await createConversation(userId, contactUserId, isSelfContact)
    }
    
    return conversationId
  }

  // Helper: Find Saved Messages conversation (self-contact)
  const findSavedMessagesConversation = async (userId: string): Promise<string | null> => {
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
        
        if (members?.length === 1 && members[0]?.user_id === userId) {
          return conv.id
        }
      }
    }
    return null
  }

  // Helper: Find direct conversation with a contact
  const findDirectConversation = async (userId: string, contactUserId: string): Promise<string | null> => {
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
        
        if (conversationData?.type !== 'direct') {
          continue
        }

        const { data: otherMember } = await supabase
          .from('conversation_members')
          .select('*')
          .eq('conversation_id', member.conversation_id)
          .eq('user_id', contactUserId)
          .maybeSingle()

        if (otherMember) {
          return member.conversation_id
        }
      }
    }
    return null
  }

  // Helper: Create new conversation
  const createConversation = async (userId: string, contactUserId: string, isSelfContact: boolean): Promise<string | null> => {
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

    if (!convError && conversation) {
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
      
      return conversation.id
    }
    return null
  }

  const handleCallContact = async (contactId: string, isVideo: boolean = false) => {
    // Récupérer le nom et l'avatar du contact AVANT de démarrer l'appel
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, username, avatar_url')
      .eq('id', contactId)
      .single()
    if (profile) await signFieldsBatch([profile as any], ['avatar_url'])

    // Trouver ou créer une conversation avec ce contact
    const { data: existingMembers } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', user!.id)

    let conversationId: string | null = null

    if (existingMembers) {
      for (const member of existingMembers) {
        const { data: otherMember } = await supabase
          .from('conversation_members')
          .select('*')
          .eq('conversation_id', member.conversation_id)
          .eq('user_id', contactId)
          .maybeSingle()

        if (otherMember) {
          conversationId = member.conversation_id
          break
        }
      }
    }

    // Créer nouvelle conversation si nécessaire
    if (!conversationId) {
      const { data: conversation } = await supabase
        .from('conversations')
        .insert({
          type: 'direct',
          created_by: user!.id,
          is_encrypted: true,
          last_message_at: new Date().toISOString(),
        })
        .select()
        .maybeSingle()

      if (conversation) {
        await supabase
          .from('conversation_members')
          .insert([
            { conversation_id: conversation.id, user_id: user!.id, role: 'admin', is_active: true },
            { conversation_id: conversation.id, user_id: contactId, role: 'member', is_active: true }
          ])
        
        conversationId = conversation.id
      }
    }

    // Démarrer l'appel
    if (conversationId) {
      try {
        console.log('🔍 DEBUG: Starting call from handleCallContact')
        console.log('  - contactId:', contactId)
        console.log('  - conversationId:', conversationId)
        console.log('  - isVideo:', isVideo)
        console.log('  - callerName:', profile?.display_name || profile?.username)
        await startCall(contactId, conversationId, { audio: true, video: isVideo })
        console.log('🔍 DEBUG: Call started successfully')
        console.log('  - Hook states should now be updated (isInCall/isCalling)')
        setShowContactsModal(false)
      } catch (error) {
        console.error('Erreur lors du démarrage de l\'appel:', error)
        alert('Impossible de démarrer l\'appel')
      }
    }
  }

  const handleRecall = async () => {
    if (!selectedCall) return
    
    // Récupérer l'autre utilisateur de la conversation
    const { data: members } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', selectedCall.conversation_id)
      .neq('user_id', user!.id)
    
    if (members && members.length > 0) {
      const otherUserId = members[0].user_id
      
      // Récupérer le nom et l'avatar du contact
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, username, avatar_url')
        .eq('id', otherUserId)
        .single()
      if (profile) await signFieldsBatch([profile as any], ['avatar_url'])

      console.log('🔍 DEBUG: Recall button clicked')
      console.log('  - conversationId:', selectedCall.conversation_id)
      console.log('  - callType:', selectedCall.type)
      console.log('  - otherUserId:', otherUserId)
      console.log('  - callerName:', profile?.display_name || profile?.username)
      try {
        // Démarrer l'appel avec le même type (audio/vidéo) que l'appel précédent
        await startCall(otherUserId, selectedCall.conversation_id, {
          audio: true,
          video: selectedCall.type === 'video'
        })
        console.log('🔍 DEBUG: Recall initiated successfully')
        setSelectedCall(null)
      } catch (error) {
        console.error('Erreur lors du rappel:', error)
        alert('Impossible de démarrer l\'appel')
      }
    }
  }

  const handleCallContextMenu = (e: React.MouseEvent, call: CallLog) => {
    e.preventDefault()
    // If in selection mode, toggle selection instead of showing context menu
    if (isSelectionMode) {
      toggleCallSelection(call.id)
      return
    }
    setContextMenuCall(call)
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
  }

  const handleCloseContextMenu = () => {
    setContextMenuCall(null)
    setContextMenuPosition(null)
  }

  const handleDeleteCall = async (callId: string) => {
    try {
      await supabase
        .from('call_logs')
        .delete()
        .eq('id', callId)
      
      // Rafraîchir la liste
      loadCalls()
      handleCloseContextMenu()
    } catch (error) {
      console.error('Erreur lors de la suppression:', error)
    }
  }

  const handleCallFromContextMenu = async (isVideo: boolean) => {
    if (!contextMenuCall) return
    
    // Récupérer l'autre utilisateur de la conversation
    const { data: members } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', contextMenuCall.conversation_id)
      .neq('user_id', user!.id)
    
    if (members && members.length > 0) {
      const otherUserId = members[0].user_id
      
      // Récupérer le nom et l'avatar du contact
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, username, avatar_url')
        .eq('id', otherUserId)
        .single()

      if (!profile) {
        console.error('Profile not found for user:', otherUserId)
        return
      }
      await signFieldsBatch([profile as any], ['avatar_url'])

      try {
        await startCall(otherUserId, contextMenuCall.conversation_id, {
          audio: true,
          video: isVideo
        })
        handleCloseContextMenu()
      } catch (error) {
        console.error('Erreur lors de l\'appel:', error)
        alert('Impossible de démarrer l\'appel')
      }
    }
  }

  const handleCreateCallLink = () => {
    const randomBytes = new Uint8Array(8);
    crypto.getRandomValues(randomBytes);
    const randomString = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('').substring(0, 8);
    const callLink = `${globalThis.location.origin}/call/${randomString}`
    navigator.clipboard.writeText(callLink)
    alert(`Lien d'appel copié !\n${callLink}`)
  }

  // Helper to filter calls
  const filterCalls = (allCalls: CallLog[], query: string, currentUserId: string | undefined) => {
    if (!query.trim()) return allCalls
    
    // For group calls, search by conversation name
    const lowerQuery = query.toLowerCase()
    
    return allCalls.filter(call => {
      if (call.is_group_call) {
        const groupName = call.conversation_name || 'Groupe'
        return groupName.toLowerCase().includes(lowerQuery)
      }
      
      // For direct calls, search by user name
      const otherProfile = call.caller_id === currentUserId ? call.callee_profile : call.caller_profile
      const name = otherProfile?.display_name || otherProfile?.username || ''
      return name.toLowerCase().includes(lowerQuery)
    })
  }

  const filteredCalls = filterCalls(calls, searchQuery, user?.id)


  // Helper functions for call display - used by CallDetailsContent component
  // Note: isFavorite, getCallDisplayName, getCallAvatarUrl, getCallStatusText,
  // getCallTypeText, renderCallStatus, renderCallAvatar, handleFavoriteClick
  // are passed to CallDetailsContent component as props

  // Helper: Handle call back action
  const handleCallBack = async (call: CallLog) => {
    if (call.is_group_call) {
      try {
        await startGroupCall(call.conversation_id, {
          audio: true,
          video: call.type === 'video'
        })
        setSelectedCall(null)
      } catch (error) {
        console.error('Erreur lors du rappel de groupe:', error)
        alert('Impossible de démarrer l\'appel de groupe')
      }
    } else {
      handleRecall()
    }
  }

  // Helper functions for CallDetailsContent that need to be passed as props
  const getCallDisplayName = (call: CallLog, userId: string | undefined): string => {
    if (call.is_group_call) {
      return call.conversation_name || 'Groupe'
    }
    const isOutgoing = call.caller_id === userId
    const otherProfile = isOutgoing ? call.callee_profile : call.caller_profile
    return otherProfile?.display_name || otherProfile?.username || 'Utilisateur'
  }

  const getCallAvatarUrl = (call: CallLog, userId: string | undefined): string | null | undefined => {
    if (call.is_group_call) {
      return call.conversation_avatar
    }
    const isOutgoing = call.caller_id === userId
    const otherProfile = isOutgoing ? call.callee_profile : call.caller_profile
    return otherProfile?.avatar_url
  }

  // Consolidated helper for call status text - handles both group and direct calls
  const getCallStatusText = (call: CallLog, userId: string | undefined): string => {
    if (call.is_group_call) {
      return 'Appel de groupe';
    }
    const isOutgoing = call.caller_id === userId;
    return isOutgoing ? 'Appel sortant' : 'Appel entrant';
  }

  // Consolidated helper for call type text
  const getCallTypeText = (call: CallLog): string => {
    if (call.is_group_call) {
      return call.type === 'video' ? 'Appel vidéo de groupe' : 'Appel de groupe'
    }
    return call.type === 'video' ? 'Appel vidéo' : 'Appel vocal'
  }

  // Consolidated helper for rendering call status
  const renderCallStatus = (call: CallLog): string => {
    switch (call.status) {
      case 'answered': return 'Répondu'
      case 'missed': return 'Manqué'
      case 'rejected': return 'Refusé'
      case 'ended': return 'Terminé'
      default: return 'Initié'
    }
  }

  // Consolidated helper for rendering call avatar
  // Note : on passe par <MediaImg> pour que les paths du bucket privé soient
  // (re-)signés à la demande, même si l'URL signée d'origine a expiré entre
  // le chargement de la liste et l'ouverture du panneau de détails.
  const renderCallAvatar = (avatarUrl: string | null | undefined, isGroupCall: boolean, displayName: string) => {
    const fallback = isGroupCall ? (
      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-accent to-primary-600 flex items-center justify-center text-white">
        <Users size={36} />
      </div>
    ) : (
      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-2xl">
        {displayName[0]?.toUpperCase()}
      </div>
    )

    if (!avatarUrl) return fallback

    return (
      <MediaImg
        src={avatarUrl}
        alt={displayName}
        className="w-20 h-20 rounded-full object-cover"
        fallback={fallback}
      />
    )
  }

  // Helper: Get favorite ID for a call
  const getFavoriteId = (call: CallLog, userId: string | undefined): string | undefined => {
    if (call.is_group_call) {
      return call.conversation_id;
    }
    const isOutgoing = call.caller_id === userId;
    return isOutgoing ? call.callee_profile?.id : call.caller_profile?.id;
  }

  // Helper: Check if call is favorite
  const isCallFavorite = (call: CallLog, userId: string | undefined, favs: string[]): boolean => {
    const favId = getFavoriteId(call, userId);
    return favId ? favs.includes(favId) : false;
  }

  // Helper: Handle favorite toggle for a call
  const handleCallFavoriteToggle = (call: CallLog, userId: string | undefined) => {
    if (call.is_group_call) {
      toggleFavorite(call.conversation_id, true);
    } else {
      const isOut = call.caller_id === userId;
      const otherProfile = isOut ? call.callee_profile : call.caller_profile;
      if (otherProfile) {
        toggleFavorite(otherProfile.id, false);
      }
    }
  }

  // Select all calls (must be after filteredCalls is defined)
  const selectAllCalls = useCallback(() => {
    const allCallIds = new Set(filteredCalls.map(call => call.id))
    setSelectedCalls(allCallIds)
  }, [filteredCalls])
  
  // Check if all calls are selected
  const allCallsSelected = filteredCalls.length > 0 && selectedCalls.size === filteredCalls.length

  return (
    <MainLayout>
      {/* Selection Mode Top Bar - WhatsApp style */}
      {isSelectionMode && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-bg-surface border-b border-bg-hover shadow-lg animate-in slide-in-from-top duration-200">
          <div className="flex items-center justify-between h-14 px-2">
            {/* Left side: Back arrow + count */}
            <div className="flex items-center gap-3">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  exitSelectionMode()
                }}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
              >
                <ArrowLeft size={24} className="text-text-primary" />
              </button>
              <span className="text-lg font-medium text-text-primary">
                {selectedCalls.size}
              </span>
            </div>
            
            {/* Right side: Select All + Delete icons */}
            <div className="flex items-center gap-1">
              {/* Select All */}
              <button
                onClick={selectAllCalls}
                className={`w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors ${
                  allCallsSelected ? 'text-accent' : 'text-text-primary'
                }`}
                title={allCallsSelected ? 'Tout sélectionné' : 'Tout sélectionner'}
              >
                <CheckCheck size={20} />
              </button>
              
              {/* Delete */}
              <button
                onClick={handleBulkDelete}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
                title="Supprimer"
              >
                <Trash2 size={20} className="text-red-500" />
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Liste des appels - Style JemaOS */}
      <div className={`w-full md:w-[420px] bg-bg-secondary flex flex-col md:border-r border-bg-hover pb-14 md:pb-0 ${isSelectionMode ? 'pt-14' : ''}`}>
        {/* Header - Hidden in selection mode */}
        {!isSelectionMode && (
        <div className="bg-bg-surface px-4 py-3">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-semibold text-text-primary">Appels</h1>
            <button
              onClick={handleAddContact}
              className="w-10 h-10 rounded-full bg-accent hover:bg-[#5a5ec9] flex items-center justify-center transition-colors"
              title="Ajouter un contact"
              aria-label="Ajouter un contact"
            >
              <UserPlus size={20} className="text-white" />
            </button>
          </div>
          
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              placeholder="Rechercher ou démarrer un appel"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-10 pr-3 bg-bg-surface text-text-primary text-sm rounded-xl border-none outline-none placeholder:text-text-secondary focus:bg-bg-hover"
              aria-label="Rechercher ou démarrer un appel"
            />
          </div>
        </div>
        )}

        {/* Favoris Section - Hidden in selection mode */}
        {!isSelectionMode && (
        <div className="px-4 py-3 bg-bg-secondary">
          <p className="text-xs text-text-secondary uppercase tracking-wide mb-2">Favoris</p>
          <button
            onClick={() => setShowFavoritesModal(true)}
            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-bg-surface transition-colors rounded-lg"
          >
            <div className="w-12 h-12 rounded-full bg-bg-surface flex items-center justify-center">
              <Star size={20} className="text-text-secondary" />
            </div>
            <span className="text-text-primary">Ajouter aux favoris</span>
          </button>
          {favorites.length > 0 && (
            <div className="space-y-1">
              {favorites.map(favId => {
                // Check if it's a contact
                const contact = contacts.find(c => c.contact_user_id === favId)
                
                // Check if it's a group conversation
                const groupInfo = favoriteGroups.get(favId)
                
                if (contact) {
                  // Render contact favorite
                  return (
                    <button
                      type="button"
                      key={favId}
                      className="w-full px-4 py-3 flex items-center gap-3 hover:bg-bg-surface transition-colors rounded-lg cursor-pointer text-left"
                      onClick={() => handleCallContact(favId)}
                    >
                      <MediaImg
                        src={contact.profile.avatar_url}
                        alt={contact.profile.display_name || contact.profile.username}
                        className="w-12 h-12 rounded-full object-cover"
                        fallback={
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold">
                            {contact.profile.username[0].toUpperCase()}
                          </div>
                        }
                      />
                      <div className="flex-1">
                        <span className="text-text-primary">{contact.profile.display_name || contact.profile.username}</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleFavorite(favId, false)
                        }}
                        className="w-8 h-8 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors"
                      >
                        <Star size={16} className="text-accent fill-[#6b6fdb]" />
                      </button>
                    </button>
                  )
                } else if (groupInfo) {
                  // Render group conversation favorite
                  return (
                    <button
                      type="button"
                      key={favId}
                      className="w-full px-4 py-3 flex items-center gap-3 hover:bg-bg-surface transition-colors rounded-lg cursor-pointer text-left"
                      onClick={async () => {
                        // Start group call
                        try {
                          await startGroupCall(favId, { audio: true, video: false })
                        } catch (error) {
                          console.error('Erreur lors de l\'appel de groupe:', error)
                          alert('Impossible de démarrer l\'appel de groupe')
                        }
                      }}
                    >
                      <MediaImg
                        src={groupInfo.avatar_url}
                        alt={groupInfo.name}
                        className="w-12 h-12 rounded-full object-cover"
                        fallback={
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent to-primary-600 flex items-center justify-center text-white">
                            <Users size={24} />
                          </div>
                        }
                      />

                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Users size={14} className="text-text-secondary" />
                          <span className="text-text-primary">{groupInfo.name}</span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleFavorite(favId, true)
                        }}
                        className="w-8 h-8 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors"
                      >
                        <Star size={16} className="text-accent fill-[#6b6fdb]" />
                      </button>
                    </button>
                  )
                }
                
                return null
              })}
            </div>
          )}
        </div>
        )}

        {/* Separator - Hidden in selection mode */}
        {!isSelectionMode && (
        <div className="px-4 py-2 bg-bg-secondary">
          <p className="text-xs text-text-secondary uppercase tracking-wide">Récents</p>
        </div>
        )}

        {/* Calls List */}
        <div className="flex-1 overflow-y-auto pb-2">
          {(() => {
            if (loading) {
              return (
                <div className="flex justify-center items-center h-full">
                  <div className="w-8 h-8 rounded-full border-4 border-accent border-t-transparent animate-spin" />
                </div>
              )
            }
            if (filteredCalls.length === 0) {
              return (
                <div className="flex flex-col items-center justify-center h-full text-center px-8">
                  <Phone size={64} className="text-[#3b4a54] mb-4" />
                  <h3 className="text-lg font-medium text-text-secondary mb-2">Aucun appel</h3>
                  <p className="text-sm text-text-secondary">Votre historique d'appels apparaîtra ici</p>
                </div>
              )
            }
            return (
            filteredCalls.map((call) => {
              const isSelected = selectedCalls.has(call.id)
              
              return (
                <CallItem
                  key={call.id}
                  call={call}
                  user={user}
                  isSelected={isSelected}
                  selectedCall={selectedCall}
                  isSelectionMode={isSelectionMode}
                  onClick={() => handleCallClick(call)}
                  onContextMenu={(e) => handleCallContextMenu(e, call)}
                  onTouchStart={() => handleTouchStart(call.id)}
                  onTouchEnd={handleTouchEnd}
                  onTouchMove={handleTouchMove}
                  isMobile={isMobile}
                />
              )
            })
            )
          })()}
        </div>
      </div>

      {/* Mobile Call Info Modal */}
      {selectedCall && (
        <div className="md:hidden fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-md bg-bg-surface rounded-3xl flex flex-col max-h-[90vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-bg-hover flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-semibold text-text-primary">Infos de l'appel</h2>
              <button
                onClick={() => setSelectedCall(null)}
                className="w-8 h-8 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-text-secondary"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <CallDetailsContent
                call={selectedCall}
                userId={user?.id}
                favorites={favorites}
                navigate={navigate}
                setSelectedCall={setSelectedCall}
                handleCallBack={handleCallBack}
                formatCallDuration={formatCallDuration}
                getCallDisplayName={getCallDisplayName}
                getCallAvatarUrl={getCallAvatarUrl}
                getCallStatusText={getCallStatusText}
                getCallTypeText={getCallTypeText}
                renderCallStatus={renderCallStatus}
                renderCallAvatar={renderCallAvatar}
                isCallFavorite={isCallFavorite}
                handleCallFavoriteToggle={handleCallFavoriteToggle}
              />
            </div>
          </div>
        </div>
      )}

      {/* Zone d'info ou d'action - Desktop only */}
      <div className="hidden md:flex flex-1 bg-bg-primary flex-col p-8">
        {selectedCall ? (
          // Panneau d'informations de l'appel
          <div className="max-w-md mx-auto w-full">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-medium text-text-primary">Infos de l'appel</h2>
              <button
                onClick={() => setSelectedCall(null)}
                className="w-8 h-8 rounded-full hover:bg-bg-surface flex items-center justify-center transition-colors text-text-secondary"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <CallDetailsContent
                call={selectedCall}
                userId={user?.id}
                favorites={favorites}
                navigate={navigate}
                setSelectedCall={setSelectedCall}
                handleCallBack={handleCallBack}
                formatCallDuration={formatCallDuration}
                getCallDisplayName={getCallDisplayName}
                getCallAvatarUrl={getCallAvatarUrl}
                getCallStatusText={getCallStatusText}
                getCallTypeText={getCallTypeText}
                renderCallStatus={renderCallStatus}
                renderCallAvatar={renderCallAvatar}
                isCallFavorite={isCallFavorite}
                handleCallFavoriteToggle={handleCallFavoriteToggle}
              />
            </div>
          </div>
        ) : (
          // Zone d'action par défaut
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-8 max-w-md">
              <h2 className="text-2xl font-light text-text-secondary mb-6">Démarrer un appel</h2>
              
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={handleStartCall}
                  className="flex flex-col items-center gap-3 p-6 bg-bg-surface rounded-2xl hover:bg-bg-hover transition-colors"
                >
                  <div className="w-16 h-16 rounded-full bg-accent flex items-center justify-center">
                    <Video size={28} className="text-white" />
                  </div>
                  <span className="text-sm text-text-primary">Démarrer un appel</span>
                </button>
                
                <button
                  onClick={handleCreateCallLink}
                  className="flex flex-col items-center gap-3 p-6 bg-bg-surface rounded-2xl hover:bg-bg-hover transition-colors"
                >
                  <div className="w-16 h-16 rounded-full bg-bg-surface flex items-center justify-center border-2 border-accent">
                    <Link2 size={28} className="text-accent" />
                  </div>
                  <span className="text-sm text-text-primary">Nouveau lien d'appel</span>
                </button>
              </div>

          <div className="mt-8 flex items-center justify-center gap-2 text-text-secondary text-sm">
            <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
              <path d="M13 7h-1V5c0-2.21-1.79-4-4-4S4 2.79 4 5v2H3c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm-5 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H4.9V5c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
            <span>Appels chiffrés de bout en bout</span>
          </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal de sélection de contact */}
      {showContactsModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-md bg-bg-surface rounded-3xl flex flex-col max-h-[80vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-bg-hover flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-semibold text-text-primary">Appeler un contact</h2>
              <button
                onClick={() => setShowContactsModal(false)}
                className="w-8 h-8 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-text-secondary"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              {contacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                  <Phone size={48} className="text-[#3b4a54] mb-3" />
                  <p className="text-text-secondary mb-4">Aucun contact disponible</p>
                  <button
                    onClick={() => {
                      setShowContactsModal(false)
                      navigate('/contacts')
                    }}
                    className="px-6 py-2 rounded-2xl bg-accent hover:bg-[#5a5ec9] text-white font-medium transition-colors"
                  >
                    Ajouter des contacts
                  </button>
                </div>
              ) : (
                contacts.map((contact) => (
                  <button
                    type="button"
                    key={contact.id}
                    className="w-full px-6 py-3 cursor-pointer hover:bg-bg-hover transition-colors text-left"
                    onClick={() => handleCallContact(contact.contact_user_id)}
                  >
                    <div className="flex items-center gap-3">
                      <MediaImg
                        src={contact.profile.avatar_url}
                        alt={contact.profile.display_name || contact.profile.username}
                        className="w-12 h-12 rounded-full object-cover"
                        fallback={
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold">
                            {contact.profile.username[0].toUpperCase()}
                          </div>
                        }
                      />

                      <div className="flex-1 min-w-0">
                        <h3 className="text-text-primary font-normal truncate">
                          {contact.profile.display_name || contact.profile.username}
                        </h3>
                        <p className="text-sm text-text-secondary truncate">
                          @{contact.profile.username}
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCallContact(contact.contact_user_id, false)
                          }}
                          className="w-10 h-10 rounded-full hover:bg-bg-surface flex items-center justify-center transition-colors"
                        >
                          <Phone size={20} className="text-accent" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCallContact(contact.contact_user_id, true)
                          }}
                          className="w-10 h-10 rounded-full hover:bg-bg-surface flex items-center justify-center transition-colors"
                        >
                          <Video size={20} className="text-accent" />
                        </button>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal d'ajout aux favoris */}
      {showFavoritesModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-md bg-bg-surface rounded-3xl flex flex-col max-h-[80vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-bg-hover flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-semibold text-text-primary">Ajouter aux favoris</h2>
              <button
                onClick={() => setShowFavoritesModal(false)}
                className="w-8 h-8 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-text-secondary"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              {contacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                  <Star size={48} className="text-[#3b4a54] mb-3" />
                  <p className="text-text-secondary mb-4">Aucun contact disponible</p>
                  <button
                    onClick={() => {
                      setShowFavoritesModal(false)
                      navigate('/contacts')
                    }}
                    className="px-6 py-2 rounded-2xl bg-accent hover:bg-[#5a5ec9] text-white font-medium transition-colors"
                  >
                    Ajouter des contacts
                  </button>
                </div>
              ) : (
                contacts.map((contact) => {
                  const isFavorite = favorites.includes(contact.contact_user_id)
                  return (
                    <button
                      type="button"
                      key={contact.id}
                      className="w-full px-6 py-3 cursor-pointer hover:bg-bg-hover transition-colors text-left"
                      onClick={() => {
                        toggleFavorite(contact.contact_user_id, false)
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <MediaImg
                          src={contact.profile.avatar_url}
                          alt={contact.profile.display_name || contact.profile.username}
                          className="w-12 h-12 rounded-full object-cover"
                          fallback={
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold">
                              {contact.profile.username[0].toUpperCase()}
                            </div>
                          }
                        />
                        
                        <div className="flex-1 min-w-0">
                          <h3 className="text-text-primary font-normal truncate">
                            {contact.profile.display_name || contact.profile.username}
                          </h3>
                          <p className="text-sm text-text-secondary truncate">
                            @{contact.profile.username}
                          </p>
                        </div>

                        <div className="flex items-center">
                          <Star
                            size={24}
                            className={isFavorite ? 'fill-[#6b6fdb] text-accent' : 'text-text-secondary'}
                          />
                        </div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>

            <div className="px-6 py-4 border-t border-bg-hover">
              <button
                onClick={() => setShowFavoritesModal(false)}
                className="w-full py-3 rounded-xl bg-accent hover:bg-[#5a5ec9] text-white font-medium transition-colors"
              >
                Terminé
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal d'ajout de contact */}
      {showAddContactModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-md bg-bg-surface rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-text-primary">Ajouter un contact</h2>
              <button
                onClick={() => {
                  setShowAddContactModal(false)
                  setUsernameToAdd('')
                  setAddContactError('')
                }}
                className="w-8 h-8 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-text-secondary"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2">
              <label htmlFor="add-contact-username" className="text-sm text-[#787add]">Nom d'utilisateur (pseudo)</label>
              <div className="relative">
                <UserPlus size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  id="add-contact-username"
                  type="text"
                  placeholder="pseudo_utilisateur"
                  value={usernameToAdd}
                  onChange={(e) => {
                    setUsernameToAdd(e.target.value)
                    setAddContactError('')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && usernameToAdd.trim()) {
                      addContact()
                    }
                  }}
                  className="w-full h-11 pl-10 pr-3 bg-bg-hover text-text-primary text-sm rounded-xl border-none outline-none placeholder:text-text-secondary"
                  autoFocus
                />
              </div>
              {addContactError && <p className="text-sm text-[#ea4335]">{addContactError}</p>}
            </div>

            <p className="text-xs text-text-secondary">
              Entrez le pseudo de l'utilisateur que vous souhaitez ajouter à vos contacts.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowAddContactModal(false)
                  setUsernameToAdd('')
                  setAddContactError('')
                }}
                className="flex-1 py-2 rounded-xl bg-bg-hover hover:bg-[#3b4a54] text-white transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={addContact}
                disabled={!usernameToAdd.trim() || addContactLoading}
                className="flex-1 py-2 rounded-xl bg-accent hover:bg-[#5a5ec9] text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {addContactLoading ? (
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

      {/* Menu contextuel pour les appels - Only show when not in selection mode */}
      {contextMenuCall && contextMenuPosition && !isSelectionMode && (
        <>
          {/* Overlay pour fermer le menu */}
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default w-full h-full bg-transparent border-none"
            onClick={handleCloseContextMenu}
            aria-label="Fermer le menu"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                handleCloseContextMenu()
              }
            }}
          />
          
          {/* Menu contextuel */}
          <div
            ref={contextMenuRef}
            className="fixed z-50 bg-bg-hover rounded-lg shadow-xl py-2 min-w-[200px] transition-opacity duration-100"
            style={{
              left: `${adjustedContextMenuPosition?.x ?? contextMenuPosition.x}px`,
              top: `${adjustedContextMenuPosition?.y ?? contextMenuPosition.y}px`,
              opacity: adjustedContextMenuPosition ? 1 : 0
            }}
          >
            {/* Option Sélectionner */}
            <button
              onClick={() => {
                enterSelectionMode(contextMenuCall.id)
              }}
              className="w-full px-4 py-3 text-left hover:bg-bg-surface flex items-center gap-3 text-text-primary transition-colors"
            >
              <Check size={20} />
              <span>Sélectionner</span>
            </button>
            
            {/* Séparateur */}
            <div className="h-px bg-bg-surface my-1" />
            
            {/* Option Effacer */}
            <button
              onClick={() => handleDeleteCall(contextMenuCall.id)}
              className="w-full px-4 py-3 text-left hover:bg-bg-surface flex items-center gap-3 text-text-primary transition-colors"
            >
              <Trash2 size={20} />
              <span>Effacer</span>
            </button>
            
            {/* Séparateur */}
            <div className="h-px bg-bg-surface my-1" />
            
            {/* Option Appel vocal */}
            <button
              onClick={() => handleCallFromContextMenu(false)}
              className="w-full px-4 py-3 text-left hover:bg-bg-surface flex items-center gap-3 text-text-primary transition-colors"
            >
              <Phone size={20} />
              <span>Appel vocal</span>
            </button>
            
            {/* Option Appel vidéo */}
            <button
              onClick={() => handleCallFromContextMenu(true)}
              className="w-full px-4 py-3 text-left hover:bg-bg-surface flex items-center gap-3 text-text-primary transition-colors"
            >
              <Video size={20} />
              <span>Appel vidéo</span>
            </button>
          </div>
        </>
      )}
    </MainLayout>
  )
}
