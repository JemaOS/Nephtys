// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useState, useEffect, useRef } from 'react';
import { tStatic } from '@/i18n';
import { supabase } from '@/lib/supabase';
import {
  areNotificationsEnabled,
  isMessagePreviewEnabled,
  isSoundEnabled,
  isVibrationEnabled,
} from '@/lib/prefs';

interface UseNotificationsReturn {
  permission: NotificationPermission;
  isSupported: boolean;
  requestPermission: () => Promise<boolean>;
  sendNotification: (title: string, body: string, data?: any) => void;
  subscribeToConversation: (conversationId: string) => () => void;
  unsubscribeFromConversation: (conversationId: string) => void;
}

export const useNotifications = (): UseNotificationsReturn => {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSupported] = useState(() => 'Notification' in globalThis && 'serviceWorker' in navigator);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  // Canaux de notification actifs, indexés par conversation → permet un
  // cleanup explicite (et systématique au démontage) sans fuite de canal.
  const channelsRef = useRef<Map<string, ReturnType<typeof supabase.channel>>>(new Map());

  useEffect(() => {
    // Capture la Map (identité stable) pour le cleanup de démontage.
    const channels = channelsRef.current;
    return () => {
      // Démontage : retire tous les canaux encore ouverts (fuite sinon).
      channels.forEach((channel) => {
        try { supabase.removeChannel(channel); } catch { /* ignore */ }
      });
      channels.clear();
    };
  }, []);

  useEffect(() => {
    if (isSupported) {
      setPermission(Notification.permission);
      registerServiceWorker();
    }
  }, [isSupported]);

  const registerServiceWorker = async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      setRegistration(reg);
    } catch (error) {
      // Service Worker registration failed - notifications may not work offline
      console.warn('Service Worker registration failed:', error);
    }
  };

  const requestPermission = async (): Promise<boolean> => {
    if (!isSupported) {
      // Notifications not supported
      return false;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result === 'granted';
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  };

  const sendNotification = (title: string, body: string, data?: any) => {
    if (!isSupported || permission !== 'granted') {
      // Cannot send notification: permission not granted
      return;
    }

    // Préférences utilisateur : son et vibration pilotés par les réglages.
    const silent = !isSoundEnabled();
    const vibrate = isVibrationEnabled();

    if (registration) {
      registration.showNotification(title, {
        body,
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        tag: 'message',
        data: data || {},
        requireInteraction: false,
        silent,
        vibrate: vibrate ? [200, 100, 200] : undefined,
      } as any);

      // Vibration séparée (le SW ne la garantit pas partout).
      if (vibrate && 'vibrate' in navigator) {
        navigator.vibrate([200, 100, 200]);
      }
    } else {
      // Fallback to browser notification
      new Notification(title, {
        body,
        icon: '/icon-192x192.png',
        tag: 'message',
        data: data || {},
        silent,
      });
    }
  };

  const unsubscribeFromConversation = (conversationId: string) => {
    const channel = channelsRef.current.get(conversationId);
    if (channel) {
      try { supabase.removeChannel(channel); } catch { /* ignore */ }
      channelsRef.current.delete(conversationId);
      return;
    }
    // Repli : canal ouvert avant l'instauration du suivi interne.
    const byTopic = supabase.getChannels().find(
      ch => ch.topic === `notifications:${conversationId}`
    );
    if (byTopic) {
      supabase.removeChannel(byTopic);
    }
  };

  const subscribeToConversation = (conversationId: string): (() => void) => {
    // Remplace un éventuel abonnement existant pour la même conversation.
    unsubscribeFromConversation(conversationId);

    // S'abonner aux nouveaux messages de cette conversation
    const channel = supabase
      .channel(`notifications:${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const message = payload.new;

        // Notifications globalement désactivées → on ne notifie pas.
        if (!areNotificationsEnabled()) return;

        // Ne pas notifier pour ses propres messages
        supabase.auth.getUser().then(({ data: { user } }) => {
          if (user && message.sender_id !== user.id) {
            // Vérifier si la page est visible
            if (document.hidden) {
              // Aperçu du contenu seulement si l'utilisateur l'autorise.
              const body = isMessagePreviewEnabled()
                ? (message.content || tStatic('newMessageBody'))
                : tStatic('newMessageBody');
              sendNotification(
                tStatic('newMessageNotification'),
                body,
                { conversationId, messageId: message.id }
              );
            }
          }
        });
      })
      .subscribe();

    channelsRef.current.set(conversationId, channel);

    return () => unsubscribeFromConversation(conversationId);
  };

  return {
    permission,
    isSupported,
    requestPermission,
    sendNotification,
    subscribeToConversation,
    unsubscribeFromConversation,
  };
};