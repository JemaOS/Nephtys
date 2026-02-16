// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { createClient, RealtimeChannel } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://imkfbalgviqeotpjogff.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlta2ZiYWxndmlxZW90cGpvZ2ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0NjE2NjYsImV4cCI6MjA4MDAzNzY2Nn0.POv8NbJu6TefE1e-J-9L8m5QTSp41XXwsO2ck69GnYc'

// Create Supabase client with OPTIMIZED settings for PWA/mobile
// REDUCED heartbeat to decrease server load (was causing 2.6M+ queries)
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Storage key for session persistence
    storageKey: 'nephtys-auth',
  },
  realtime: {
    params: {
      // OPTIMIZED heartbeat interval - 30 seconds (WhatsApp uses ~30s)
      // Previous 5 second heartbeat was too aggressive and caused excessive load
      heartbeat_interval: 30,
      // Increase timeout to reduce reconnection attempts
      timeout: 60000, // 60 seconds
    },
  },
  global: {
    headers: {
      'x-client-info': 'nephtys-pwa',
    },
  },
})

// Connection state tracking
let isRealtimeConnected = false
let connectionCheckInterval: NodeJS.Timeout | null = null
let pingInterval: NodeJS.Timeout | null = null
let lastSuccessfulQuery = Date.now()
let consecutiveFailures = 0
const MAX_CONSECUTIVE_FAILURES = 2

// Track connection state
export function getRealtimeConnectionState(): boolean {
  return isRealtimeConnected
}

// Update last successful query time
export function updateLastSuccessfulQuery(): void {
  lastSuccessfulQuery = Date.now()
  consecutiveFailures = 0 // Reset failures on success
  
  // Dispatch event to notify keep-alive system that connection is healthy
  // This prevents unnecessary force reloads
  window.dispatchEvent(new CustomEvent('supabase-connection-success'))
}

// Get time since last successful query
export function getTimeSinceLastQuery(): number {
  return Date.now() - lastSuccessfulQuery
}

// Check if connection seems stale (no successful query in last 60 seconds)
// Increased from 30s to reduce unnecessary health checks
export function isConnectionStale(): boolean {
  return getTimeSinceLastQuery() > 60000
}

// Force reconnect all realtime channels
export async function forceReconnectRealtime(): Promise<void> {
  console.log('[Supabase] Force reconnecting realtime channels...')
  
  try {
    const channels = supabase.getChannels()
    
    // Reconnect each channel
    for (const channel of channels) {
      try {
        await channel.unsubscribe()
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log(`[Supabase] Channel ${channel.topic} reconnected`)
            isRealtimeConnected = true
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`[Supabase] Channel ${channel.topic} error: ${status}`)
            isRealtimeConnected = false
          }
        })
      } catch (e) {
        console.error(`[Supabase] Error reconnecting channel ${channel.topic}:`, e)
      }
    }
  } catch (error) {
    console.error('[Supabase] Error in forceReconnectRealtime:', error)
  }
}

// Simple health check - try a lightweight query with SHORT timeout
export async function checkConnection(): Promise<boolean> {
  try {
    const start = Date.now()
    
    // Use Promise.race for timeout
    const queryPromise = supabase
      .from('profiles')
      .select('id')
      .limit(1)
      .maybeSingle()
    
    const timeoutPromise = new Promise<{ error: { message: string } }>((_, reject) =>
      setTimeout(() => reject(new Error('Health check timeout')), 5000)
    )
    
    const { error } = await Promise.race([queryPromise, timeoutPromise])
    
    const duration = Date.now() - start
    
    if (error) {
      console.warn('[Supabase] Health check failed:', error.message)
      consecutiveFailures++
      return false
    }
    
    console.log(`[Supabase] Health check OK (${duration}ms)`)
    updateLastSuccessfulQuery()
    return true
  } catch (error: any) {
    console.error('[Supabase] Health check error:', error.message || error)
    consecutiveFailures++
    return false
  }
}

// Lightweight ping to keep connection alive - REMOVED to reduce load
// The Realtime heartbeat (30s) already keeps the connection alive
async function pingConnection(): Promise<void> {
  // This function is kept for compatibility but no longer called automatically
  if (document.hidden) return
  
  try {
    // Just do a simple count query - very lightweight
    const { count, error } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .limit(0)
    
    if (!error) {
      updateLastSuccessfulQuery()
    }
  } catch (e) {
    // Ignore ping errors - the health check will catch real issues
  }
}

// Start connection monitoring (call this once when app starts)
// OPTIMIZED: Removed aggressive pings - use only stale connection detection
export function startConnectionMonitoring(): void {
  if (connectionCheckInterval) {
    return // Already monitoring
  }
  
  console.log('[Supabase] Starting OPTIMIZED connection monitoring...')
  
  // REMOVED: Aggressive ping every 10 seconds was causing too many requests
  // The Realtime heartbeat (now 30s) already keeps the WebSocket alive
  
  // Check connection every 60 seconds instead of 10s
  // Only do health check when there's a suspected issue
  connectionCheckInterval = setInterval(async () => {
    // Only check if document is visible
    if (document.hidden) {
      return
    }
    
    // If connection seems stale OR we have consecutive failures, do a health check
    if (isConnectionStale() || consecutiveFailures > 0) {
      console.log(`[Supabase] Connection check (stale: ${isConnectionStale()}, failures: ${consecutiveFailures})`)
      const isOk = await checkConnection()
      
      if (!isOk && consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.log('[Supabase] Connection lost after multiple failures, triggering reconnect...')
        consecutiveFailures = 0 // Reset to avoid spam
        // Dispatch event for components to refresh
        window.dispatchEvent(new CustomEvent('supabase-connection-lost'))
        // Try to reconnect realtime
        await forceReconnectRealtime()
      }
    }
  }, 60000)
}

