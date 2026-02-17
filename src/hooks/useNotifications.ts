// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface UseNotificationsReturn {
  permission: NotificationPermission;
  isSupported: boolean;
  requestPermission: () => Promise<boolean>;
  sendNotification: (title: string, body: string, data?: any) => void;
  subscribeToConversation: (conversationId: string) => void;
  unsubscribeFromConversation: (conversationId: string) => void;
}

export const useNotifications = (): UseNotificationsReturn => {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSupported] = useState(() => 'Notification' in globalThis && 'serviceWorker' in navigator);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

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
      // Error requesting notification permission
      return false;
    }
  };

  const sendNotification = (title: string, body: string, data?: any) => {
    if (!isSupported || permission !== 'granted') {
      // Cannot send notification: permission not granted
      return;
    }

    if (registration) {
      registration.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'message',
        data: data || {},
        requireInteraction: false,
      } as any);
      
      // Vibration séparée
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200]);
      }
    } else {
      // Fallback to browser notification
      new Notification(title, {
        body,
        icon: '/icon-192.png',
        tag: 'message',
        data: data || {},
      });
    }
  };

  const subscribeToConversation = (conversationId: string) => {
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
        
        // Ne pas notifier pour ses propres messages
        supabase.auth.getUser().then(({ data: { user } }) => {
          if (user && message.sender_id !== user.id) {
            // Vérifier si la page est visible
            if (document.hidden) {
              sendNotification(
                'Nouveau message',
                message.content || 'Vous avez reçu un nouveau message',
                { conversationId, messageId: message.id }
              );
            }
          }
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const unsubscribeFromConversation = (conversationId: string) => {
    const channel = supabase.getChannels().find(
      ch => ch.topic === `notifications:${conversationId}`
    );
    if (channel) {
      supabase.removeChannel(channel);
    }
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