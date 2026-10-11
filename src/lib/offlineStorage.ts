// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// Offline Storage with IndexedDB + localStorage
// Permet de stocker les messages localement pour le mode hors ligne
// Optimized for PWA performance with non-blocking initialization
// Uses localStorage as a fast synchronous cache layer for instant display
//
// Chiffrement au repos : toutes les valeurs persistées (IndexedDB + cache
// localStorage) passent par `sealAtRest` à l'écriture et `openAtRest` à la
// lecture (voir atRestCrypto.ts). Les entrées historiques non chiffrées
// restent lisibles telles quelles (rétrocompatibilité).

import { sealAtRest, openAtRest, isAtRestBox, sealBytesAtRest, openBytesAtRest, type AtRestBox } from './atRestCrypto';

const DB_NAME = 'nephtys-offline-db';
const DB_VERSION = 3; // v3: store `media` (blobs média déchiffrés, cache durable)
const MESSAGES_STORE = 'messages';
const CONVERSATIONS_STORE = 'conversations';
const PENDING_STORE = 'pending-messages';
const PROFILES_STORE = 'profiles';
const MEDIA_STORE = 'media';

// localStorage keys for instant cache (survives page refresh)
const LS_CONVERSATIONS_KEY = 'nephtys_conversations_cache';
const LS_CONVERSATIONS_TIMESTAMP_KEY = 'nephtys_conversations_cache_ts';
const LS_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours max cache age

// Timeout for IndexedDB operations
const DB_TIMEOUT = 3000;

// Champ portant la boîte chiffrée dans un enregistrement IndexedDB.
const SEALED_FIELD = '__atrest';

// Champs conservés « en clair » à côté de la boîte chiffrée : ils servent de
// keyPath et d'index IndexedDB. Sans eux, les stores (keyPath: 'id'/'tempId')
// et les index ('conversation_id', 'created_at', 'username') ne fonctionneraient
// plus et les requêtes getAll(conversationId) échoueraient.
const MESSAGE_KEY_FIELDS = ['id', 'conversation_id', 'created_at'] as const;
const CONVERSATION_KEY_FIELDS = ['id'] as const;
const PENDING_KEY_FIELDS = ['tempId', 'conversation_id'] as const;
const PROFILE_KEY_FIELDS = ['id', 'username'] as const;

/**
 * Chiffre un enregistrement à stocker. En cas d'indisponibilité du chiffrement
 * (`sealAtRest` renvoie alors la valeur brute), on stocke l'enregistrement
 * inchangé afin de ne jamais régresser ni corrompre les données.
 */
async function sealRecord(record: any, plainFields: readonly string[]): Promise<any> {
  if (!record || typeof record !== 'object') return record;

  const sealed = await sealAtRest(record);
  if (!isAtRestBox(sealed)) return record;

  const shadow: Record<string, unknown> = { [SEALED_FIELD]: sealed };
  for (const field of plainFields) shadow[field] = record[field];
  return shadow;
}

/**
 * Déchiffre un enregistrement lu. Renvoie la valeur historique brute si elle
 * n'est pas chiffrée, et `undefined` si une boîte est indéchiffrable (la clé au
 * repos a été perdue) : les appelants doivent alors l'ignorer proprement.
 */
