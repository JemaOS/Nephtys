// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Implémentation `MessagingTransport` adossée à Supabase.
 *
 * C'est le backend « centralisé » actuel. Il reste la valeur par défaut
 * tant que le transport SMP n'est pas prêt. Il ne fait aucune cryptographie :
 * il transporte des enveloppes déjà chiffrées.
 */

import { supabase } from '@/lib/supabase';
import type {
  IncomingMessage,
  MessagingTransport,
  OutgoingMessage,
  SendResult,
  TransportEvent,
  Unsubscribe,
} from './types';

function toIncoming(row: Record<string, unknown>): IncomingMessage {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    senderId: String(row.sender_id),
    content: String(row.content ?? ''),
    type: String(row.type ?? 'text'),
    createdAt: String(row.created_at ?? ''),
    raw: row,
  };
}

export class SupabaseTransport implements MessagingTransport {
  readonly kind = 'supabase';

  async sendMessage(msg: OutgoingMessage): Promise<SendResult> {
    const payload: Record<string, unknown> = {
      conversation_id: msg.conversationId,
      sender_id: msg.senderId,
      content: msg.content,
      type: msg.type,
      status: 'sent',
      reply_to_id: msg.replyToId ?? null,
    };
    if (msg.isTextEncrypted) {
      payload.is_text_encrypted = true;
      payload.encryption_metadata = msg.encryptionMetadata ?? null;
    }
    if (msg.mediaUrl !== undefined) payload.media_url = msg.mediaUrl;
    if (msg.mediaType !== undefined) payload.media_type = msg.mediaType;
    if (msg.mediaThumbnail !== undefined) payload.media_thumbnail = msg.mediaThumbnail;
    if (msg.mediaWidth !== undefined) payload.media_width = msg.mediaWidth;
    if (msg.mediaHeight !== undefined) payload.media_height = msg.mediaHeight;
    if (msg.fileUrl !== undefined) payload.file_url = msg.fileUrl;
    if (msg.fileName !== undefined) payload.file_name = msg.fileName;
    if (msg.fileSize !== undefined) payload.file_size = msg.fileSize;
    if (msg.isMediaEncrypted) payload.is_media_encrypted = true;
    if (msg.linkPreview !== undefined) payload.link_preview = msg.linkPreview;
    if (msg.senderSealed !== undefined) payload.sender_sealed = msg.senderSealed;
    if (msg.ephemeralDuration) {
      payload.is_ephemeral = true;
      payload.ephemeral_duration = msg.ephemeralDuration;
    }
    if (msg.ephemeralExpiresAt) payload.ephemeral_expires_at = msg.ephemeralExpiresAt;

    const { data, error } = await supabase.from('messages').insert(payload).select().single();
    if (error || !data) {
      throw new Error(`SupabaseTransport.sendMessage: ${error?.message ?? 'no data'}`);
    }
    return { id: data.id, raw: data as Record<string, unknown> };
  }

  subscribe(conversationId: string, onMessage: (msg: IncomingMessage) => void): Unsubscribe {
    const channel = supabase
      .channel(`transport:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        payload => onMessage(toIncoming(payload.new as Record<string, unknown>)),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  async fetchHistory(conversationId: string, limit = 100): Promise<IncomingMessage[]> {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw new Error(`SupabaseTransport.fetchHistory: ${error.message}`);
    return (data ?? []).map(row => toIncoming(row as Record<string, unknown>));
  }

  /**
   * Événements temps réel (insert/update/delete) d'une conversation.
   * Couvre ce que `subscribe` (insert seul) ne fait pas : éditions, statuts,
   * suppressions — prérequis pour brancher la réception de l'app sur le transport.
   */
  subscribeEvents(
    conversationId: string,
    onEvent: (ev: TransportEvent) => void,
  ): Unsubscribe {
    const filter = `conversation_id=eq.${conversationId}`;
    const table = { schema: 'public', table: 'messages', filter };
    const channel = supabase
      .channel(`transport-events:${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', ...table }, payload =>
        onEvent({ kind: 'insert', message: toIncoming(payload.new as Record<string, unknown>) }),
      )
      .on('postgres_changes', { event: 'UPDATE', ...table }, payload =>
        onEvent({ kind: 'update', message: toIncoming(payload.new as Record<string, unknown>) }),
      )
      .on('postgres_changes', { event: 'DELETE', ...table }, payload =>
        onEvent({ kind: 'delete', message: toIncoming(payload.old as Record<string, unknown>) }),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }
}
