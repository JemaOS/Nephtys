// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// Offline Storage with IndexedDB + localStorage
// Permet de stocker les messages localement pour le mode hors ligne
// Optimized for PWA performance with non-blocking initialization
// Uses localStorage as a fast synchronous cache layer for instant display

const DB_NAME = 'nephtys-offline-db';
const DB_VERSION = 1;
const MESSAGES_STORE = 'messages';
const CONVERSATIONS_STORE = 'conversations';
const PENDING_STORE = 'pending-messages';

// localStorage keys for instant cache (survives page refresh)
const LS_CONVERSATIONS_KEY = 'nephtys_conversations_cache';
const LS_CONVERSATIONS_TIMESTAMP_KEY = 'nephtys_conversations_cache_ts';
const LS_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours max cache age

// Timeout for IndexedDB operations
const DB_TIMEOUT = 3000;

interface OfflineMessage {
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
  private memoryCache: {
    conversations: any[] | null;
    messages: Map<string, any[]>;
  } = {
    conversations: null,
    messages: new Map()
  };

  constructor() {
    // Load from localStorage immediately (synchronous, survives page refresh)
    this.loadFromLocalStorage();
    
    // Don't start async initialization in constructor - use lazy initialization instead
    // Initialization will happen on first async operation
  }

  // Lazy initialization - called on first async operation
  private async ensureInitialized(): Promise<boolean> {
    if (this.initPromise) {
      return this.initPromise.then(() => this.isInitialized && this.db !== null);
    }
    
    this.initPromise = this.init().catch((error) => {
      console.warn('[OfflineStorage] Initialization failed:', error);
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
        console.log('[OfflineStorage] No localStorage cache found');
        return;
      }
      
      const timestamp = parseInt(timestampStr, 10);
      const age = Date.now() - timestamp;
      
      // Check if cache is too old
      if (age > LS_CACHE_MAX_AGE) {
        console.log('[OfflineStorage] localStorage cache expired, clearing');
        localStorage.removeItem(LS_CONVERSATIONS_KEY);
        localStorage.removeItem(LS_CONVERSATIONS_TIMESTAMP_KEY);
        return;
      }
      
      const cached = localStorage.getItem(LS_CONVERSATIONS_KEY);
      if (cached) {
        const conversations = JSON.parse(cached);
        if (Array.isArray(conversations) && conversations.length > 0) {
          this.memoryCache.conversations = conversations;
          console.log(`[OfflineStorage] Loaded ${conversations.length} conversations from localStorage (age: ${Math.round(age / 1000)}s)`);
        }
      }
    } catch (error) {
      console.warn('[OfflineStorage] Error loading from localStorage:', error);
      // Clear corrupted cache
      try {
        localStorage.removeItem(LS_CONVERSATIONS_KEY);
        localStorage.removeItem(LS_CONVERSATIONS_TIMESTAMP_KEY);
      } catch (e) {
        // Ignore
      }
    }
  }
  
