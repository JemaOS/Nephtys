import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { offlineStorage } from '@/lib/offlineStorage';

interface UseOfflineSyncReturn {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  syncNow: () => Promise<void>;
}

export const useOfflineSync = (conversationId?: string): UseOfflineSyncReturn => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    // Écouter les changements de connexion
    const handleOnline = () => {
      setIsOnline(true);
      syncPendingMessages();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Charger le nombre de messages en attente
    loadPendingCount();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadPendingCount = async () => {
    try {
      const pending = await offlineStorage.getPendingMessages();
      setPendingCount(pending.length);
    } catch (error) {
      console.error('Error loading pending count:', error);
    }
  };

  const syncPendingMessages = async () => {
    if (!isOnline || isSyncing) return;

    setIsSyncing(true);
    try {
      const pendingMessages = await offlineStorage.getPendingMessages();
      
      for (const pending of pendingMessages) {
        try {
          // Envoyer le message au serveur
          const { error } = await supabase
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

          if (!error) {
            // Supprimer du stockage local
            await offlineStorage.deletePendingMessage(pending.tempId);
          }
        } catch (error) {
          console.error('Error syncing message:', error);
        }
      }

      await loadPendingCount();
    } catch (error) {
      console.error('Error syncing pending messages:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const syncNow = async () => {
    await syncPendingMessages();
  };

  // Sauvegarder les messages localement quand ils arrivent
  useEffect(() => {
    if (!conversationId || !isOnline) return;

    const channel = supabase
      .channel(`offline-sync:${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, async (payload) => {
        try {
          await offlineStorage.saveMessage(payload.new as any);
        } catch (error) {
          console.error('Error saving message offline:', error);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, isOnline]);

  return {
    isOnline,
    isSyncing,
    pendingCount,
    syncNow,
  };
};