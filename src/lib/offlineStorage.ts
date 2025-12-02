// Offline Storage with IndexedDB
// Permet de stocker les messages localement pour le mode hors ligne
// Optimized for PWA performance with non-blocking initialization

const DB_NAME = 'nephtys-offline-db';
const DB_VERSION = 1;
const MESSAGES_STORE = 'messages';
const CONVERSATIONS_STORE = 'conversations';
const PENDING_STORE = 'pending-messages';

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
    // Start initialization immediately but don't block
    this.initPromise = this.init().catch((error) => {
      console.warn('[OfflineStorage] Initialization failed:', error);
      this.initFailed = true;
    });
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

  // Ensure DB is ready before operations
  private async ensureReady(): Promise<boolean> {
    if (this.initFailed) {
      return false;
    }
    
    if (this.initPromise) {
      await this.initPromise;
    }
    
    return this.isInitialized && this.db !== null;
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