async function openRecord(stored: any): Promise<any> {
  if (stored && typeof stored === 'object' && SEALED_FIELD in stored) {
    return openAtRest(stored[SEALED_FIELD]);
  }
  return stored;
}

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

  // Déchiffrement asynchrone du cache localStorage chiffré (l'API
  // localStorage est synchrone, or `openAtRest` est asynchrone).
  private lsHydration: Promise<void> | null = null;

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
      if (!cached) {
        return;
      }

      const parsed = JSON.parse(cached);
      if (isAtRestBox(parsed)) {
        // Cache chiffré : le déchiffrement est asynchrone (l'API localStorage
        // est synchrone, `openAtRest` ne l'est pas). On hydrate la mémoire dès
        // que possible ; d'ici là `getConversations` retombe sur IndexedDB.
        this.hydrateLocalStorage(parsed);
      } else if (Array.isArray(parsed) && parsed.length > 0) {
        // Entrée historique en clair (rétrocompatibilité) : rien à déchiffrer.
        this.memoryCache.conversations = parsed;
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

  // Déchiffre le cache localStorage en tâche de fond et alimente la mémoire.
  private hydrateLocalStorage(raw: unknown): void {
    this.lsHydration = (async () => {
      const conversations = await openAtRest(raw);
      if (Array.isArray(conversations) && conversations.length > 0) {
        this.memoryCache.conversations = conversations;
      }
    })().catch(() => {
      // Cache illisible (clé au repos perdue) : on ignore, IndexedDB prendra le relais.
    });
  }
  
  // Save conversations to localStorage (for instant load on page refresh)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async saveToLocalStorage(conversations: any[]): Promise<void> {
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
      
      // Chiffré au repos (une seule boîte pour tout le tableau). Si le
      // chiffrement est indisponible, `sealAtRest` renvoie le tableau brut et
      // le cache reste lisible comme avant.
      const sealed = await sealAtRest(minimalConversations);
      const json = JSON.stringify(sealed);
      
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

          // Create media store for durable local cache of decrypted media blobs.
          // Nécessaire au modèle « local-first » : une fois le blob média
          // déchiffré, on le garde localement pour qu'il reste disponible même
          // si le serveur purge l'objet (rétention type WhatsApp).
          if (!db.objectStoreNames.contains(MEDIA_STORE)) {
            db.createObjectStore(MEDIA_STORE, { keyPath: 'messageId' });
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

    const sealed = await sealRecord(message, MESSAGE_KEY_FIELDS);

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([MESSAGES_STORE], 'readwrite');
      const store = transaction.objectStore(MESSAGES_STORE);
      const request = store.put(sealed);

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

    // Chiffrement par enregistrement (une boîte par message) : nécessaire pour
    // conserver la clé `id` et l'index `conversation_id` en clair, utilisés par
    // getMessages / clearConversationMessages.
    const sealed = await Promise.all(
      messages.map(message => sealRecord(message, MESSAGE_KEY_FIELDS))
    );

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([MESSAGES_STORE], 'readwrite');
      const store = transaction.objectStore(MESSAGES_STORE);

      sealed.forEach(record => store.put(record));

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        resolve();
      };
    });
  }

  async getMessages(conversationId: string): Promise<OfflineMessage[]> {
    // Check memory cache first (instant)
    if (this.memoryCache.messages.has(conversationId)) {
      return this.memoryCache.messages.get(conversationId) ?? [];
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

      request.onsuccess = async () => {
        const raw = request.result || [];
        // Déchiffre chaque message ; on écarte les boîtes illisibles ou les
        // entrées historiques invalides sans casser la conversation.
        const opened = await Promise.all(raw.map(openRecord));
        resolve(opened.filter((m): m is OfflineMessage => m != null));
      };
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

  /**
   * Vide le cache (mémoire + IndexedDB) des messages d'une conversation.
   * Utilisé par « Effacer les messages » pour éviter que la vue de
   * conversation ne ressuscite les anciens messages depuis le cache local.
   */
  async clearConversationMessages(conversationId: string): Promise<void> {
    // Purge mémoire d'abord : getMessages renverrait sinon le cache mémoire.
    this.memoryCache.messages.delete(conversationId);

    const ready = await this.ensureReady();
    if (!ready) {
      return;
    }

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([MESSAGES_STORE], 'readwrite');
      const store = transaction.objectStore(MESSAGES_STORE);
      const index = store.index('conversation_id');
      const request = index.openCursor(IDBKeyRange.only(conversationId));

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => resolve();
    });
  }

  // ── Cache durable des médias déchiffrés (local-first) ────────────────
  // Une fois un média E2EE déchiffré, on stocke le Blob localement pour qu'il
  // reste disponible même après purge de l'objet côté serveur (rétention).
  // Le Blob est chiffré AU REPOS via AES-GCM sur son ArrayBuffer (pas
  // `sealAtRest(JSON)` qui corromprait un Blob). Les anciennes entrées en clair
  // restent lisibles (rétrocompatibilité).
  async saveMediaBlob(messageId: string, blob: Blob, mimeType?: string): Promise<void> {
    const ready = await this.ensureReady();
    if (!ready) return;

    const type = mimeType || blob.type || 'application/octet-stream';
    let sealed: AtRestBox | null = null;
    try {
      sealed = await sealBytesAtRest(await blob.arrayBuffer());
    } catch {
      sealed = null;
    }

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([MEDIA_STORE], 'readwrite');
      const store = transaction.objectStore(MEDIA_STORE);
      store.put(
        sealed
          ? { messageId, sealed, mimeType: type, updatedAt: new Date().toISOString() }
          : { messageId, blob, mimeType: type, updatedAt: new Date().toISOString() },
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });
  }

  async getMediaBlob(messageId: string): Promise<{ blob: Blob; mimeType: string } | null> {
    const ready = await this.ensureReady();
    if (!ready) return null;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([MEDIA_STORE], 'readonly');
      const store = transaction.objectStore(MEDIA_STORE);
      const request = store.get(messageId);
      request.onsuccess = async () => {
        const r = request.result;
        if (!r) {
          resolve(null);
          return;
        }
        const mimeType = r.mimeType || 'application/octet-stream';
        // Entrée chiffrée au repos : déchiffre le binaire puis reconstruit le Blob.
        if (isAtRestBox(r.sealed)) {
          const buf = await openBytesAtRest(r.sealed as AtRestBox);
          if (!buf) {
            // Clé au repos indisponible → on laisse l'appelant retomber sur le réseau.
            resolve(null);
            return;
          }
          resolve({ blob: new Blob([buf], { type: mimeType }), mimeType });
          return;
        }
        // Entrée historique en clair.
        if (r.blob) resolve({ blob: r.blob as Blob, mimeType });
        else resolve(null);
      };
      request.onerror = () => resolve(null);
    });
  }

  async deleteMediaBlob(messageId: string): Promise<void> {
    const ready = await this.ensureReady();
    if (!ready) return;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([MEDIA_STORE], 'readwrite');
      transaction.objectStore(MEDIA_STORE).delete(messageId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });
  }

  // Pending messages operations (for offline sending)
  async savePendingMessage(message: PendingMessage): Promise<void> {
    const ready = await this.ensureReady();
    if (!ready) {
      return;
    }

    const sealed = await sealRecord(message, PENDING_KEY_FIELDS);

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([PENDING_STORE], 'readwrite');
      const store = transaction.objectStore(PENDING_STORE);
      const request = store.put(sealed);

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

      request.onsuccess = async () => {
        const raw = request.result || [];
        const opened = await Promise.all(raw.map(openRecord));
        resolve(opened.filter((m): m is PendingMessage => m != null));
      };
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

    const sealed = await sealRecord(conversation, CONVERSATION_KEY_FIELDS);

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([CONVERSATIONS_STORE], 'readwrite');
      const store = transaction.objectStore(CONVERSATIONS_STORE);
      const request = store.put(sealed);

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
    await this.saveToLocalStorage(conversations);

    const ready = await this.ensureReady();
    if (!ready) {
      return;
    }

    const sealed = await Promise.all(
      conversations.map(conversation => sealRecord(conversation, CONVERSATION_KEY_FIELDS))
    );

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([CONVERSATIONS_STORE], 'readwrite');
      const store = transaction.objectStore(CONVERSATIONS_STORE);

      // Clear existing conversations first to ensure fresh data
      store.clear();

      // Add all new conversations
      sealed.forEach(conversation => store.put(conversation));

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
    // Attendre l'hydratation du cache localStorage chiffré avant de décider
    // de retomber (ou non) sur IndexedDB.
    if (this.lsHydration) {
      try {
        await this.lsHydration;
      } catch {
        // Ignoré : le cache mémoire restera vide et IndexedDB prend le relais.
      }
    }

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

      request.onsuccess = async () => {
        const raw = request.result || [];
        const opened = await Promise.all(raw.map(openRecord));
        const result = opened.filter(c => c != null);
        // Update memory cache (déchiffré)
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
    this.lsHydration = null;
    
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
        [MESSAGES_STORE, CONVERSATIONS_STORE, PENDING_STORE, MEDIA_STORE],
        'readwrite'
      );

      transaction.objectStore(MESSAGES_STORE).clear();
      transaction.objectStore(CONVERSATIONS_STORE).clear();
      transaction.objectStore(PENDING_STORE).clear();
      transaction.objectStore(MEDIA_STORE).clear();

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

    const sealed = await Promise.all(
      profiles.map(profile => sealRecord(profile, PROFILE_KEY_FIELDS))
    );

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([PROFILES_STORE], 'readwrite');
      const store = transaction.objectStore(PROFILES_STORE);

      sealed.forEach(profile => store.put(profile));

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
      return this.memoryCache.profiles.get(userId) ?? null;
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
      return this.memoryCache.profiles.get(userId) ?? null;
    }
    
    const ready = await this.ensureReady();
    if (!ready) return null;
    
    return new Promise((resolve) => {
      const transaction = this.db!.transaction([PROFILES_STORE], 'readonly');
      const store = transaction.objectStore(PROFILES_STORE);
      const request = store.get(userId);

      request.onsuccess = async () => {
        const opened = (await openRecord(request.result)) as CachedProfile | undefined;
        if (opened) {
          // Update memory cache (déchiffré)
          this.memoryCache.profiles.set(userId, opened);
        }
        resolve(opened || null);
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
        request.onsuccess = async () => {
          const opened = (await openRecord(request.result)) as CachedProfile | undefined;
          if (opened) {
            result.set(userId, opened);
            // Update memory cache (déchiffré)
            this.memoryCache.profiles.set(userId, opened);
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
