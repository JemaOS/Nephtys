// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { RealtimeChannel } from '@supabase/supabase-js'

interface PresenceState {
  isOnline: boolean
  lastSeen: string | null
}

interface UserPresence {
  [userId: string]: PresenceState
}

// Global presence channel - shared across all components
let globalPresenceChannel: RealtimeChannel | null = null
let globalPresenceState: UserPresence = {}
const presenceListeners: Set<(state: UserPresence) => void> = new Set()
let currentUserId: string | null = null

// NOTE : `updateLastSeen` et `setOffline` étaient des no-op (les colonnes
// `is_online` et `last_seen` n'ont jamais été ajoutées à la table profiles).
// On les a supprimés ainsi que le `setInterval(..., 30000)` qui ne servait
// qu'à les appeler — gain : un timer de moins en boucle continue.
// La présence est gérée 100% via le canal Supabase Realtime `online-users`.

// Initialize global presence tracking
export const initializePresence = (userId: string) => {
  if (currentUserId === userId && globalPresenceChannel) {
    return // Already initialized for this user
  }

  // Cleanup previous channel if exists
  if (globalPresenceChannel) {
    globalPresenceChannel.unsubscribe()
    globalPresenceChannel = null
  }

  currentUserId = userId

  // Create presence channel
  globalPresenceChannel = supabase.channel('online-users', {
    config: {
      presence: {
        key: userId,
      },
    },
  })

  globalPresenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = globalPresenceChannel?.presenceState() || {}
      
      // Convert presence state to our format
      const newPresenceState: UserPresence = {}
      
      Object.keys(state).forEach((key) => {
        const presences = state[key] as any[]
        if (presences && presences.length > 0) {
          newPresenceState[key] = {
            isOnline: true,
            lastSeen: new Date().toISOString(),
          }
        }
      })
      
      globalPresenceState = newPresenceState
      
      // Notify all listeners
      presenceListeners.forEach(listener => listener(globalPresenceState))
    })
    .on('presence', { event: 'join' }, ({ key, newPresences }) => {
      globalPresenceState[key] = {
        isOnline: true,
        lastSeen: new Date().toISOString(),
      }
      presenceListeners.forEach(listener => listener({ ...globalPresenceState }))
    })
    .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
      globalPresenceState[key] = {
        isOnline: false,
        lastSeen: new Date().toISOString(),
      }
      presenceListeners.forEach(listener => listener({ ...globalPresenceState }))
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Track this user's presence (le serveur Supabase Realtime maintient
        // automatiquement la présence tant que la connexion WebSocket vit).
        await globalPresenceChannel?.track({
          user_id: userId,
          online_at: new Date().toISOString(),
        })
      }
    })

  // Handle page visibility changes — track 'away'/'active' pour que les
  // autres clients voient le bon statut. Le `track()` Supabase est un
  // simple message WebSocket, pas un INSERT DB.
  const handleVisibilityChange = () => {
    if (document.hidden) {
      globalPresenceChannel?.track({
        user_id: userId,
        online_at: new Date().toISOString(),
        status: 'away',
      })
    } else {
      globalPresenceChannel?.track({
        user_id: userId,
        online_at: new Date().toISOString(),
        status: 'active',
      })
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)

  // Store cleanup function (beforeunload n'est plus utile : la fermeture
  // du WS Supabase déclenche automatiquement l'event presence 'leave').
  ;(globalPresenceChannel as any)._cleanup = () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}

// Cleanup presence tracking
export const cleanupPresence = () => {
  if (globalPresenceChannel) {
    const cleanup = (globalPresenceChannel as any)._cleanup
    if (cleanup) cleanup()
    
    globalPresenceChannel.unsubscribe()
    globalPresenceChannel = null
  }
  
  currentUserId = null
  globalPresenceState = {}
}

// Hook to use presence in components
export function usePresence(userId?: string) {
  const [presenceState, setPresenceState] = useState<UserPresence>(globalPresenceState)
  const [userStatus, setUserStatus] = useState<PresenceState>({ isOnline: false, lastSeen: null })

  useEffect(() => {
    // Subscribe to presence updates
    const listener = (state: UserPresence) => {
      setPresenceState(state)
    }
    
    presenceListeners.add(listener)
    
    // Set initial state
    setPresenceState(globalPresenceState)
    
    return () => {
      presenceListeners.delete(listener)
    }
  }, [])

  // Get specific user's status
  useEffect(() => {
    if (userId) {
      const status = presenceState[userId]
      if (status) {
        setUserStatus(status)
      } else {
        // User not in presence state - fetch from database
        fetchUserStatus(userId)
      }
    }
  }, [userId, presenceState])

  // Fetch user status from database if not in presence
  const fetchUserStatus = async (uid: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('is_online, last_seen')
        .eq('id', uid)
        .maybeSingle()

      if (!error && data) {
        setUserStatus({
          isOnline: data.is_online || false,
          lastSeen: data.last_seen,
        })
      }
    } catch (error) {
      console.error('Error fetching user status:', error)
    }
  }

  // Format last seen time like WhatsApp
  const formatLastSeen = useCallback((lastSeen: string | null): string => {
    if (!lastSeen) return ''
    
    const lastSeenDate = new Date(lastSeen)
    const now = new Date()
    const diffMs = now.getTime() - lastSeenDate.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) {
      return 'à l\'instant'
    } else if (diffMins < 60) {
      return `il y a ${diffMins} min`
    } else if (diffHours < 24) {
      return `il y a ${diffHours}h`
    } else if (diffDays === 1) {
      return `hier à ${lastSeenDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    } else if (diffDays < 7) {
      const dayName = lastSeenDate.toLocaleDateString('fr-FR', { weekday: 'long' })
      return `${dayName} à ${lastSeenDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    } else {
      return lastSeenDate.toLocaleDateString('fr-FR', { 
        day: 'numeric', 
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      })
    }
  }, [])

  // Get status text like WhatsApp
  const getStatusText = useCallback((): string => {
    if (userStatus.isOnline) {
      return 'en ligne'
    } else if (userStatus.lastSeen) {
      return `vu ${formatLastSeen(userStatus.lastSeen)}`
    }
    return ''
  }, [userStatus, formatLastSeen])

  return {
    presenceState,
    userStatus,
    isOnline: userStatus.isOnline,
    lastSeen: userStatus.lastSeen,
    getStatusText,
    formatLastSeen,
  }
}

// Hook to track a specific user's presence.
// On retourne directement les valeurs de usePresence — le canal global
// `online-users` est seul source de vérité. L'ancien canal supplémentaire
// `user-presence-${userId}` ouvrait une socket Postgres Changes par
// utilisateur observé pour un handler vide. Il est supprimé.
export function useUserPresence(userId: string | undefined) {
  const { isOnline, lastSeen, getStatusText } = usePresence(userId)

  return {
    isOnline,
    lastSeen,
    statusText: getStatusText(),
  }
}