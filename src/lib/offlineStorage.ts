// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// Offline Storage with IndexedDB + localStorage
// Permet de stocker les messages localement pour le mode hors ligne
// Optimized for PWA performance with non-blocking initialization
// Uses localStorage as a fast synchronous cache layer for instant display

const DB_NAME = 'nephtys-offline-db';
const DB_VERSION = 2; // Incremented for profiles store
const MESSAGES_STORE = 'messages';
const CONVERSATIONS_STORE = 'conversations';
const PENDING_STORE = 'pending-messages';
const PROFILES_STORE = 'profiles';

// localStorage keys for instant cache (survives page refresh)
const LS_CONVERSATIONS_KEY = 'nephtys_conversations_cache';
const LS_CONVERSATIONS_TIMESTAMP_KEY = 'nephtys_conversations_cache_ts';
const LS_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours max cache age

// Timeout for IndexedDB operations
const DB_TIMEOUT = 3000;

export interface OfflineMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  type: string;
  created_at: string;
  status: string;
  media_url?: string;
  media_type?: string;
  file_name?: string;
  file_size?: number;
  reply_to_id?: string;
  is_ephemeral?: boolean;
  ephemeral_duration?: number;
  ephemeral_expires_at?: string;
}

// Profile for offline caching (mirrors Profile from supabase.ts)
interface CachedProfile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  session_id: string;
  public_key: string | null;
  created_at: string;
  updated_at: string;
}

interface PendingMessage {
  tempId: string;
  conversation_id: string;
  content: string;
  type: string;
  created_at: string;
  media_url?: string;
  media_type?: string;
  reply_to_id?: string;
}

class OfflineStorage {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private isInitialized = false;
  private initFailed = false;

