// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/MainLayout'
import { ConversationContextMenu } from '@/components/ConversationContextMenu'
import { supabase, Conversation, Profile, Message, updateLastSuccessfulQuery } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { offlineStorage } from '@/lib/offlineStorage'
import { useIsMobile } from '@/hooks/use-mobile'
import { useOnSupabaseReconnect } from '@/hooks/useSupabaseReconnect'
import { fetchAllConversationData } from '@/lib/conversationService'
import { ChatsSelectionHeader, ChatsHeader, ChatsList, ConversationWithDetails } from './ChatsPageComponents'

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





// Helper function to check if conversation matches search query
const matchesSearchQuery = (conv: ConversationWithDetails, query: string): boolean => {
  // Check conversation name first
  if (conv.name?.toLowerCase().includes(query)) {
    return true
  }
  
  if (conv.type === 'direct') {
    // For direct conversations, check the other user's profile
    if (conv.otherUserProfile) {
      const profileName = conv.otherUserProfile.display_name || conv.otherUserProfile.username || ''
      if (profileName.toLowerCase().includes(query)) {
        return true
      }
    }
    // If no otherUserProfile, still show the conversation
    return false
  }
  
  // Group conversation without matching name
  return false
}

// Helper function to filter conversations - extracted to module level
const filterConversations = (
  conversations: ConversationWithDetails[],
  searchQuery: string,
  activeFilter: 'all' | 'unread' | 'groups'
): ConversationWithDetails[] => {
  return conversations.filter(conv => {
    // Filter by search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      if (!matchesSearchQuery(conv, query)) {
        return false
      }
    }
    
    // Filter by type
    if (activeFilter === 'unread' && (conv.unreadCount || 0) === 0) {
      return false
    }
    if (activeFilter === 'groups' && conv.type !== 'group') {
      return false
    }
    
    return true
  })
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
    console.log('[ChatsPage] exitSelectionMode called - resetting selection state ATOMICALLY')
    // CRITICAL: Set isSelectionMode to false FIRST and IMMEDIATELY
    // This ensures the UI switches to normal mode before any other state changes
    setIsSelectionMode(false)
    // Clear selections in a separate microtask to ensure isSelectionMode is false first
    // But since React batches these, we use a single state update pattern
    setSelectedConversations(new Set())
  }, [])
  
  const toggleConversationSelection = useCallback((conversationId: string) => {
    setSelectedConversations(prev => {
      const newSet = new Set(prev)
      if (newSet.has(conversationId)) {
        newSet.delete(conversationId)
        // DO NOT exit selection mode here - let the user explicitly click back
        // This prevents race conditions and intermediate states
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
      
      // Loading timeout - prevent infinite loading (max 10 seconds)
      const loadingTimeout = setTimeout(() => {
        setIsLoading(false)
      }, 10000)
      
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

      // Handle visibility change - refresh data when app comes back to foreground
      // This is critical for PWA on mobile where the app may be suspended
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          console.log('[ChatsPage] App became visible, refreshing conversations...')
          // Reload conversations when app becomes visible again
          loadConversationsFromServer(false) // Background sync, no loading state
        }
      }
      
      document.addEventListener('visibilitychange', handleVisibilityChange)
      
      // Handle Supabase reconnection event (triggered by useSupabaseReconnect hook)
      const handleSupabaseReconnect = () => {
        console.log('[ChatsPage] Supabase reconnected, reloading conversations...')
        loadConversationsFromServer(false) // Background sync, no loading state
      }
      
      // Handle connection lost event (triggered by health check)
      const handleConnectionLost = () => {
        console.log('[ChatsPage] Connection lost detected, will retry on next action...')
        // Don't reload immediately - the health check will trigger reconnect
        // Just mark that we need to reload when connection is restored
      }
      
      window.addEventListener('supabase-reconnected', handleSupabaseReconnect)
      window.addEventListener('supabase-connection-lost', handleConnectionLost)

      return () => {
        clearTimeout(loadingTimeout)
        supabase.removeChannel(conversationsChannel)
        supabase.removeChannel(membersChannel)
        supabase.removeChannel(profilesChannel)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        window.removeEventListener('supabase-reconnected', handleSupabaseReconnect)
        window.removeEventListener('supabase-connection-lost', handleConnectionLost)
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

  // Helper function to create a map of conversation data for comparison
const createConversationDataMap = (convs: ConversationWithDetails[]) => {
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

  // Helper to analyze conversation changes and determine update strategy
  const analyzeConversationChanges = (currentConvs: ConversationWithDetails[], newConvs: ConversationWithDetails[]) => {
    const currentDataMap = createConversationDataMap(currentConvs)
    const newDataMap = createConversationDataMap(newConvs)

    // Check if any conversation data has actually changed
    let hasDataChanged = currentConvs.length !== newConvs.length
    if (!hasDataChanged) {
      for (const [id, data] of newDataMap) {
        if (currentDataMap.get(id) !== data) {
          hasDataChanged = true
          break
        }
      }
    }

    // Check if there are new conversations or removed conversations
    const currentIds = new Set(currentConvs.map(c => c.id))
    const newIds = new Set(newConvs.map(c => c.id))
    const hasNewConversations = newConvs.some(c => !currentIds.has(c.id))
    const hasRemovedConversations = currentConvs.some(c => !newIds.has(c.id))

    // Also check if order has changed for pinned items
    const currentPinnedOrder = currentConvs.filter(c => c.is_pinned).map(c => c.id).join(',')
    const newPinnedOrder = newConvs.filter(c => c.is_pinned).map(c => c.id).join(',')
    const pinnedOrderChanged = currentPinnedOrder !== newPinnedOrder

    return { hasNewConversations, hasRemovedConversations, hasDataChanged, pinnedOrderChanged }
  }

  // Load conversations from server (can be called with or without loading state)
  const loadConversationsFromServer = async (showLoading: boolean = true) => {
    if (!user) return

    if (showLoading) {
      setIsLoading(true)
    }

    try {
      const { enrichedConversations, error, type } = await fetchAllConversationData(user.id)

      if (error) {
        console.error(`Error loading ${type}:`, error)
        if (type === 'members') {
          // Dispatch connection lost event if all retries failed
          window.dispatchEvent(new CustomEvent('supabase-connection-lost'))
        }
        return
      }

      if (!enrichedConversations || enrichedConversations.length === 0) {
        setConversations([])
        return
      }

      // Sort: pinned first, then by last_message_at
      const sorted = enrichedConversations.sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1
        if (!a.is_pinned && b.is_pinned) return 1
        return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
      })

      // Analyze conversation changes to determine update strategy
      const { hasNewConversations, hasRemovedConversations, hasDataChanged, pinnedOrderChanged } = analyzeConversationChanges(conversations, sorted)

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
    return filterConversations(conversations, searchQuery, activeFilter)
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
      {/* Selection Mode Top Bar - WhatsApp style - ONLY rendered when isSelectionMode is true */}
      {isSelectionMode === true && (
        <ChatsSelectionHeader
          selectedCount={selectedConversations.size}
          exitSelectionMode={exitSelectionMode}
          handleBulkPin={handleBulkPin}
          handleBulkMute={handleBulkMute}
          handleBulkArchive={handleBulkArchive}
          handleBulkDelete={handleBulkDelete}
          anySelectedPinned={anySelectedPinned}
          anySelectedMuted={anySelectedMuted}
        />
      )}
      
      {/* Liste des conversations - Style JemaOS */}
      <div className={`w-full md:w-[420px] bg-bg-secondary flex flex-col md:border-r border-bg-hover pb-20 md:pb-0 ${isSelectionMode === true ? 'pt-14' : ''}`}>
        {/* Header - COMPLETELY Hidden in selection mode - Mutually exclusive with selection bar */}
        {isSelectionMode === false && (
          <ChatsHeader
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            showNewMenu={showNewMenu}
            setShowNewMenu={setShowNewMenu}
            showFilterMenu={showFilterMenu}
            setShowFilterMenu={setShowFilterMenu}
            activeFilter={activeFilter}
            setActiveFilter={setActiveFilter}
            navigate={navigate}
          />
        )}

        {/* Liste des conversations */}
        <ChatsList
          isLoading={isLoading}
          filteredConversations={filteredConversations}
          selectedConversations={selectedConversations}
          isSelectionMode={isSelectionMode}
          handleConversationClick={handleConversationClick}
          handleContextMenu={handleContextMenu}
          handleTouchStart={handleTouchStart}
          handleTouchEnd={handleTouchEnd}
          handleTouchMove={handleTouchMove}
          isMobile={isMobile}
          formatDate={formatDate}
        />
      </div>

      {/* Zone de chat vide - Style JemaOS - Desktop only */}
      <div className="hidden md:flex flex-1 bg-bg-primary flex-col items-center justify-center relative">
        <div className="text-center">
          <h2 className="text-3xl font-light text-text-secondary mb-4">Nephtys optimisé pour JemaOS</h2>
          <p className="text-text-secondary max-w-lg mx-auto leading-relaxed mb-6">
            Messagerie sécurisée qui protège votre vie privée.<br/>
            Vos conversations sont chiffrées de bout en bout. Une architecture hybride conçue pour garantir votre confidentialité absolue.
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
                <p className="text-sm text-text-secondary font-medium">Architecture Hybride & Appels P2P</p>
                <p className="text-xs text-text-secondary">Messagerie sécurisée via le cloud, et appels audio/vidéo en Peer-to-Peer direct sans intermédiaire.</p>
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

        <div className="absolute bottom-6 text-center">
          <p className="text-xs text-gray-500">
            Développé par <a href="https://www.jematechnology.fr/" target="_blank" rel="noopener noreferrer" className="text-[#6b6fdb] hover:underline">Jema Technology</a> © 2025 • Open Source & sous licence AGPL
          </p>
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