  // Save conversations to localStorage (for instant load on page refresh)
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
        console.warn('[OfflineStorage] Conversations too large for localStorage, skipping');
        return;
      }
      
      localStorage.setItem(LS_CONVERSATIONS_KEY, json);
      localStorage.setItem(LS_CONVERSATIONS_TIMESTAMP_KEY, Date.now().toString());
      console.log(`[OfflineStorage] Saved ${conversations.length} conversations to localStorage (${Math.round(json.length / 1024)}KB)`);
    } catch (error) {
      console.warn('[OfflineStorage] Error saving to localStorage:', error);
      // If quota exceeded, clear old cache
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        try {
          localStorage.removeItem(LS_CONVERSATIONS_KEY);
          localStorage.removeItem(LS_CONVERSATIONS_TIMESTAMP_KEY);
        } catch (e) {
          // Ignore
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
    if (!('indexedDB' in window)) {
      console.warn('[OfflineStorage] IndexedDB not available');
      this.initFailed = true;
      return;
    }

    return new Promise((resolve, reject) => {
      // Add timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        console.warn('[OfflineStorage] Init timed out');
        this.initFailed = true;
        resolve(); // Don't reject, just mark as failed
      }, DB_TIMEOUT);

      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          clearTimeout(timeoutId);
          console.error('[OfflineStorage] Failed to open database:', request.error);
          this.initFailed = true;
          resolve(); // Don't reject, just mark as failed
        };

        request.onsuccess = () => {
          clearTimeout(timeoutId);
          this.db = request.result;
          this.isInitialized = true;
          console.log('[OfflineStorage] Database initialized successfully');
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
        };

        // Handle blocked event (when another tab has the DB open with older version)
        request.onblocked = () => {
          clearTimeout(timeoutId);
          console.warn('[OfflineStorage] Database blocked by another tab');
          this.initFailed = true;
          resolve();
        };
      } catch (error) {
        clearTimeout(timeoutId);
        console.error('[OfflineStorage] Exception during init:', error);
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
      console.warn('[OfflineStorage] Cannot save message - DB not ready');
      return;
    }
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db!.transaction([MESSAGES_STORE], 'readwrite');
        const store = transaction.objectStore(MESSAGES_STORE);
        const request = store.put(message);

        request.onsuccess = () => resolve();
        request.onerror = () => {
          console.error('[OfflineStorage] Failed to save message:', request.error);
          resolve(); // Don't reject, just log
        };
      } catch (error) {
        console.error('[OfflineStorage] Exception saving message:', error);
        resolve();
      }
    });
  }

  async saveMessages(messages: OfflineMessage[]): Promise<void> {
    const ready = await this.ensureReady();
    if (!ready) {
      console.warn('[OfflineStorage] Cannot save messages - DB not ready');
      return;
    }
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db!.transaction([MESSAGES_STORE], 'readwrite');
        const store = transaction.objectStore(MESSAGES_STORE);

        messages.forEach(message => store.put(message));

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => {
          console.error('[OfflineStorage] Failed to save messages:', transaction.error);
          resolve();
        };
      } catch (error) {
        console.error('[OfflineStorage] Exception saving messages:', error);
        resolve();
      }
    });
  }

  async getMessages(conversationId: string): Promise<OfflineMessage[]> {
    const ready = await this.ensureReady();
    if (!ready) {
      console.warn('[OfflineStorage] Cannot get messages - DB not ready');
      return [];
    }
    
    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction([MESSAGES_STORE], 'readonly');
        const store = transaction.objectStore(MESSAGES_STORE);
        const index = store.index('conversation_id');
        const request = index.getAll(conversationId);

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => {
          console.error('[OfflineStorage] Failed to get messages:', request.error);
          resolve([]);
        };
      } catch (error) {
        console.error('[OfflineStorage] Exception getting messages:', error);
        resolve([]);
      }
    });
  }

  async deleteMessage(messageId: string): Promise<void> {
    const ready = await this.ensureReady();
    if (!ready) {
      return;
    }
    
    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction([MESSAGES_STORE], 'readwrite');
        const store = transaction.objectStore(MESSAGES_STORE);
        const request = store.delete(messageId);

        request.onsuccess = () => resolve();
        request.onerror = () => {
          console.error('[OfflineStorage] Failed to delete message:', request.error);
          resolve();
        };
      } catch (error) {
        console.error('[OfflineStorage] Exception deleting message:', error);
        resolve();
      }
    });
  }

  // Pending messages operations (for offline sending)
  async savePendingMessage(message: PendingMessage): Promise<void> {
    const ready = await this.ensureReady();
    if (!ready) {
      console.warn('[OfflineStorage] Cannot save pending message - DB not ready');
      return;
    }
    
    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction([PENDING_STORE], 'readwrite');
        const store = transaction.objectStore(PENDING_STORE);
        const request = store.put(message);

        request.onsuccess = () => resolve();
        request.onerror = () => {
          console.error('[OfflineStorage] Failed to save pending message:', request.error);
          resolve();
        };
      } catch (error) {
        console.error('[OfflineStorage] Exception saving pending message:', error);
        resolve();
      }
    });
  }

  async getPendingMessages(): Promise<PendingMessage[]> {
    const ready = await this.ensureReady();
    if (!ready) {
      return [];
    }
    
    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction([PENDING_STORE], 'readonly');
        const store = transaction.objectStore(PENDING_STORE);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => {
          console.error('[OfflineStorage] Failed to get pending messages:', request.error);
          resolve([]);
        };
      } catch (error) {
        console.error('[OfflineStorage] Exception getting pending messages:', error);
        resolve([]);
      }
    });
  }

  async deletePendingMessage(tempId: string): Promise<void> {
    const ready = await this.ensureReady();
    if (!ready) {
      return;
    }
    
    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction([PENDING_STORE], 'readwrite');
        const store = transaction.objectStore(PENDING_STORE);
        const request = store.delete(tempId);

        request.onsuccess = () => resolve();
        request.onerror = () => {
          console.error('[OfflineStorage] Failed to delete pending message:', request.error);
          resolve();
        };
      } catch (error) {
        console.error('[OfflineStorage] Exception deleting pending message:', error);
        resolve();
      }
    });
  }

  // Conversations operations
  async saveConversation(conversation: any): Promise<void> {
    const ready = await this.ensureReady();
    if (!ready) {
      return;
    }
    
    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction([CONVERSATIONS_STORE], 'readwrite');
        const store = transaction.objectStore(CONVERSATIONS_STORE);
        const request = store.put(conversation);

        request.onsuccess = () => resolve();
        request.onerror = () => {
          console.error('[OfflineStorage] Failed to save conversation:', request.error);
          resolve();
        };
      } catch (error) {
        console.error('[OfflineStorage] Exception saving conversation:', error);
        resolve();
      }
    });
  }

  async saveConversations(conversations: any[]): Promise<void> {
    // Always update memory cache immediately (instant)
    this.memoryCache.conversations = conversations;
    
    // Also save to localStorage for instant load on page refresh
    // This is synchronous and survives page refresh
    this.saveToLocalStorage(conversations);
    
    const ready = await this.ensureReady();
    if (!ready) {
      console.warn('[OfflineStorage] Cannot save conversations to IndexedDB - DB not ready');
      return;
    }
    
    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction([CONVERSATIONS_STORE], 'readwrite');
        const store = transaction.objectStore(CONVERSATIONS_STORE);

        // Clear existing conversations first to ensure fresh data
        store.clear();

        // Add all new conversations
        conversations.forEach(conversation => store.put(conversation));

        transaction.oncomplete = () => {
          console.log(`[OfflineStorage] Saved ${conversations.length} conversations to IndexedDB`);
          resolve();
        };
        transaction.onerror = () => {
          console.error('[OfflineStorage] Failed to save conversations:', transaction.error);
          resolve();
        };
      } catch (error) {
        console.error('[OfflineStorage] Exception saving conversations:', error);
        resolve();
      }
    });
  }

  // Synchronous method to get conversations from memory cache (instant)
  getConversationsSync(): any[] | null {
    return this.memoryCache.conversations;
  }

  async getConversations(): Promise<any[]> {
    // First, check memory cache (instant)
    if (this.memoryCache.conversations !== null) {
      console.log('[OfflineStorage] Returning conversations from memory cache');
      return this.memoryCache.conversations;
    }
    
    const ready = await this.ensureReady();
    if (!ready) {
      return [];
    }
    
    return new Promise((resolve) => {
      try {
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
          console.error('[OfflineStorage] Failed to get conversations:', request.error);
          resolve([]);
        };
      } catch (error) {
        console.error('[OfflineStorage] Exception getting conversations:', error);
        resolve([]);
      }
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
      // Ignore localStorage errors
    }
    
    const ready = await this.ensureReady();
    if (!ready) {
      return;
    }
    
    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [MESSAGES_STORE, CONVERSATIONS_STORE, PENDING_STORE],
          'readwrite'
        );

        transaction.objectStore(MESSAGES_STORE).clear();
        transaction.objectStore(CONVERSATIONS_STORE).clear();
        transaction.objectStore(PENDING_STORE).clear();

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => {
          console.error('[OfflineStorage] Failed to clear all:', transaction.error);
          resolve();
        };
      } catch (error) {
        console.error('[OfflineStorage] Exception clearing all:', error);
        resolve();
      }
    });
  }

  // Check if storage is available
  isAvailable(): boolean {
    return this.isInitialized && !this.initFailed && this.db !== null;
  }
}

export const offlineStorage = new OfflineStorage();