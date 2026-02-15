// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// Preload conversation data when user hovers over a conversation item
// This enables instant display when clicking (WhatsApp-like behavior)

import { supabase } from './supabase'
import { cacheConversation, cacheMessages, cacheProfile, getCachedConversation, getCachedMessages } from './localCache'
import type { Conversation, Message, Profile } from './supabase'

// Track which conversations are being preloaded to avoid duplicates
const preloadingConversations = new Set<string>()

// Preload all data for a conversation (conversation + messages + profiles)
export const preloadConversationData = async (
  conversationId: string,
  currentUserId?: string
): Promise<void> => {
  // Skip if already preloading or cached
  if (preloadingConversations.has(conversationId)) {
    return
  }
  
  // Check if already fully cached
  const cachedConv = await getCachedConversation(conversationId)
  const cachedMsgs = await getCachedMessages(conversationId)
  if (cachedConv && cachedMsgs.length > 0) {
    console.log('[Preload] Conversation already cached:', conversationId)
    return
  }
  
  preloadingConversations.add(conversationId)
  
  try {
    console.log('[Preload] Starting preload for:', conversationId)
    
    // Fetch conversation data
    const { data: conversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .maybeSingle()
    
    if (conversation) {
      await cacheConversation(conversation)
      
      // Fetch messages for this conversation
      const { data: messages } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(100)
      
      if (messages) {
        await cacheMessages(messages, conversationId)
      }
      
      // Fetch profiles for group members or direct chat user
      if (conversation.type === 'group') {
        const { data: members } = await supabase
          .from('conversation_members')
          .select('user_id')
          .eq('conversation_id', conversationId)
        
        if (members && members.length > 0) {
          const memberIds = members.map(m => m.user_id)
          const { data: profiles } = await supabase
            .from('profiles')
            .select('*')
            .in('id', memberIds)
          
          if (profiles) {
            await Promise.all(profiles.map(p => cacheProfile(p)))
          }
        }
      } else if (conversation.type === 'direct' && currentUserId) {
        // For direct chats, find the other user
        const { data: members } = await supabase
          .from('conversation_members')
          .select('user_id')
          .eq('conversation_id', conversationId)
          .neq('user_id', currentUserId)
        
        if (members && members.length > 0) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', members[0].user_id)
            .maybeSingle()
          
          if (profile) {
            await cacheProfile(profile)
          }
        }
      }
      
      console.log('[Preload] Completed for:', conversationId)
    }
  } catch (error) {
    console.error('[Preload] Error:', error)
  } finally {
    preloadingConversations.delete(conversationId)
  }
}

// Create a hover handler for conversation items
export const createHoverPreloader = (currentUserId?: string) => {
  let hoverTimeout: NodeJS.Timeout | null = null
  
  return {
    // Start preloading after hover delay (150ms to avoid triggering on quick scrolls)
    onMouseEnter: (conversationId: string) => {
      hoverTimeout = setTimeout(() => {
        preloadConversationData(conversationId, currentUserId)
      }, 150)
    },
    
    // Cancel preloading if user moves away quickly
    onMouseLeave: () => {
      if (hoverTimeout) {
        clearTimeout(hoverTimeout)
        hoverTimeout = null
      }
    },
    
    // Cleanup on unmount
    cleanup: () => {
      if (hoverTimeout) {
        clearTimeout(hoverTimeout)
        hoverTimeout = null
      }
    }
  }
}

// Preload multiple conversations in parallel (for initial app load)
export const preloadAllConversations = async (
  conversations: Conversation[],
  currentUserId?: string
): Promise<void> => {
  // Preload first 5 conversations in parallel
  const toPreload = conversations.slice(0, 5)
  await Promise.all(
    toPreload.map(conv => preloadConversationData(conv.id, currentUserId))
  )
}
