// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * P1 — Relais aveugle sur Supabase.
 *
 * Implémente `RelayWire` (le même contrat que le relais WebSocket) au-dessus
 * des RPC Supabase `anon_queue_*`. Permet au **mode privé anonyme** de
 * fonctionner **sans héberger de serveur** : Supabase sert de transport à
 * files opaques (aucun user_id, accès par jetons).
 *
 * Le ciphertext est déjà chiffré E2EE côté client : Supabase ne voit que des
 * `queue_id` opaques et du ciphertext.
 */

import { supabase } from '../supabase';
import type { QueueCredentials, StoredEnvelope } from './relayCore';
import type { RelayOp, RelayResponse, RelayWire } from './wire';

export class SupabaseRelayWire implements RelayWire {
  async request(op: RelayOp): Promise<RelayResponse> {
    switch (op.op) {
      case 'createQueue': {
        const { data, error } = await supabase.rpc('anon_queue_create');
        if (error || !data) return { ok: false, error: error?.message ?? 'createQueue failed' };
        const creds = data as { queueId: string; sendToken: string; rcvToken: string };
        const result: QueueCredentials = {
          queueId: creds.queueId,
          sendKey: creds.sendToken,
          rcvKey: creds.rcvToken,
        };
        return { ok: true, result };
      }

      case 'send': {
        const { error } = await supabase.rpc('anon_queue_send', {
          p_queue_id: op.queueId,
          p_send_token: op.queueKey,
          p_ciphertext: op.ciphertext,
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true, result: { id: op.queueId } };
      }

      case 'read': {
        const { data, error } = await supabase.rpc('anon_queue_read', {
          p_queue_id: op.queueId,
          p_rcv_token: op.queueKey,
          p_limit: op.limit ?? 100,
        });
        if (error) return { ok: false, error: error.message };
        const rows = (data as { messages?: Array<{ id: string; ciphertext: string; ts: number }> } | null)?.messages ?? [];
        const messages: StoredEnvelope[] = rows.map(r => ({
          id: r.id,
          ciphertext: r.ciphertext,
          ts: r.ts,
          expiresAt: r.ts,
        }));
        return { ok: true, result: messages };
      }

      case 'ack': {
        const { error } = await supabase.rpc('anon_queue_ack', {
          p_queue_id: op.queueId,
          p_rcv_token: op.queueKey,
          p_ids: op.ids,
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true, result: op.ids.length };
      }

      case 'delete': {
        const { error } = await supabase.rpc('anon_queue_delete', {
          p_queue_id: op.queueId,
          p_rcv_token: op.queueKey,
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true, result: true };
      }
    }
  }
}