// Stop connection monitoring
export function stopConnectionMonitoring(): void {
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval)
    connectionCheckInterval = null
  }
  if (pingInterval) {
    clearInterval(pingInterval)
    pingInterval = null
  }
}

// Wrapper for queries that updates the last successful query time
export async function queryWithTracking<T>(
  queryFn: () => Promise<{ data: T | null; error: any }>
): Promise<{ data: T | null; error: any }> {
  const result = await queryFn()
  if (!result.error) {
    updateLastSuccessfulQuery()
  } else {
    consecutiveFailures++
    // If we have too many failures, trigger reconnect
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.log('[Supabase] Query failed, triggering reconnect...')
      window.dispatchEvent(new CustomEvent('supabase-connection-lost'))
    }
  }
  return result
}

// Database types
export interface Profile {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  session_id: string
  public_key: string | null
  created_at: string
  updated_at: string
  // Online presence fields
  is_online?: boolean
  last_seen?: string | null
}

export interface Conversation {
  id: string
  type: 'direct' | 'group'
  name: string | null
  avatar_url: string | null
  description: string | null
  created_by: string
  created_at: string
  updated_at: string
  last_message_at: string | null
  is_encrypted: boolean
  encryption_protocol: string
  is_archived: boolean
  is_pinned: boolean
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  content: string
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'call' | 'system'
  status: 'sent' | 'delivered' | 'read'
  reply_to_id: string | null
  file_url: string | null
  file_name: string | null
  file_size: number | null
  media_url: string | null
  media_type: 'image' | 'video' | 'file' | null
  media_width?: number | null // Image/video width in pixels
  media_height?: number | null // Image/video height in pixels
  media_thumbnail?: string | null // Base64 blur placeholder for images
  is_ephemeral: boolean
  ephemeral_duration: number | null
  ephemeral_expires_at: string | null
  encryption_metadata: any
  created_at: string
  updated_at: string
  deleted_at: string | null
  is_pinned: boolean
  pinned_at: string | null
  pinned_until: string | null
  is_starred: boolean
  edited_at: string | null
  is_edited: boolean
  link_preview: string | null // JSON string containing LinkPreviewData
}

export interface Contact {
  id: string
  user_id: string
  contact_user_id: string
  nickname: string | null
  is_favorite: boolean
  is_blocked: boolean
  added_at: string
}

export interface Status {
  id: string
  user_id: string
  type: 'text' | 'image' | 'video'
  content: string | null
  media_url: string | null
  background_color: string | null
  created_at: string
  expires_at: string
  views_count: number
  is_private: boolean
}

export interface Device {
  id: string
  user_id: string
  device_name: string
  device_type: 'mobile' | 'desktop' | 'tablet' | 'web'
  device_fingerprint: string
  public_key: string | null
  last_active_at: string
  created_at: string
  is_verified: boolean
}

export interface DeletedMessage {
  id: string
  message_id: string
  user_id: string
  deleted_at: string
}

// ============================================================================
// BROADCAST CHANNEL HELPERS - For ultra-low-latency real-time messaging
// ============================================================================

/**
 * Create a broadcast channel for instant message delivery (WhatsApp-level speed)
 * Broadcast is ephemeral and doesn't persist to DB - used for instant delivery
 * while postgres_changes handles persistence
 */
export function createBroadcastChannel(conversationId: string, userId: string) {
  return supabase.channel(`broadcast:${conversationId}`, {
    config: {
      broadcast: { self: false }, // Don't send to self via broadcast
      presence: { key: userId }
    }
  })
}

/**
 * Send a message via broadcast for instant delivery to other clients
 * This provides 20-50ms latency vs 200-2000ms with postgres_changes alone
 */
export async function sendBroadcastMessage(
  conversationId: string,
  message: Message
): Promise<void> {
  const channel = supabase.channel(`broadcast:${conversationId}`)
  
  await channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      channel.send({
        type: 'broadcast',
        event: 'message',
        payload: { message }
      })
      // Unsubscribe after sending to avoid keeping the channel open
      channel.unsubscribe()
    }
  })
}

/**
 * Listen for broadcast messages from other clients
 * This provides instant message delivery without waiting for database replication
 */
export function onBroadcastMessage(
  conversationId: string,
  callback: (message: Message) => void
) {
  const channel = supabase.channel(`broadcast-listener:${conversationId}`)
  
  channel.on('broadcast', { event: 'message' }, ({ payload }) => {
    if (payload?.message) {
      callback(payload.message as Message)
    }
  })
  
  channel.subscribe()
  
  return () => {
    channel.unsubscribe()
  }
}