  // In-memory cache for instant access (survives navigation, not page refresh)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly memoryCache: {
    conversations: any[] | null;
    messages: Map<string, any[]>;
    profiles: Map<string, CachedProfile>;
  } = {
    conversations: null,
    messages: new Map(),
    profiles: new Map()
  };

  constructor() {
    // Load from localStorage immediately (synchronous, survives page refresh)
    this.loadFromLocalStorage();
    
    // Don't start async initialization in constructor - use lazy initialization instead
    // Initialization will happen on first async operation
  }

  // Lazy initialization - called on first async operation
  private async ensureInitialized(): Promise<boolean> {
    if (this.initPromise !== null) {
      await this.initPromise;
      return this.isInitialized && this.db !== null;
    }
    
    this.initPromise = this.init().catch(() => {
      this.initFailed = true;
    });
    
    await this.initPromise;
    return this.isInitialized && this.db !== null;
  }
  
  // Load conversations from localStorage (synchronous, instant)
  private loadFromLocalStorage(): void {
    try {
      const timestampStr = localStorage.getItem(LS_CONVERSATIONS_TIMESTAMP_KEY);
      if (!timestampStr) {
        return;
      }
      
      const timestamp = Number.parseInt(timestampStr, 10);
      const age = Date.now() - timestamp;
      
      // Check if cache is too old
      if (age > LS_CACHE_MAX_AGE) {
        localStorage.removeItem(LS_CONVERSATIONS_KEY);
        localStorage.removeItem(LS_CONVERSATIONS_TIMESTAMP_KEY);
        return;
      }
      
      const cached = localStorage.getItem(LS_CONVERSATIONS_KEY);
      if (cached) {
        const conversations = JSON.parse(cached);
        if (Array.isArray(conversations) && conversations.length > 0) {
          this.memoryCache.conversations = conversations;
        }
      }
    } catch {
      // Clear corrupted cache
      try {
        localStorage.removeItem(LS_CONVERSATIONS_KEY);
        localStorage.removeItem(LS_CONVERSATIONS_TIMESTAMP_KEY);
      } catch (e) {
        console.error('Error clearing localStorage:', e);
      }
    }
  }
  
  // Save conversations to localStorage (for instant load on page refresh)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private saveToLocalStorage(conversations: any[]): void {
    try {
      // Only save essential data to keep localStorage small
      // Strip out large fields like lastMessage content to save space
      const minimalConversations = conversations.map(conv => ({
        id: conv.id,
        type: conv.type,
        name: conv.name,
        avatar_url: conv.avatar_url,
        last_message_at: conv.last_message_at,
        is_pinned: conv.is_pinned,
        is_muted: conv.is_muted,
        unreadCount: conv.unreadCount,
        // Keep profile info for instant display (no "Utilisateur" flash)
        otherUserProfile: conv.otherUserProfile ? {
          id: conv.otherUserProfile.id,
          username: conv.otherUserProfile.username,
          display_name: conv.otherUserProfile.display_name,
          avatar_url: conv.otherUserProfile.avatar_url
        } : undefined,
        // Keep minimal last message info
        lastMessage: conv.lastMessage ? {
          id: conv.lastMessage.id,
          type: conv.lastMessage.type,
          content: conv.lastMessage.content?.substring(0, 100), // Truncate content
          created_at: conv.lastMessage.created_at,
          sender_id: conv.lastMessage.sender_id
        } : undefined
      }));
      
      const json = JSON.stringify(minimalConversations);
      
      // Check size (localStorage has ~5MB limit)
      if (json.length > 2 * 1024 * 1024) { // 2MB limit for safety
        return;
      }
      
      localStorage.setItem(LS_CONVERSATIONS_KEY, json);
      localStorage.setItem(LS_CONVERSATIONS_TIMESTAMP_KEY, Date.now().toString());
    } catch (error) {
      // If quota exceeded, clear old cache
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        try {
          localStorage.removeItem(LS_CONVERSATIONS_KEY);
          localStorage.removeItem(LS_CONVERSATIONS_TIMESTAMP_KEY);
        } catch (e) {
          console.error('Error clearing localStorage:', e);
        }
      }
    }
  }

  async init(): Promise<void> {
    // If already initialized, return immediately
    if (this.isInitialized && this.db) {
      return;
    }

    // Check if IndexedDB is available
    if (!('indexedDB' in globalThis)) {
      this.initFailed = true;
      return;
    }

    return new Promise((resolve, reject) => {
      // Add timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        this.initFailed = true;
        resolve(); // Don't reject, just mark as failed
      }, DB_TIMEOUT);

      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          clearTimeout(timeoutId);
          this.initFailed = true;
          resolve(); // Don't reject, just mark as failed
        };

        request.onsuccess = () => {
          clearTimeout(timeoutId);
          this.db = request.result;
          this.isInitialized = true;
          resolve();
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          // Create messages store
          if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
            const messagesStore = db.createObjectStore(MESSAGES_STORE, { keyPath: 'id' });
            messagesStore.createIndex('conversation_id', 'conversation_id', { unique: false });
            messagesStore.createIndex('created_at', 'created_at', { unique: false });
          }

          // Create conversations store
          if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
            db.createObjectStore(CONVERSATIONS_STORE, { keyPath: 'id' });
          }

          // Create pending messages store (for offline sending)
          if (!db.objectStoreNames.contains(PENDING_STORE)) {
            const pendingStore = db.createObjectStore(PENDING_STORE, { keyPath: 'tempId' });
            pendingStore.createIndex('conversation_id', 'conversation_id', { unique: false });
          }

          // Create profiles store for caching user profiles
          if (!db.objectStoreNames.contains(PROFILES_STORE)) {
            const profilesStore = db.createObjectStore(PROFILES_STORE, { keyPath: 'id' });
            profilesStore.createIndex('username', 'username', { unique: false });
          }
        };

        // Handle blocked event (when another tab has the DB open with older version)
        request.onblocked = () => {
          clearTimeout(timeoutId);
          this.initFailed = true;
          resolve();
        };
      } catch (error) {
        console.error('Error in IndexedDB init:', error);
        clearTimeout(timeoutId);
        this.initFailed = true;
        resolve();
      }
    });
  }

  // Ensure DB is ready before operations - uses lazy initialization
  private async ensureReady(): Promise<boolean> {
    if (this.initFailed) {
      return false;
    }
    
    return this.ensureInitialized();
  }

  // Messages operations
  async saveMessage(message: OfflineMessage): Promise<void> {
    const ready = await this.ensureReady();
    if (!ready) {
      return;
    }
    
    return new Promise((resolve) => {
      const transaction = this.db!.transaction([MESSAGES_STORE], 'readwrite');
      const store = transaction.objectStore(MESSAGES_STORE);
      const request = store.put(message);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        resolve(); // Don't reject, just log
      };
    });
  }

  async saveMessages(messages: OfflineMessage[]): Promise<void> {
    // Update memory cache immediately
    if (messages.length > 0) {
      const conversationId = messages[0].conversation_id;
      const current = this.memoryCache.messages.get(conversationId) || [];
      
      // Merge new messages with existing ones, avoiding duplicates
      const existingIds = new Set(current.map(m => m.id));
      const newMessages = messages.filter(m => !existingIds.has(m.id));
      
      if (newMessages.length > 0) {
        const updated = [...current, ...newMessages].sort((a, b) => 
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        this.memoryCache.messages.set(conversationId, updated);
      }
    }

    const ready = await this.ensureReady();
    if (!ready) {
      return;
    }
    
    return new Promise((resolve) => {
      const transaction = this.db!.transaction([MESSAGES_STORE], 'readwrite');
      const store = transaction.objectStore(MESSAGES_STORE);

      messages.forEach(message => store.put(message));

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        resolve();
      };
    });
  }

  async getMessages(conversationId: string): Promise<OfflineMessage[]> {
    // Check memory cache first (instant)
    if (this.memoryCache.messages.has(conversationId)) {
      return this.memoryCache.messages.get(conversationId)!;
    }

    const ready = await this.ensureReady();
    if (!ready) {
      return [];
    }
    
    return new Promise((resolve) => {
      const transaction = this.db!.transaction([MESSAGES_STORE], 'readonly');
      const store = transaction.objectStore(MESSAGES_STORE);
      const index = store.index('conversation_id');
      const request = index.getAll(conversationId);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => {
        resolve([]);
      };
    });
  }

  async deleteMessage(messageId: string): Promise<void> {
    const ready = await this.ensureReady();
    if (!ready) {
      return;
    }
    
    return new Promise((resolve) => {
      const transaction = this.db!.transaction([MESSAGES_STORE], 'readwrite');
      const store = transaction.objectStore(MESSAGES_STORE);
      const request = store.delete(messageId);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        resolve();
      };
    });
  }

  // Pending messages operations (for offline sending)
  async savePendingMessage(message: PendingMessage): Promise<void> {
    const ready = await this.ensureReady();
    if (!ready) {
      return;
    }
    
    return new Promise((resolve) => {
      const transaction = this.db!.transaction([PENDING_STORE], 'readwrite');
      const store = transaction.objectStore(PENDING_STORE);
      const request = store.put(message);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        resolve();
      };
    });
  }

  async getPendingMessages(): Promise<PendingMessage[]> {
    const ready = await this.ensureReady();
    if (!ready) {
      return [];
    }
    
    return new Promise((resolve) => {
      const transaction = this.db!.transaction([PENDING_STORE], 'readonly');
      const store = transaction.objectStore(PENDING_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => {
        resolve([]);
      };
    });
  }

  async deletePendingMessage(tempId: string): Promise<void> {
    const ready = await this.ensureReady();
    if (!ready) {
      return;
    }
    
    return new Promise((resolve) => {
      const transaction = this.db!.transaction([PENDING_STORE], 'readwrite');
      const store = transaction.objectStore(PENDING_STORE);
      const request = store.delete(tempId);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        resolve();
      };
    });
  }

  // Conversations operations
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async saveConversation(conversation: any): Promise<void> {
    const ready = await this.ensureReady();
    if (!ready) {
      return;
    }
    
    return new Promise((resolve) => {
      const transaction = this.db!.transaction([CONVERSATIONS_STORE], 'readwrite');
      const store = transaction.objectStore(CONVERSATIONS_STORE);
      const request = store.put(conversation);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        resolve();
      };
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async saveConversations(conversations: any[]): Promise<void> {
    // Always update memory cache immediately (instant)
    this.memoryCache.conversations = conversations;
    
    // Also save to localStorage for instant load on page refresh
    // This is synchronous and survives page refresh
    this.saveToLocalStorage(conversations);
    
    const ready = await this.ensureReady();
    if (!ready) {
      return;
    }
    
    return new Promise((resolve) => {
      const transaction = this.db!.transaction([CONVERSATIONS_STORE], 'readwrite');
      const store = transaction.objectStore(CONVERSATIONS_STORE);

      // Clear existing conversations first to ensure fresh data
      store.clear();

      // Add all new conversations
      conversations.forEach(conversation => store.put(conversation));

      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        resolve();
      };
    });
  }

  // Synchronous method to get conversations from memory cache (instant)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getConversationsSync(): any[] | null {
    return this.memoryCache.conversations;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getConversations(): Promise<any[]> {
    // First, check memory cache (instant)
    if (this.memoryCache.conversations !== null) {
      return this.memoryCache.conversations;
    }
    
    const ready = await this.ensureReady();
    if (!ready) {
      return [];
    }
    
    return new Promise((resolve) => {
      const transaction = this.db!.transaction([CONVERSATIONS_STORE], 'readonly');
      const store = transaction.objectStore(CONVERSATIONS_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const result = request.result || [];
        // Update memory cache
        this.memoryCache.conversations = result;
        resolve(result);
      };
      request.onerror = () => {
        resolve([]);
      };
    });
  }

  // Clear all data
  async clearAll(): Promise<void> {
    // Clear memory cache
    this.memoryCache.conversations = null;
    this.memoryCache.messages.clear();
    
    // Clear localStorage cache
    try {
      localStorage.removeItem(LS_CONVERSATIONS_KEY);
      localStorage.removeItem(LS_CONVERSATIONS_TIMESTAMP_KEY);
    } catch (e) {
      console.error('Error clearing localStorage:', e);
    }
    
    const ready = await this.ensureReady();
    if (!ready) {
      return;
    }
    
    return new Promise((resolve) => {
      const transaction = this.db!.transaction(
        [MESSAGES_STORE, CONVERSATIONS_STORE, PENDING_STORE],
        'readwrite'
      );

      transaction.objectStore(MESSAGES_STORE).clear();
      transaction.objectStore(CONVERSATIONS_STORE).clear();
      transaction.objectStore(PENDING_STORE).clear();

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        resolve();
      };
    });
  }

  // Check if storage is available
  isAvailable(): boolean {
    return this.isInitialized && !this.initFailed && this.db !== null;
  }

  // ==================== PROFILE CACHING ====================
  // Cache profiles for instant access - avoids network requests

  /**
   * Cache multiple profiles in IndexedDB
   * Call this when loading conversation data to enable instant profile display
   */
  async cacheProfiles(profiles: CachedProfile[]): Promise<void> {
    if (!profiles || profiles.length === 0) return;
    
    // Update memory cache immediately (instant access)
    profiles.forEach(profile => {
      this.memoryCache.profiles.set(profile.id, profile);
    });
    
    const ready = await this.ensureReady();
    if (!ready) {
      return;
    }
    
    return new Promise((resolve) => {
      const transaction = this.db!.transaction([PROFILES_STORE], 'readwrite');
      const store = transaction.objectStore(PROFILES_STORE);

      profiles.forEach(profile => store.put(profile));

      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        resolve();
      };
    });
  }

  /**
   * Get a single profile from cache (instant)
   * Use this BEFORE making Supabase queries for profiles
   */
  getCachedProfile(userId: string): CachedProfile | null {
    // First check memory cache (fastest)
    if (this.memoryCache.profiles.has(userId)) {
      return this.memoryCache.profiles.get(userId)!;
    }
    return null;
  }

  /**
   * Get multiple profiles from cache in batch (instant)
   * Returns a map of userId -> profile
   */
  getCachedProfiles(userIds: string[]): Map<string, CachedProfile> {
    const result = new Map<string, CachedProfile>();
    
    for (const userId of userIds) {
      const profile = this.getCachedProfile(userId);
      if (profile) {
        result.set(userId, profile);
      }
    }
    
    return result;
  }

  /**
   * Get a single profile from IndexedDB (async fallback)
   */
  async getProfileFromDB(userId: string): Promise<CachedProfile | null> {
    // Check memory cache first
    if (this.memoryCache.profiles.has(userId)) {
      return this.memoryCache.profiles.get(userId)!;
    }
    
    const ready = await this.ensureReady();
    if (!ready) return null;
    
    return new Promise((resolve) => {
      const transaction = this.db!.transaction([PROFILES_STORE], 'readonly');
      const store = transaction.objectStore(PROFILES_STORE);
      const request = store.get(userId);

      request.onsuccess = () => {
        if (request.result) {
          // Update memory cache
          this.memoryCache.profiles.set(userId, request.result);
        }
        resolve(request.result || null);
      };
      request.onerror = () => resolve(null);
    });
  }

  /**
   * Get multiple profiles from IndexedDB in batch
   */
  async getProfilesFromDB(userIds: string[]): Promise<Map<string, CachedProfile>> {
    const result = new Map<string, CachedProfile>();
    
    // First check memory cache
    for (const userId of userIds) {
      if (this.memoryCache.profiles.has(userId)) {
        result.set(userId, this.memoryCache.profiles.get(userId)!);
      }
    }
    
    // Find missing IDs
    const missingIds = userIds.filter(id => !result.has(id));
    if (missingIds.length === 0) return result;
    
    const ready = await this.ensureReady();
    if (!ready) return result;
    
    return new Promise((resolve) => {
      const transaction = this.db!.transaction([PROFILES_STORE], 'readonly');
      const store = transaction.objectStore(PROFILES_STORE);
      
      let completed = 0;
      
      for (const userId of missingIds) {
        const request = store.get(userId);
        request.onsuccess = () => {
          if (request.result) {
            result.set(userId, request.result);
            // Update memory cache
            this.memoryCache.profiles.set(userId, request.result);
          }
          completed++;
          if (completed === missingIds.length) {
            resolve(result);
          }
        };
        request.onerror = () => {
          completed++;
          if (completed === missingIds.length) {
            resolve(result);
          }
        };
      }
    });
  }
}

export const offlineStorage = new OfflineStorage();
