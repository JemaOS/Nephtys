// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// Local-first cache using IndexedDB for instant data display
// Similar to WhatsApp - data is stored locally and synced in background

import { openDB, DBSchema, IDBPDatabase } from 'idb'
import type { Message, Conversation, Profile } from '@/lib/supabase'

interface NephtysDB extends DBSchema {
  conversations: {
    key: string
    value: Conversation & { lastRead?: number }
    indexes: { 'by-updated': string }
  }
  messages: {
    key: string
    value: Message & { conversationId: string }
    indexes: { 'by-conversation': string; 'by-created': string }
  }
  profiles: {
    key: string
    value: Profile & { lastRead?: number }
  }
  cache: {
    key: string
    value: { data: any; timestamp: number }
  }
}

let dbPromise: Promise<IDBPDatabase<NephtysDB>> | null = null

const getDB = async (): Promise<IDBPDatabase<NephtysDB>> => {
  if (!dbPromise) {
    dbPromise = openDB<NephtysDB>('nephtys-cache', 1, {
      upgrade(db) {
        // Conversations store
        if (!db.objectStoreNames.contains('conversations')) {
          const convStore = db.createObjectStore('conversations', { keyPath: 'id' })
          convStore.createIndex('by-updated', 'last_message_at')
        }
        
        // Messages store
        if (!db.objectStoreNames.contains('messages')) {
          const msgStore = db.createObjectStore('messages', { keyPath: 'id' })
          msgStore.createIndex('by-conversation', 'conversation_id')
          msgStore.createIndex('by-created', 'created_at')
        }
        
        // Profiles store
        if (!db.objectStoreNames.contains('profiles')) {
          db.createObjectStore('profiles', { keyPath: 'id' })
        }
        
        // Generic cache store
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache')
        }
      },
    })
  }
  return dbPromise
}

// Conversation cache operations
export const cacheConversation = async (conversation: Conversation): Promise<void> => {
  const db = await getDB()
  await db.put('conversations', { ...conversation, lastRead: Date.now() })
}

export const getCachedConversation = async (id: string): Promise<Conversation | undefined> => {
  const db = await getDB()
  return db.get('conversations', id)
}

export const getAllCachedConversations = async (): Promise<Conversation[]> => {
  const db = await getDB()
  return db.getAll('conversations')
}

// Message cache operations
export const cacheMessages = async (messages: Message[], conversationId: string): Promise<void> => {
  const db = await getDB()
  const tx = db.transaction('messages', 'readwrite')
  await Promise.all([
    ...messages.map(msg => tx.store.put({ ...msg, conversationId })),
    tx.done
  ])
}

export const getCachedMessages = async (conversationId: string): Promise<Message[]> => {
  const db = await getDB()
  const messages = await db.getAllFromIndex('messages', 'by-conversation', conversationId)
  return messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}

// Profile cache operations
export const cacheProfile = async (profile: Profile): Promise<void> => {
  const db = await getDB()
  await db.put('profiles', { ...profile, lastRead: Date.now() })
}

export const getCachedProfile = async (id: string): Promise<Profile | undefined> => {
  const db = await getDB()
  return db.get('profiles', id)
}

export const cacheProfiles = async (profiles: Profile[]): Promise<void> => {
  const db = await getDB()
  const tx = db.transaction('profiles', 'readwrite')
  await Promise.all([
    ...profiles.map(p => tx.store.put({ ...p, lastRead: Date.now() })),
    tx.done
  ])
}

// Generic cache operations
export const setCacheData = async (key: string, data: any): Promise<void> => {
  const db = await getDB()
  await db.put('cache', { data, timestamp: Date.now() })
}

export const getCacheData = async <T>(key: string, maxAge = 5 * 60 * 1000): Promise<T | null> => {
  const db = await getDB()
  const cached = await db.get('cache', key)
  if (cached && Date.now() - cached.timestamp < maxAge) {
    return cached.data as T
  }
  return null
}

// Preload all essential data for instant display
export const preloadEssentialData = async (
  fetchConversations: () => Promise<Conversation[]>,
  fetchProfile: (id: string) => Promise<Profile | null>
): Promise<void> => {
  try {
    // Fetch and cache all conversations
    const conversations = await fetchConversations()
    await Promise.all(conversations.map(c => cacheConversation(c)))
    
    // Cache current user profile
    const { data: { user } } = await import('@/lib/supabase').then(m => m.supabase.auth.getUser())
    if (user) {
      const profile = await fetchProfile(user.id)
      if (profile) {
        await cacheProfile(profile)
      }
    }
    
    // Pre-cache profiles for all conversation members
    const memberIds = new Set<string>()
    for (const conv of conversations) {
      if (conv.type === 'direct') {
        // For direct chats, we need the other user ID
        // This will be fetched when opening the conversation
      }
    }
    
    console.log('[LocalCache] Preloaded essential data:', conversations.length, 'conversations')
  } catch (error) {
    console.error('[LocalCache] Error preloading data:', error)
  }
}

// Clear all cached data
export const clearCache = async (): Promise<void> => {
  const db = await getDB()
  await Promise.all([
    db.clear('conversations'),
    db.clear('messages'),
    db.clear('profiles'),
    db.clear('cache'),
  ])
}
