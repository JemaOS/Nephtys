// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * `SmpRelayWire` — transport du mode privé via **SimpleX SMP, 100 % navigateur**.
 *
 * S'appuie sur le cœur SMP navigateur vendoré depuis `simplex-web` (AGPL-3,
 * voir `src/lib/simplexweb/`) : pas d'agent natif, connexion WebSocket binaire
 * (un bloc SMP paddé par frame) vers un relais **SMP browser-profile**.
 *
 * ⚠️ STATUT — NON VALIDÉ :
 *   • requiert un relais SMP « browser-profile » (wss) joignable ;
 *   • le mapping du modèle de connexion du mode privé (files/ invitations) vers
 *     l'API de `simplex-web` doit être validé en conditions réelles ;
 *   • tant que ce n'est pas validé, garder `VITE_RELAY_MODE` ≠ `simplex-smp`.
 *
 * Le corps des messages reste chiffré par la crypto Nephtys (corps opaque) :
 * `simplex-web` ne sert que de transport (files SMP).
 */

import { connectBrowserSmpWebSocketTransport } from '@/lib/simplexweb/browser-smp-websocket-transport.mjs';
import { createBrowserSimplexClient } from '@/lib/simplexweb/browser-simplex-client.mjs';
import { createBrowserSimplexStore } from '@/lib/simplexweb/browser-simplex-store.mjs';
import { createBrowserSimplexContactClient } from '@/lib/simplexweb/browser-simplex-contact-client.mjs';
import type { RelayOp, RelayResponse, RelayWire } from './wire';
import type { QueueCredentials, StoredEnvelope } from './relayCore';

export interface SmpRelayOptions {
  /** URL du relais SMP browser-profile (wss://…). */
  url: string;
  /** Hash d'identité du serveur (base64url/hex) — cf. simplex-web. */
  keyHash?: string;
  /** Espace de noms du store navigateur local. */
  namespace?: string;
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class SmpRelayWire implements RelayWire {
  private contacts: any = null;
  private connecting: Promise<void> | null = null;
  private invitationCount = 0;

  constructor(private readonly opts: SmpRelayOptions) {}

  private async ready(): Promise<void> {
    if (this.contacts) return;
    if (!this.connecting) {
      this.connecting = (async () => {
        const transport = await connectBrowserSmpWebSocketTransport({
          url: this.opts.url,
          keyHash: this.opts.keyHash ?? '',
        });
        const client = createBrowserSimplexClient({ transport });
        const store = createBrowserSimplexStore({
          namespace: this.opts.namespace ?? 'nephtys-private-smp',
        });
        this.contacts = createBrowserSimplexContactClient({ client, store });
      })();
    }
    return this.connecting;
  }

  async request(op: RelayOp): Promise<RelayResponse> {
    try {
      await this.ready();
      switch (op.op) {
        case 'createQueue': {
          const id = `conn-${++this.invitationCount}`;
          await this.contacts.createInvitation({ id });
          const uri = this.contacts.invitationUri(id);
          const creds: QueueCredentials = { queueId: uri, sendKey: 'smp', rcvKey: id };
          return { ok: true, result: creds };
        }
        case 'send': {
          await this.contacts.sendText(op.queueId, op.ciphertext);
          return { ok: true, result: { id: `smp-${Date.now()}` } };
        }
        case 'read': {
          const msg = await Promise.resolve(this.contacts.receiveNext(op.queueId)).catch(() => null);
          if (!msg) return { ok: true, result: [] as StoredEnvelope[] };
          const env: StoredEnvelope = {
            id: String(msg.id ?? msg.messageId ?? Date.now()),
            ciphertext: String(msg.text ?? msg.body ?? ''),
            ts: Date.now(),
            expiresAt: Date.now() + TTL_MS,
          };
          return { ok: true, result: [env] };
        }
        case 'ack':
          // L'agent côté SMP (client) acquitte : no-op ici.
          return { ok: true, result: true };
        case 'delete': {
          await Promise.resolve(this.contacts.deleteContactEverywhere?.(op.queueId)).catch(() => undefined);
          return { ok: true, result: true };
        }
      }
    } catch (e) {
      return { ok: false, error: (e as Error)?.message ?? 'smp error' };
    }
  }
}
