// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Point d'entrée du transport de messagerie.
 *
 * Le backend est choisi via `VITE_MESSAGING_TRANSPORT` :
 *   • "supabase" (défaut) → SupabaseTransport (centralisé actuel)
 *   • "smp"               → SmpTransport (squelette SMP, à finaliser)
 *
 * L'UI et les services doivent dépendre de l'interface `MessagingTransport`
 * et non plus de `supabase.from('messages')` directement, afin que le
 * passage à un backend décentralisé (SMP) se fasse sans réécriture.
 */

import { SupabaseTransport } from './supabaseTransport';
import { SmpTransport } from './smpTransport';
import type { MessagingTransport } from './types';

export type { MessagingTransport, IncomingMessage, OutgoingMessage, SendResult, Unsubscribe } from './types';

let instance: MessagingTransport | null = null;

export function getMessagingTransport(): MessagingTransport {
  if (instance) return instance;

  const kind = (import.meta.env.VITE_MESSAGING_TRANSPORT as string | undefined) ?? 'supabase';
  const agentUrl = (import.meta.env.VITE_SMP_AGENT_URL as string | undefined) ?? 'ws://127.0.0.1:5225';

  instance = kind === 'smp' ? new SmpTransport(agentUrl) : new SupabaseTransport();
  return instance;
}

/** Réinitialise l'instance (tests / changement de backend à chaud). */
export function resetMessagingTransport(): void {
  instance = null;
}
