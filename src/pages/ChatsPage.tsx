import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/MainLayout'
import { ConversationContextMenu } from '@/components/ConversationContextMenu'
import { supabase, Conversation, Profile, Message } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { offlineStorage } from '@/lib/offlineStorage'
import { useIsMobile } from '@/hooks/use-mobile'
import { MessageCircle, Search, Plus, MoreVertical, Check, UserPlus, Users, Pin, BellOff, ArrowLeft, Trash2, Archive, VolumeX, Volume2 } from 'lucide-react'

// Memoized formatDate function outside component to prevent recreation on every render
const formatDate = (dateStr: string): string => {
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

// Skeleton loader component for conversation items
const ConversationSkeleton = () => (
  <div className="space-y-4 p-4">
    {[1, 2, 3, 4, 5].map((i) => (
      <div key={i} className="flex items-center gap-3 animate-pulse">
        <div className="w-12 h-12 rounded-full bg-bg-surface" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-bg-surface rounded w-1/3" />
          <div className="h-3 bg-bg-surface rounded w-2/3" />
        </div>
      </div>
    ))}
  </div>
)

interface ConversationWithDetails extends Omit<Conversation, 'is_pinned'> {
  otherUserProfile?: Profile
  lastMessage?: Message
  unreadCount?: number
  is_pinned?: boolean
  is_muted?: boolean
}

export function ChatsPage() {
  // Initialize from memory cache synchronously (instant, no flicker)
  const [conversations, setConversations] = useState<ConversationWithDetails[]>(() => {
    const cached = offlineStorage.getConversationsSync()
    if (cached && cached.length > 0) {
      console.log('[ChatsPage] Initialized from memory cache:', cached.length)
      return cached
    }
    return []
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; conversationId: string; onSelect?: () => void } | null>(null)
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [activeFilter, setActiveFilter] = useState<'all' | 'unread' | 'groups'>('all')
  
  // Selection mode state (WhatsApp-style)
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedConversations, setSelectedConversations] = useState<Set<string>>(new Set())
  
  // Long press detection refs
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const longPressTriggeredRef = useRef(false)
  // Don't show loading if we have cached data
  const [isLoading, setIsLoading] = useState(() => {
    const cached = offlineStorage.getConversationsSync()
    return !cached || cached.length === 0
  })
  const [hasLoadedFromCache, setHasLoadedFromCache] = useState(() => {
    const cached = offlineStorage.getConversationsSync()
    return cached !== null && cached.length > 0
  })
  const { user } = useAuth()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  
  // Ref for debouncing real-time subscription reloads
  const reloadTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Ref to track if initial load is complete
  const initialLoadComplete = useRef(false)
  
  // Long press duration (ms) - WhatsApp uses ~500ms
  const LONG_PRESS_DURATION = 500
  
  // Debounced reload function to prevent excessive reloads from real-time subscriptions
  const debouncedReload = useCallback(() => {
    if (reloadTimeoutRef.current) {
      clearTimeout(reloadTimeoutRef.current)
    }
    reloadTimeoutRef.current = setTimeout(() => {
      loadConversationsFromServer(false) // Background sync, no loading state
    }, 500) // 500ms debounce
  }, [])
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current)
      }
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
  const enterSelectionMode = useCallback((conversationId: string) => {
    setIsSelectionMode(true)
    setSelectedConversations(new Set([conversationId]))
  }, [])
  
  const exitSelectionMode = useCallback(() => {
    console.log('[ChatsPage] exitSelectionMode called - resetting selection state')
    // Reset both states synchronously to avoid intermediate states
    setIsSelectionMode(false)
    setSelectedConversations(new Set())
  }, [])
  
  const toggleConversationSelection = useCallback((conversationId: string) => {
    setSelectedConversations(prev => {
      const newSet = new Set(prev)
      if (newSet.has(conversationId)) {
        newSet.delete(conversationId)
        // Exit selection mode if no conversations selected
        if (newSet.size === 0) {
          setIsSelectionMode(false)
        }
      } else {
        newSet.add(conversationId)
      }
      return newSet
    })
  }, [])
  
  // Long press handlers for touch devices
  const handleTouchStart = useCallback((conversationId: string) => {
    longPressTriggeredRef.current = false
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true
      if (!isSelectionMode) {
        enterSelectionMode(conversationId)
      } else {
        toggleConversationSelection(conversationId)
      }
      // Vibrate on mobile if supported (WhatsApp-like feedback)
      if (navigator.vibrate) {
        navigator.vibrate(50)
      }
    }, LONG_PRESS_DURATION)
  }, [isSelectionMode, enterSelectionMode, toggleConversationSelection])
  
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
  
  // Click handler for conversations
  const handleConversationClick = useCallback((conversationId: string) => {
    // If long press was triggered, don't navigate
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false
      return
    }
    
    if (isSelectionMode) {
      toggleConversationSelection(conversationId)
    } else {
      navigate(`/chat/${conversationId}`)
    }
  }, [isSelectionMode, toggleConversationSelection, navigate])
  
  // Bulk actions for selected conversations
  const handleBulkPin = async () => {
    const selectedIds = Array.from(selectedConversations)
    // Check if any selected conversation is not pinned
    const anyUnpinned = selectedIds.some(id => {
      const conv = conversations.find(c => c.id === id)
      return conv && !conv.is_pinned
    })
    
    // If any is unpinned, pin all. Otherwise, unpin all.
    const newPinnedState = anyUnpinned
    
    // Optimistic update
    setConversations(prev => {
      const updated = prev.map(c =>
        selectedConversations.has(c.id) ? { ...c, is_pinned: newPinnedState } : c
      )
      return updated.sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1
        if (!a.is_pinned && b.is_pinned) return 1
        return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
      })
    })
    
    // Update database
    for (const conversationId of selectedIds) {
      await supabase
        .from('conversation_members')
        .update({ is_pinned: newPinnedState })
        .eq('conversation_id', conversationId)
        .eq('user_id', user!.id)
    }
    
    exitSelectionMode()
  }
  
  const handleBulkMute = async () => {
    const selectedIds = Array.from(selectedConversations)
    // Check if any selected conversation is not muted
    const anyUnmuted = selectedIds.some(id => {
      const conv = conversations.find(c => c.id === id)
      return conv && !conv.is_muted
    })
    
    // If any is unmuted, mute all. Otherwise, unmute all.
    const newMutedState = anyUnmuted
    
    // Optimistic update
    setConversations(prev => prev.map(c =>
      selectedConversations.has(c.id) ? { ...c, is_muted: newMutedState } : c
    ))
    
    // Update database
    for (const conversationId of selectedIds) {
      await supabase
        .from('conversation_members')
        .update({ is_muted: newMutedState })
        .eq('conversation_id', conversationId)
        .eq('user_id', user!.id)
    }
    
    exitSelectionMode()
  }
  
  const handleBulkArchive = async () => {
    const selectedIds = Array.from(selectedConversations)
    
    // Optimistic update - remove from list
    const archivedConvs = conversations.filter(c => selectedConversations.has(c.id))
    setConversations(prev => prev.filter(c => !selectedConversations.has(c.id)))
    
    // Update database
    let hasError = false
    for (const conversationId of selectedIds) {
      const { error } = await supabase
        .from('conversation_members')
        .update({ is_archived: true })
        .eq('conversation_id', conversationId)
        .eq('user_id', user!.id)
      
      if (error) hasError = true
    }
    
    // Revert on error
    if (hasError) {
      setConversations(prev => {
        const updated = [...prev, ...archivedConvs]
        return updated.sort((a, b) => {
          if (a.is_pinned && !b.is_pinned) return -1
          if (!a.is_pinned && b.is_pinned) return 1
          return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
        })
      })
    }
    
    exitSelectionMode()
  }
  
  const handleBulkDelete = async () => {
    const selectedIds = Array.from(selectedConversations)
    const count = selectedIds.length
    
    if (!confirm(`Voulez-vous vraiment supprimer ${count} conversation${count > 1 ? 's' : ''} ?`)) {
      return
    }
    
    // Optimistic update - remove from list
    const deletedConvs = conversations.filter(c => selectedConversations.has(c.id))
    setConversations(prev => prev.filter(c => !selectedConversations.has(c.id)))
    
    // Update database
    let hasError = false
    for (const conversationId of selectedIds) {
      const { error } = await supabase
        .from('conversation_members')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('user_id', user!.id)
      
      if (error) hasError = true
    }
    
    // Revert on error
    if (hasError) {
      setConversations(prev => {
        const updated = [...prev, ...deletedConvs]
        return updated.sort((a, b) => {
          if (a.is_pinned && !b.is_pinned) return -1
          if (!a.is_pinned && b.is_pinned) return 1
          return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
        })
      })
    }
    
    exitSelectionMode()
  }

  // Load conversations from cache first, then sync with server
  useEffect(() => {
    if (user && !initialLoadComplete.current) {
      initialLoadComplete.current = true
      loadConversationsWithCacheFirst()
    }
  }, [user])

  // Set up real-time subscriptions
  useEffect(() => {
    if (user) {
      
      // Subscribe to conversation changes with debounced reload
      const conversationsChannel = supabase
        .channel('conversations')
        .on('postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'conversations'
          },
          () => debouncedReload()
        )
        .subscribe()

      // Subscribe to conversation_members changes (for when members are added/removed)
      const membersChannel = supabase
        .channel('conversation-members')
        .on('postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'conversation_members'
          },
          () => debouncedReload()
        )
        .subscribe()

      // Subscribe to profile changes for real-time avatar updates with debounced reload
      const profilesChannel = supabase
        .channel('profiles-updates')
        .on('postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'profiles'
          },
          () => debouncedReload()
        )
        .subscribe()

      return () => {
        supabase.removeChannel(conversationsChannel)
        supabase.removeChannel(membersChannel)
        supabase.removeChannel(profilesChannel)
      }
    }
  }, [user, debouncedReload])

  // Load from cache first, then sync with server (WhatsApp-like behavior)
  const loadConversationsWithCacheFirst = async () => {
    if (!user) return

    try {
      // Step 1: Load from cache immediately (no loading spinner if we have cached data)
      const cachedConversations = await offlineStorage.getConversations()
      
      if (cachedConversations && cachedConversations.length > 0) {
        console.log(`[ChatsPage] Loaded ${cachedConversations.length} conversations from cache`)
        setConversations(cachedConversations)
        setHasLoadedFromCache(true)
        setIsLoading(false) // No spinner - show cached data immediately!
        
        // Step 2: Sync with server in background after a small delay
        // This ensures the cached data is rendered first
        setTimeout(() => {
          loadConversationsFromServer(false)
        }, 100)
      } else {
        // No cache, show loading and fetch from server
        console.log('[ChatsPage] No cached conversations, loading from server')
        await loadConversationsFromServer(true)
      }
    } catch (error) {
      console.error('[ChatsPage] Error loading from cache:', error)
      // Fallback to server load
      await loadConversationsFromServer(true)
    }
  }

  // Load conversations from server (can be called with or without loading state)
  const loadConversationsFromServer = async (showLoading: boolean = true) => {
    if (!user) return

    if (showLoading) {
      setIsLoading(true)
    }

    try {
      // Step 1: Get all conversation memberships for the user (single query)
      const { data: memberData, error: memberError } = await supabase
        .from('conversation_members')
        .select('conversation_id, is_pinned, is_muted, is_archived')
        .eq('user_id', user.id)

      if (memberError) {
        console.error('Error loading members:', memberError)
        return
      }

      if (!memberData || memberData.length === 0) {
        setConversations([])
        return
      }

      // Filter non-archived conversations
      const activeMembers = memberData.filter(m => !m.is_archived)
      const conversationIds = activeMembers.map(m => m.conversation_id)
      
      if (conversationIds.length === 0) {
        setConversations([])
        return
      }

      // Step 2: Fetch all conversations (single query)
      const { data: conversationsData, error: convError } = await supabase
        .from('conversations')
        .select('*')
        .in('id', conversationIds)
        .order('last_message_at', { ascending: false, nullsFirst: true })
        .order('created_at', { ascending: false })

      if (convError) {
        console.error('Error loading conversations:', convError)
        return
      }

      if (!conversationsData || conversationsData.length === 0) {
        setConversations([])
        return
      }

      // Step 3: Batch fetch all members for all conversations (single query)
      // Include all members (not just others) to detect "Saved Messages" conversations
      const { data: allMembersIncludingSelf } = await supabase
        .from('conversation_members')
        .select('conversation_id, user_id')
        .in('conversation_id', conversationIds)
      
      // Filter to get other members (for normal conversations)
      const allMembers = allMembersIncludingSelf?.filter(m => m.user_id !== user.id) || []
      
      // Detect "Saved Messages" conversations (only one member = self)
      const savedMessagesConvIds = new Set<string>()
      const memberCountByConv = new Map<string, number>()
      allMembersIncludingSelf?.forEach(m => {
        memberCountByConv.set(m.conversation_id, (memberCountByConv.get(m.conversation_id) || 0) + 1)
      })
      memberCountByConv.forEach((count, convId) => {
        if (count === 1) {
          savedMessagesConvIds.add(convId)
        }
      })

      // Step 4: Get unique user IDs and batch fetch all profiles (single query)
      // Include current user's profile for "Saved Messages" conversations
      const otherUserIds = [...new Set(allMembers?.map(m => m.user_id) || [])]
      
      // For direct conversations, we need to ensure we have all other user profiles
      // Get all direct conversation IDs
      const directConvIds = conversationsData
        .filter(c => c.type === 'direct')
        .map(c => c.id)
      
      // Get all user IDs from direct conversations (excluding self)
      const directConvOtherUserIds = allMembers
        .filter(m => directConvIds.includes(m.conversation_id))
        .map(m => m.user_id)
      
      // Combine all user IDs we need to fetch
      const userIdsToFetch = [
        ...new Set([
          ...otherUserIds,
          ...directConvOtherUserIds,
          ...(savedMessagesConvIds.size > 0 ? [user.id] : [])
        ])
      ]
      
      const { data: profiles } = userIdsToFetch.length > 0
        ? await supabase
            .from('profiles')
            .select('*')
            .in('id', userIdsToFetch)
        : { data: [] }

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || [])

      // Step 5: Batch fetch last messages for all conversations (single query)
      // Get recent messages and filter to get the last one per conversation
      const { data: recentMessages } = await supabase
        .from('messages')
        .select('*')
        .in('conversation_id', conversationIds)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(conversationIds.length * 2) // Get enough to have at least 1 per conversation

      // Group by conversation and take the first (most recent) for each
      const lastMessageMap = new Map<string, Message>()
      recentMessages?.forEach(msg => {
        if (!lastMessageMap.has(msg.conversation_id)) {
          lastMessageMap.set(msg.conversation_id, msg)
        }
      })

      // Step 6: Batch count unread messages (single query)
      const { data: unreadData } = await supabase
        .from('messages')
        .select('conversation_id')
        .in('conversation_id', conversationIds)
        .neq('sender_id', user.id)
        .neq('status', 'read')
        .is('deleted_at', null)

      // Count unread per conversation
      const unreadCountMap = new Map<string, number>()
      unreadData?.forEach(msg => {
        unreadCountMap.set(msg.conversation_id, (unreadCountMap.get(msg.conversation_id) || 0) + 1)
      })

      // Step 7: Build the enriched conversations array (no additional queries)
      const membersByConversation = new Map<string, string[]>()
      allMembers?.forEach(m => {
        const existing = membersByConversation.get(m.conversation_id) || []
        existing.push(m.user_id)
        membersByConversation.set(m.conversation_id, existing)
      })

      const enrichedConversations: ConversationWithDetails[] = conversationsData.map(conv => {
        const memberInfo = activeMembers.find(m => m.conversation_id === conv.id)
        const otherUserIdsForConv = membersByConversation.get(conv.id) || []
        
        // Check if this is a "Saved Messages" conversation (only one member = self)
        const isSavedMessages = savedMessagesConvIds.has(conv.id)
        
        // For "Saved Messages", use current user's profile; otherwise use other user's profile
        let otherProfile: Profile | undefined
        if (conv.type === 'direct') {
          if (isSavedMessages) {
            // Use current user's profile for "Saved Messages"
            otherProfile = profileMap.get(user.id)
          } else if (otherUserIdsForConv.length > 0) {
            // Normal direct conversation - get the other user's profile
            otherProfile = profileMap.get(otherUserIdsForConv[0])
            
            // If profile not found in map, try to find any other member's profile
            if (!otherProfile) {
              for (const userId of otherUserIdsForConv) {
                const profile = profileMap.get(userId)
                if (profile) {
                  otherProfile = profile
                  break
                }
              }
            }
          }
          
          // Log warning if we couldn't find a profile for a direct conversation
          if (!otherProfile && !isSavedMessages) {
            console.warn(`[ChatsPage] Could not find profile for direct conversation ${conv.id}, other user IDs:`, otherUserIdsForConv)
          }
        }

        return {
          ...conv,
          is_pinned: memberInfo?.is_pinned || false,
          is_muted: memberInfo?.is_muted || false,
          otherUserProfile: otherProfile,
          lastMessage: lastMessageMap.get(conv.id),
          unreadCount: unreadCountMap.get(conv.id) || 0
        }
      })

      // Sort: pinned first, then by last_message_at
      const sorted = enrichedConversations.sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1
        if (!a.is_pinned && b.is_pinned) return 1
        return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
      })
      
      // Compare data by content (not order) to avoid unnecessary re-renders
      // Create a map of conversation data for comparison
      const createDataMap = (convs: ConversationWithDetails[]) => {
        const map = new Map<string, string>()
        convs.forEach(c => {
          map.set(c.id, JSON.stringify({
            last_message_at: c.last_message_at,
            unreadCount: c.unreadCount,
            is_pinned: c.is_pinned,
            is_muted: c.is_muted,
            lastMessageId: c.lastMessage?.id,
            lastMessageContent: c.lastMessage?.content?.substring(0, 50),
            otherUserName: c.otherUserProfile?.display_name || c.otherUserProfile?.username,
            otherUserAvatar: c.otherUserProfile?.avatar_url
          }))
        })
        return map
      }
      
      const currentDataMap = createDataMap(conversations)
      const newDataMap = createDataMap(sorted)
      
      // Check if any conversation data has actually changed
      let hasDataChanged = conversations.length !== sorted.length
      if (!hasDataChanged) {
        for (const [id, data] of newDataMap) {
          if (currentDataMap.get(id) !== data) {
            hasDataChanged = true
            break
          }
        }
      }
      
      // Check if there are new conversations or removed conversations
      const currentIds = new Set(conversations.map(c => c.id))
      const newIds = new Set(sorted.map(c => c.id))
      const hasNewConversations = sorted.some(c => !currentIds.has(c.id))
      const hasRemovedConversations = conversations.some(c => !newIds.has(c.id))
      
      // Also check if order has changed for pinned items (important for UX)
      const currentPinnedOrder = conversations.filter(c => c.is_pinned).map(c => c.id).join(',')
      const newPinnedOrder = sorted.filter(c => c.is_pinned).map(c => c.id).join(',')
      const pinnedOrderChanged = currentPinnedOrder !== newPinnedOrder
      
      console.log('[ChatsPage] Comparison:', {
        hasDataChanged,
        pinnedOrderChanged,
        hasNewConversations,
        hasRemovedConversations,
        hasLoadedFromCache
      })
      
      // If we have cached data, update the existing conversations in place
      // without changing the order (to avoid visual jump)
      if (hasLoadedFromCache && !hasNewConversations && !hasRemovedConversations) {
        // Update existing conversations with new data but keep the current order
        const updatedConversations = conversations.map(conv => {
          const newConv = sorted.find(c => c.id === conv.id)
          return newConv || conv
        })
        
        // Only update state if data actually changed
        if (hasDataChanged || pinnedOrderChanged) {
          // Re-sort only if pinned status changed
          if (pinnedOrderChanged) {
            const resorted = updatedConversations.sort((a, b) => {
              if (a.is_pinned && !b.is_pinned) return -1
              if (!a.is_pinned && b.is_pinned) return 1
              return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
            })
            setConversations(resorted)
            await offlineStorage.saveConversations(resorted)
          } else {
            setConversations(updatedConversations)
            await offlineStorage.saveConversations(sorted) // Save sorted version for next load
          }
        } else {
          // Just update cache with correct order for next load
          await offlineStorage.saveConversations(sorted)
        }
      } else if (hasNewConversations || hasRemovedConversations || !hasLoadedFromCache) {
        // New or removed conversations - full update needed
        console.log('[ChatsPage] Full update needed')
        setConversations(sorted)
        await offlineStorage.saveConversations(sorted)
      }
    } catch (err) {
      console.error('Error loading conversations:', err)
      // Only clear conversations if we don't have cached data
      if (!hasLoadedFromCache) {
        setConversations([])
      }
    } finally {
      setIsLoading(false)
    }
  }

  // Legacy function name for compatibility with existing code
  const loadConversations = () => loadConversationsFromServer(true)

  const handleContextMenu = (e: React.MouseEvent, conversationId: string) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      conversationId,
      onSelect: () => enterSelectionMode(conversationId)
    })
  }

  const handleMarkAsUnread = async (conversationId: string) => {
    // Optimistic update - increment unread count immediately
    setConversations(prev => prev.map(conv =>
      conv.id === conversationId
        ? { ...conv, unreadCount: Math.max(1, (conv.unreadCount || 0) + 1) }
        : conv
    ))
    
    const { data: messages } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .neq('sender_id', user!.id)
      .eq('status', 'read')

    if (messages && messages.length > 0) {
      const { error } = await supabase
        .from('messages')
        .update({ status: 'delivered' })
        .in('id', messages.map(m => m.id))
      
      if (error) {
        // Revert on error
        setConversations(prev => prev.map(conv =>
          conv.id === conversationId
            ? { ...conv, unreadCount: Math.max(0, (conv.unreadCount || 1) - 1) }
            : conv
        ))
      }
    }
  }

  const handlePinConversation = async (conversationId: string) => {
    const conv = conversations.find(c => c.id === conversationId)
    if (!conv) return

    const currentPinned = conv.is_pinned || false
    
    // Optimistic update - update UI immediately
    setConversations(prev => {
      const updated = prev.map(c =>
        c.id === conversationId ? { ...c, is_pinned: !currentPinned } : c
      )
      // Re-sort: pinned first, then by last_message_at
      return updated.sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1
        if (!a.is_pinned && b.is_pinned) return 1
        return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
      })
    })
    
    // Then sync with database
    const { error } = await supabase
      .from('conversation_members')
      .update({ is_pinned: !currentPinned })
      .eq('conversation_id', conversationId)
      .eq('user_id', user!.id)
    
    if (error) {
      // Revert on error
      setConversations(prev => {
        const updated = prev.map(c =>
          c.id === conversationId ? { ...c, is_pinned: currentPinned } : c
        )
        return updated.sort((a, b) => {
          if (a.is_pinned && !b.is_pinned) return -1
          if (!a.is_pinned && b.is_pinned) return 1
          return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
        })
      })
    }
  }

  const handleArchiveConversation = async (conversationId: string) => {
    // Optimistic update - remove from list immediately
    const archivedConv = conversations.find(c => c.id === conversationId)
    setConversations(prev => prev.filter(c => c.id !== conversationId))
    
    const { error } = await supabase
      .from('conversation_members')
      .update({ is_archived: true })
      .eq('conversation_id', conversationId)
      .eq('user_id', user!.id)
    
    if (error && archivedConv) {
      // Revert on error - add back to list
      setConversations(prev => {
        const updated = [...prev, archivedConv]
        return updated.sort((a, b) => {
          if (a.is_pinned && !b.is_pinned) return -1
          if (!a.is_pinned && b.is_pinned) return 1
          return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
        })
      })
    }
  }

  const handleMuteConversation = async (conversationId: string) => {
    const conv = conversations.find(c => c.id === conversationId)
    if (!conv) return

    const currentMuted = conv.is_muted || false
    
    // Optimistic update - update UI immediately
    setConversations(prev => prev.map(c =>
      c.id === conversationId ? { ...c, is_muted: !currentMuted } : c
    ))
    
    // Then sync with database
    const { error } = await supabase
      .from('conversation_members')
      .update({ is_muted: !currentMuted })
      .eq('conversation_id', conversationId)
      .eq('user_id', user!.id)
    
    if (error) {
      // Revert on error
      setConversations(prev => prev.map(c =>
        c.id === conversationId ? { ...c, is_muted: currentMuted } : c
      ))
    }
  }

  const handleClearMessages = async (conversationId: string) => {
    if (confirm('Voulez-vous vraiment effacer tous les messages de cette conversation ?')) {
      // Soft-delete all messages in the conversation (set deleted_at timestamp)
      const { error } = await supabase
        .from('messages')
        .update({ deleted_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
      
      if (!error) {
        // Update local state to show empty conversation (clear lastMessage)
        setConversations(prev => prev.map(conv =>
          conv.id === conversationId
            ? { ...conv, lastMessage: undefined, unreadCount: 0 }
            : conv
        ))
      }
    }
  }

  const handleDeleteConversation = async (conversationId: string) => {
    if (confirm('Voulez-vous vraiment supprimer cette conversation ? La conversation sera supprimée de votre liste.')) {
      // Optimistic update - remove from list immediately
      const deletedConv = conversations.find(c => c.id === conversationId)
      setConversations(prev => prev.filter(c => c.id !== conversationId))
      
      // Remove user from conversation (soft delete the conversation for this user)
      const { error } = await supabase
        .from('conversation_members')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('user_id', user!.id)
      
      if (error && deletedConv) {
        // Revert on error - add back to list
        setConversations(prev => {
          const updated = [...prev, deletedConv]
          return updated.sort((a, b) => {
            if (a.is_pinned && !b.is_pinned) return -1
            if (!a.is_pinned && b.is_pinned) return 1
            return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
          })
        })
      }
    }
  }

  const handleOpenInNewWindow = (conversationId: string) => {
    window.open(`/chat/${conversationId}`, '_blank')
  }

  // Memoize filtered conversations to prevent unnecessary recalculations
  const filteredConversations = useMemo(() => {
    return conversations.filter(conv => {
      // Filtre par recherche
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        
        // Check conversation name first
        if (conv.name?.toLowerCase().includes(query)) {
          // Name matches, continue to other filters
        } else if (conv.type === 'direct') {
          // For direct conversations, check the other user's profile
          if (conv.otherUserProfile) {
            const profileName = conv.otherUserProfile.display_name || conv.otherUserProfile.username || ''
            if (!profileName.toLowerCase().includes(query)) {
              return false
            }
          }
          // If no otherUserProfile, still show the conversation (don't filter it out)
          // This prevents conversations from disappearing due to missing profile data
        } else {
          // Group conversation without matching name
          return false
        }
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
  }, [conversations, searchQuery, activeFilter])

  // Check if any selected conversation is pinned/muted (for toggle icons)
  const anySelectedPinned = useMemo(() => {
    return Array.from(selectedConversations).some(id => {
      const conv = conversations.find(c => c.id === id)
      return conv?.is_pinned
    })
  }, [selectedConversations, conversations])
  
  const anySelectedMuted = useMemo(() => {
    return Array.from(selectedConversations).some(id => {
      const conv = conversations.find(c => c.id === id)
      return conv?.is_muted
    })
  }, [selectedConversations, conversations])

  return (
    <MainLayout>
      {/* Selection Mode Top Bar - WhatsApp style */}
      {isSelectionMode && (
        <div
          className="fixed top-0 left-0 right-0 z-50 bg-bg-surface border-b border-bg-hover shadow-lg animate-in slide-in-from-top duration-200"
        >
          <div className="flex items-center justify-between h-14 px-2">
            {/* Left side: Back arrow + count */}
            <div className="flex items-center gap-3">
              <button
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  console.log('[ChatsPage] Back button clicked - exiting selection mode')
                  exitSelectionMode()
                }}
                onTouchEnd={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  console.log('[ChatsPage] Back button touched - exiting selection mode')
                  exitSelectionMode()
                }}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover active:bg-bg-hover transition-colors touch-manipulation"
                type="button"
                aria-label="Quitter le mode sélection"
              >
                <ArrowLeft size={24} className="text-text-primary" />
              </button>
              <span className="text-lg font-medium text-text-primary">
                {selectedConversations.size}
              </span>
            </div>
            
            {/* Right side: Action icons */}
            <div className="flex items-center gap-1">
              {/* Pin */}
              <button
                onClick={handleBulkPin}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
                title={anySelectedPinned ? 'Désépingler' : 'Épingler'}
              >
                <Pin size={20} className={anySelectedPinned ? 'text-accent' : 'text-text-primary'} />
              </button>
              
              {/* Mute */}
              <button
                onClick={handleBulkMute}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
                title={anySelectedMuted ? 'Réactiver le son' : 'Désactiver les notifications'}
              >
                {anySelectedMuted ? (
                  <Volume2 size={20} className="text-text-primary" />
                ) : (
                  <VolumeX size={20} className="text-text-primary" />
                )}
              </button>
              
              {/* Archive */}
              <button
                onClick={handleBulkArchive}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
                title="Archiver"
              >
                <Archive size={20} className="text-text-primary" />
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
      
      {/* Liste des conversations - Style JemaOS */}
      <div className={`w-full md:w-[420px] bg-bg-secondary flex flex-col md:border-r border-bg-hover pb-20 md:pb-0 ${isSelectionMode ? 'pt-14' : ''}`}>
        {/* Header - COMPLETELY Hidden in selection mode */}
        {!isSelectionMode ? (
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
                    <div className="absolute right-0 top-12 z-50 min-w-[220px] bg-bg-surface rounded-2xl shadow-2xl py-2 border border-bg-hover">
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
                    <div className="absolute right-0 top-12 z-50 min-w-[200px] bg-bg-surface rounded-2xl shadow-2xl py-2 border border-bg-hover">
                      <button
                        onClick={() => { setActiveFilter('all'); setShowFilterMenu(false) }}
                        className="w-full px-4 py-2 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                      >
                        {activeFilter === 'all' && <Check size={16} className="text-[#787add]" />}
                        <span className={activeFilter === 'all' ? 'ml-0' : 'ml-7'}>Toutes les discussions</span>
                      </button>
                      <button
                        onClick={() => { setActiveFilter('unread'); setShowFilterMenu(false) }}
                        className="w-full px-4 py-2 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                      >
                        {activeFilter === 'unread' && <Check size={16} className="text-[#787add]" />}
                        <span className={activeFilter === 'unread' ? 'ml-0' : 'ml-7'}>Non lues</span>
                      </button>
                      <button
                        onClick={() => { setActiveFilter('groups'); setShowFilterMenu(false) }}
                        className="w-full px-4 py-2 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                      >
                        {activeFilter === 'groups' && <Check size={16} className="text-[#787add]" />}
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
                activeFilter === 'all' ? 'bg-[#787add] text-white' : 'hover:bg-bg-hover text-text-secondary'
              }`}
            >
              Tous
            </button>
            <button
              onClick={() => setActiveFilter('unread')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                activeFilter === 'unread' ? 'bg-[#787add] text-white' : 'hover:bg-bg-hover text-text-secondary'
              }`}
            >
              Non lus
            </button>
            <button
              onClick={() => setActiveFilter('groups')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                activeFilter === 'groups' ? 'bg-[#787add] text-white' : 'hover:bg-bg-hover text-text-secondary'
              }`}
            >
              Groupes
            </button>
          </div>
        </div>
        ) : null}

        {/* Liste des conversations */}
        <div className="flex-1 overflow-y-auto pb-4">
          {isLoading ? (
            <ConversationSkeleton />
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <MessageCircle size={64} className="text-[#3b4a54] mb-4" />
              <h3 className="text-lg font-medium text-text-secondary mb-2">Aucune conversation</h3>
              <p className="text-sm text-text-secondary">Commencez une nouvelle discussion</p>
            </div>
          ) : (
          filteredConversations.map((conversation) => {
            // Déterminer le nom à afficher
            // For "Saved Messages" conversations (self-contact), display "Moi" or user's name
            const isSavedMessagesConv = conversation.type === 'direct' && conversation.name === 'Messages enregistrés'
            const displayName = conversation.type === 'group'
              ? conversation.name || 'Groupe'
              : isSavedMessagesConv
                ? 'Moi'
                : conversation.otherUserProfile?.display_name || conversation.otherUserProfile?.username || 'Utilisateur'

            // Déterminer l'aperçu du dernier message
            const getLastMessagePreview = () => {
              if (!conversation.lastMessage) return 'Aucun message'
              
              const msg = conversation.lastMessage
              
              // Check for GIF pattern: [GIF](url) or caption\n[GIF](url)
              if (msg.type === 'text' && msg.content) {
                const gifMatch = msg.content.match(/^(?:[\s\S]*?\n)?\[GIF\]\(https?:\/\/[^\)]+\)$/)
                if (gifMatch) {
                  // Extract caption if present
                  const captionMatch = msg.content.match(/^([\s\S]*?)\n\[GIF\]/)
                  const caption = captionMatch ? captionMatch[1].trim() : ''
                  return caption ? `GIF • ${caption}` : 'GIF'
                }
                
                // Check for STICKER pattern: [STICKER](url) or caption\n[STICKER](url)
                const stickerMatch = msg.content.match(/^(?:[\s\S]*?\n)?\[STICKER\]\(https?:\/\/[^\)]+\)$/)
                if (stickerMatch) {
                  const captionMatch = msg.content.match(/^([\s\S]*?)\n\[STICKER\]/)
                  const caption = captionMatch ? captionMatch[1].trim() : ''
                  return caption ? `Sticker • ${caption}` : 'Sticker'
                }
                
                // Check for URLs and shorten them like WhatsApp
                const urlRegex = /https?:\/\/[^\s]+/gi
                const urls = msg.content.match(urlRegex)
                if (urls && urls.length > 0) {
                  const url = urls[0]
                  try {
                    const urlObj = new URL(url)
                    const hostname = urlObj.hostname.replace('www.', '')
                    
                    // YouTube special handling
                    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
                      return '📹 youtube.com'
                    }
                    // Instagram
                    if (hostname.includes('instagram.com')) {
                      return '📷 instagram.com'
                    }
                    // Twitter/X
                    if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
                      return '🐦 x.com'
                    }
                    // Facebook
                    if (hostname.includes('facebook.com') || hostname.includes('fb.com')) {
                      return '📘 facebook.com'
                    }
                    // TikTok
                    if (hostname.includes('tiktok.com')) {
                      return '🎵 tiktok.com'
                    }
                    // Spotify
                    if (hostname.includes('spotify.com')) {
                      return '🎧 spotify.com'
                    }
                    // LinkedIn
                    if (hostname.includes('linkedin.com')) {
                      return '💼 linkedin.com'
                    }
                    // GitHub
                    if (hostname.includes('github.com')) {
                      return '💻 github.com'
                    }
                    // Generic link with domain
                    return `🔗 ${hostname}`
                  } catch {
                    return '🔗 Lien'
                  }
                }
                
                // Regular text message
                return msg.content
              }
              
              // Media types
              if (msg.type === 'image') return '📷 Photo'
              if (msg.type === 'video') return '🎬 Vidéo'
              if (msg.type === 'audio') return '🎤 Message vocal'
              if (msg.type === 'file') return `📎 ${msg.file_name || 'Document'}`
              
              return msg.content || '📎 Fichier'
            }
            
            const lastMessagePreview = getLastMessagePreview()

              const hasUnread = (conversation.unreadCount || 0) > 0
              const isSelected = selectedConversations.has(conversation.id)

              return (
                <div
                  key={conversation.id}
                  className={`px-4 py-3 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-accent/20'
                      : hasUnread
                        ? 'bg-bg-surface'
                        : 'hover:bg-bg-surface'
                  }`}
                  onClick={() => handleConversationClick(conversation.id)}
                  onContextMenu={(e) => {
                    if (!isSelectionMode) {
                      handleContextMenu(e, conversation.id)
                    }
                  }}
                  onTouchStart={() => handleTouchStart(conversation.id)}
                  onTouchEnd={handleTouchEnd}
                  onTouchMove={handleTouchMove}
                  onMouseDown={(e) => {
                    // Desktop long press support - only on mobile or when not clicking checkbox area
                    if (isMobile && e.button === 0) {
                      handleTouchStart(conversation.id)
                    }
                  }}
                  onMouseUp={handleTouchEnd}
                  onMouseLeave={handleTouchEnd}
                >
                  <div className="flex items-center gap-3">
                    {/* Selection Checkbox - Only in selection mode (both mobile and desktop) */}
                    {isSelectionMode && (
                      <div
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          isSelected
                            ? 'bg-[#6063cf] border-[#6063cf]'
                            : 'border-text-secondary'
                        }`}
                      >
                        {isSelected && (
                          <Check size={14} className="text-white" strokeWidth={3} />
                        )}
                      </div>
                    )}
                    
                    {/* Avatar */}
                    <div className="relative">
                      {(conversation.type === 'direct' && conversation.otherUserProfile?.avatar_url) || conversation.avatar_url ? (
                        <img
                          src={conversation.type === 'direct' ? conversation.otherUserProfile?.avatar_url! : conversation.avatar_url!}
                          alt={displayName}
                          className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                          key={conversation.type === 'direct' ? conversation.otherUserProfile?.avatar_url : conversation.avatar_url}
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold text-lg flex-shrink-0">
                          {displayName[0]?.toUpperCase()}
                        </div>
                      )}
                      {!isSelectionMode && conversation.is_pinned && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                          <Pin size={12} className="text-white" />
                        </div>
                      )}
                      {!isSelectionMode && conversation.is_muted && (
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
                          <span className={`text-xs flex-shrink-0 ${hasUnread ? 'text-[#787add]' : 'text-text-secondary'}`}>
                            {formatDate(conversation.last_message_at)}
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-sm truncate ${hasUnread ? 'text-text-secondary font-medium' : 'text-text-secondary'}`}>
                          {lastMessagePreview}
                        </p>
                        {hasUnread && (
                          <div className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#787add] flex items-center justify-center flex-shrink-0">
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

      {/* Zone de chat vide - Style JemaOS - Desktop only */}
      <div className="hidden md:flex flex-1 bg-bg-primary flex-col items-center justify-center">
        <div className="text-center">
          <h2 className="text-3xl font-light text-text-secondary mb-4">Nephtys pour JemaOS</h2>
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

      {/* Context Menu - Only show when not in selection mode */}
      {contextMenu && !isSelectionMode && (() => {
        const selectedConv = conversations.find(c => c.id === contextMenu.conversationId)
        return (
          <ConversationContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onMarkAsUnread={() => handleMarkAsUnread(contextMenu.conversationId)}
            onPin={() => handlePinConversation(contextMenu.conversationId)}
            onArchive={() => handleArchiveConversation(contextMenu.conversationId)}
            onMute={() => handleMuteConversation(contextMenu.conversationId)}
            onClearMessages={() => handleClearMessages(contextMenu.conversationId)}
            onDelete={() => handleDeleteConversation(contextMenu.conversationId)}
            onOpenInNewWindow={() => handleOpenInNewWindow(contextMenu.conversationId)}
            onSelect={contextMenu.onSelect}
            isPinned={selectedConv?.is_pinned || false}
            isMuted={selectedConv?.is_muted || false}
          />
        )
      })()}
    </MainLayout>
  )
}
