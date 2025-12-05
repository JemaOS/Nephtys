// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Reaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

interface UseMessageReactionsReturn {
  reactions: Reaction[];
  loading: boolean;
  error: string | null;
  addReaction: (messageId: string, emoji: string) => Promise<void>;
  removeReaction: (messageId: string, emoji: string) => Promise<void>;
}

export const useMessageReactions = (conversationId: string): UseMessageReactionsReturn => {
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Charger les réactions initiales
  useEffect(() => {
    if (!conversationId) return;

    const fetchReactions = async () => {
      try {
        setLoading(true);
        setError(null);

        // Récupérer toutes les réactions des messages de cette conversation
        const { data: messages } = await supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId);

        if (!messages || messages.length === 0) {
          setReactions([]);
          setLoading(false);
          return;
        }

        const messageIds = messages.map(m => m.id);

        const { data, error: fetchError } = await supabase
          .from('message_reactions')
          .select('*')
          .in('message_id', messageIds)
          .order('created_at', { ascending: true });

        if (fetchError) throw fetchError;

        setReactions(data || []);
      } catch (err) {
        console.error('Error fetching reactions:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch reactions');
      } finally {
        setLoading(false);
      }
    };

    fetchReactions();
  }, [conversationId]);

  // S'abonner aux changements en temps réel
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_reactions',
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newReaction = payload.new as Reaction;
            // Éviter les doublons - vérifier si la réaction existe déjà
            setReactions(prev => {
              const exists = prev.some(r => r.id === newReaction.id);
              if (exists) return prev;
              return [...prev, newReaction];
            });
          } else if (payload.eventType === 'DELETE') {
            setReactions(prev => prev.filter(r => r.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Ajouter une réaction (une seule réaction par utilisateur par message)
  const addReaction = async (messageId: string, emoji: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Vérifier si l'utilisateur a déjà une réaction sur ce message
      const existingReaction = reactions.find(
        r => r.message_id === messageId && r.user_id === user.id
      );

      if (existingReaction) {
        // Si c'est le même emoji, on le retire (toggle)
        if (existingReaction.emoji === emoji) {
          await removeReaction(messageId, emoji);
          return;
        }
        
        // Sinon, on supprime l'ancienne réaction d'abord
        await supabase
          .from('message_reactions')
          .delete()
          .eq('message_id', messageId)
          .eq('user_id', user.id);
        
        // Mettre à jour l'état local immédiatement
        setReactions(prev => prev.filter(
          r => !(r.message_id === messageId && r.user_id === user.id)
        ));
      }

      // Ajouter la nouvelle réaction
      const { error: insertError } = await supabase
        .from('message_reactions')
        .insert({
          message_id: messageId,
          user_id: user.id,
          emoji,
        });

      if (insertError) {
        // Si l'erreur est due à une contrainte unique (réaction déjà existante), on l'ignore
        if (!insertError.message.includes('duplicate key')) {
          throw insertError;
        }
      }
      // Note: La mise à jour de l'état local est gérée par le realtime subscription
      // pour éviter les doublons
    } catch (err) {
      console.error('Error adding reaction:', err);
      setError(err instanceof Error ? err.message : 'Failed to add reaction');
      throw err;
    }
  };

  // Retirer une réaction
  const removeReaction = async (messageId: string, emoji: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { error: deleteError } = await supabase
        .from('message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', user.id)
        .eq('emoji', emoji);

      if (deleteError) throw deleteError;
    } catch (err) {
      console.error('Error removing reaction:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove reaction');
      throw err;
    }
  };

  return {
    reactions,
    loading,
    error,
    addReaction,
    removeReaction,
  };
};