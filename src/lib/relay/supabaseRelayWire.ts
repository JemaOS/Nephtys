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

const ANON_CONSENT_KEY = 'nephtys_anon_relay_consent';

/**
 * Vrai si l'utilisateur a accepté d'utiliser le relais Supabase alors que sa
 * **session Supabase est connectée** (le mode privé anonyme ne doit pas, par
 * défaut, écrire sous l'identité du compte).
 */
export function isAnonRelayConsentGranted(): boolean {
  try {
    return localStorage.getItem(ANON_CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Accorde/retire le consentement d'usage du relais Supabase authentifié. */
export function setAnonRelayConsent(granted: boolean): void {
  try {
    if (granted) localStorage.setItem(ANON_CONSENT_KEY, '1');
    else localStorage.removeItem(ANON_CONSENT_KEY);
  } catch {
    // localStorage indisponible
  }
}

const AUTH_DENIED =
  'relais Supabase refusé : une session connectée est active. Le mode privé anonyme ' +
  'n’utilise pas la session du compte sans consentement explicite.';

interface SupabaseLike {
  auth?: { getSession?: () => Promise<{ data?: { session?: unknown } }> };
}

export interface SupabaseRelayOptions {
  /** Autorise explicitement l'usage de la session Supabase connectée. */
  allowAuthenticatedSession?: boolean;
}

export class SupabaseRelayWire implements RelayWire {
  private authChecked = false;
  private authAllowed = false;

  constructor(private readonly options: SupabaseRelayOptions = {}) {}

  /**
   * En mode privé/anon, refuse silencieusement l'usage de la session Supabase
   * connectée (sauf consentement explicite) : aucune requête n'est émise sous
   * l'identité du compte. Idempotent et mis en cache.
   */
  private async ensureAnonymous(): Promise<RelayResponse | null> {
    if (this.options.allowAuthenticatedSession || isAnonRelayConsentGranted()) return null;
    if (this.authChecked) return this.authAllowed ? null : { ok: false, error: AUTH_DENIED };

    const auth = (supabase as SupabaseLike).auth;
    if (typeof auth?.getSession !== 'function') {
      // Client sans auth (tests) → autorisé.
      this.authChecked = true;
      this.authAllowed = true;
      return null;
    }
    try {
      const { data } = await auth.getSession();
      this.authChecked = true;
      this.authAllowed = !data?.session;
    } catch {
      // En cas de doute, on considère la session absente (best-effort).
      this.authChecked = true;
      this.authAllowed = true;
    }
    return this.authAllowed ? null : { ok: false, error: AUTH_DENIED };
  }

  async request(op: RelayOp): Promise<RelayResponse> {
    const denied = await this.ensureAnonymous();
    if (denied) return denied;

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
