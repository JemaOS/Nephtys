// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { offlineStorage } from '@/lib/offlineStorage';

// Timeout for sync operations
const SYNC_TIMEOUT = 10000;
const SYNC_RETRY_DELAY = 5000;

interface UseOfflineSyncReturn {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  syncNow: () => Promise<void>;
}

// Helper: Promise with timeout
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Operation timed out'));
    }, ms);

    promise
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

export const useOfflineSync = (conversationId?: string): UseOfflineSyncReturn => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const syncInProgress = useRef(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load pending count - non-blocking
  const loadPendingCount = useCallback(async () => {
    try {
      const pending = await offlineStorage.getPendingMessages();
      setPendingCount(pending.length);
    } catch (error) {
      console.warn('[OfflineSync] Error loading pending count:', error);
      // Don't throw, just log
    }
  }, []);

  // Sync pending messages with timeout and retry
  const syncPendingMessages = useCallback(async () => {
    // Prevent concurrent syncs
    if (!navigator.onLine || syncInProgress.current) {
      return;
    }

    syncInProgress.current = true;
    setIsSyncing(true);

    try {
      const pendingMessages = await offlineStorage.getPendingMessages();
      
      if (pendingMessages.length === 0) {
        return;
      }

      // Syncing pending messages silently
      
      for (const pending of pendingMessages) {
        try {
          // Add timeout to prevent hanging
          const insertPromise = supabase
            .from('messages')
            .insert({
              conversation_id: pending.conversation_id,
              content: pending.content,
              type: pending.type,
              status: 'sent',
              media_url: pending.media_url,
              media_type: pending.media_type,
              reply_to_id: pending.reply_to_id,
            });

          const { error } = await withTimeout(
            Promise.resolve(insertPromise),
            SYNC_TIMEOUT
          );

          if (!error) {
            // Successfully sent, remove from local storage
            await offlineStorage.deletePendingMessage(pending.tempId);
          } else {
            // Failed to sync message
          }
        } catch {
          // Continue with next message, don't break the loop
        }
      }

      await loadPendingCount();
    } catch (error) {
      console.warn('[OfflineSync] Error syncing pending messages:', error);
      
      // Schedule retry if still online
      if (navigator.onLine && !retryTimeoutRef.current) {
        retryTimeoutRef.current = setTimeout(() => {
          retryTimeoutRef.current = null;
          syncPendingMessages();
        }, SYNC_RETRY_DELAY);
      }
    } finally {
      syncInProgress.current = false;
      setIsSyncing(false);
    }
  }, [loadPendingCount]);

  // Handle online/offline events
  useEffect(() => {
    const handleOnline = () => {
      // Back online, starting sync
      setIsOnline(true);
      // Delay sync slightly to ensure connection is stable
      setTimeout(() => {
        syncPendingMessages();
      }, 1000);
    };

    const handleOffline = () => {
      // Gone offline
      setIsOnline(false);
      // Clear any pending retry
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Load pending count on mount (non-blocking)
    loadPendingCount();

    // Initial sync if online
    if (navigator.onLine) {
      // Delay initial sync to not block app startup
      setTimeout(() => {
        syncPendingMessages();
      }, 2000);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [loadPendingCount, syncPendingMessages]);

  // Manual sync function
  const syncNow = useCallback(async () => {
    await syncPendingMessages();
  }, [syncPendingMessages]);

  // Subscribe to new messages for offline storage
  useEffect(() => {
    if (!conversationId || !isOnline) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;

    // Delay subscription to not block initial render
    const subscribeTimeout = setTimeout(() => {
      channel = supabase
        .channel(`offline-sync:${conversationId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        }, async (payload) => {
          try {
            await offlineStorage.saveMessage(payload.new as any);
          } catch {
            // Error saving message offline
          }
        })
        .subscribe();
    }, 500);

    return () => {
      clearTimeout(subscribeTimeout);
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [conversationId, isOnline]);

  return {
    isOnline,
    isSyncing,
    pendingCount,
    syncNow,
  };
};