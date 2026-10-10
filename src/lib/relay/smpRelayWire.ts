// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * `SmpRelayWire` — transport du mode privé via **SimpleX SMP, 100 % navigateur**.
 *
 * Implémente le contrat `RelayWire` (createQueue/send/read/ack/delete) au niveau
 * **file SMP**, ce qui correspond exactement au modèle « 2 files » du mode privé :
 *   • `createQueue`  : crée une file SMP (`NEW`), autorise une clé émetteur
 *     (`KEY`) et renvoie (a) nos identifiants de lecture, (b) le **bundle
 *     d'envoi** pour le pair (`sndId` + clé de signature), (c) une clé de lecture.
 *   • `send`  : `SEND` signé vers la file du pair (à partir du bundle, sans join).
 *   • `read`  : `SUB` + réception `MSG` + déchiffrement du corps (secret serveur).
 *   • `ack`/`delete` : `ACK` / `DEL`.
 *
 * Le corps des messages reste chiffré bout-en-bout par les clients (le relais ne
 * voit que des blocs opaques). S'appuie sur le cœur SMP navigateur vendoré
 * (`simplex-web`, AGPL-3).
 */

import { connectBrowserSmpWebSocketTransport } from '@/lib/simplexweb/browser-smp-websocket-transport.mjs';
import { createBrowserSimplexClient } from '@/lib/simplexweb/browser-simplex-client.mjs';
import {
  generateEd25519KeyPair,
  encodeBase64Url,
  decodeBase64Url,
  utf8Bytes,
  utf8Text,
} from '@/lib/simplexweb/browser-smp-core.mjs';
import { decryptRcvMessageBody } from '@/lib/simplexweb/browser-simplex-agent.mjs';
import type { RelayOp, RelayResponse, RelayWire } from './wire';
import type { QueueCredentials, StoredEnvelope } from './relayCore';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const READ_TIMEOUT_MS = 300;

/* eslint-disable @typescript-eslint/no-explicit-any */
function b64(bytes: Uint8Array): string {
  return encodeBase64Url(bytes);
}
function unb64(value: string): Uint8Array {
  return decodeBase64Url(value);
}
function token(obj: unknown): string {
  return b64(utf8Bytes(JSON.stringify(obj)));
}
function parseToken(value: string): any {
  return JSON.parse(utf8Text(unb64(value)));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface SmpRelayOptions {
  /** URL du relais SMP browser-profile (wss://…). */
  url: string;
  /** Hash d'identité du serveur (optionnel pour le profil navigateur). */
  keyHash?: string;
}

export class SmpRelayWire implements RelayWire {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  private connecting: Promise<void> | null = null;
  private readonly subscribed = new Set<string>();
  /** Sérialise les opérations : le transport SMP ne supporte pas les accès
   *  concurrents (les frames se volent). */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: SmpRelayOptions) {}

  private async ready(): Promise<void> {
    if (this.client) return;
    if (!this.connecting) {
      this.connecting = (async () => {
        const transport = await connectBrowserSmpWebSocketTransport({
          url: this.opts.url,
          keyHash: this.opts.keyHash ?? '',
        });
        this.client = createBrowserSimplexClient({ transport });
      })();
    }
    return this.connecting;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recipientFrom(queueId: string): any {
    const t = parseToken(queueId);
    return {
      server: t.server ?? null,
      queueMode: t.queueMode || 'messaging',
      rcvId: unb64(t.rcvId),
      rcvSignKey: { publicKeyDer: unb64(t.rcvSignPub), secretKey: unb64(t.rcvSignSec) },
      serverDhSecret: unb64(t.serverDhSecret),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private senderFrom(sendKey: string): any {
    const t = parseToken(sendKey);
    return {
      server: t.server ?? null,
      queueMode: t.queueMode || 'messaging',
      sndId: unb64(t.sndId),
      senderSignKey: { publicKeyDer: unb64(t.sndSignPub), secretKey: unb64(t.sndSignSec) },
    };
  }

  async request(op: RelayOp): Promise<RelayResponse> {
    const run = this.chain.then(
      () => this.doRequest(op),
      () => this.doRequest(op),
    );
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async doRequest(op: RelayOp): Promise<RelayResponse> {
    try {
      await this.ready();
      switch (op.op) {
        case 'createQueue': {
          // 1) file SMP (NEW) 2) autorise une clé émetteur (KEY).
          // (Pas de SUB ici : on s'abonne seulement à la LECTURE, sinon le
          // créateur capterait les messages destinés au pair.)
          const R = await this.client.createQueue({});
          const senderSign = generateEd25519KeyPair();
          await this.client.secureQueue(R, senderSign.publicKeyDer, {});

          const queueId = token({
            rcvId: b64(R.rcvId),
            rcvSignPub: b64(R.rcvSignKey.publicKeyDer),
            rcvSignSec: b64(R.rcvSignKey.secretKey),
            serverDhSecret: b64(R.serverDhSecret),
            server: R.server ?? null,
            queueMode: R.queueMode || 'messaging',
          });
          const sendKey = token({
            sndId: b64(R.sndId),
            sndSignPub: b64(senderSign.publicKeyDer),
            sndSignSec: b64(senderSign.secretKey),
            server: R.server ?? null,
            queueMode: R.queueMode || 'messaging',
          });
          const creds: QueueCredentials = { queueId, sendKey, rcvKey: 'r' };
          return { ok: true, result: creds };
        }
        case 'send': {
          const sender = this.senderFrom(op.queueKey);
          await this.client.sendQueueMessage(sender, utf8Bytes(op.ciphertext), {});
          return { ok: true, result: { id: `smp-${Date.now()}` } };
        }
        case 'read': {
          const R = this.recipientFrom(op.queueId); if (!this.subscribed.has(op.queueId)) {
            await this.client.subscribeQueue(R, {});
            this.subscribed.add(op.queueId);
          }
          let message: { msgId: Uint8Array; body: Uint8Array };
          try {
            message = (await this.client.receiveQueueMessage(R, { timeoutMs: READ_TIMEOUT_MS })).message;
          } catch {
            return { ok: true, result: [] as StoredEnvelope[] };
          }
          const decrypted = decryptRcvMessageBody({
            serverDhSecret: R.serverDhSecret,
            msgId: message.msgId,
            encryptedBody: message.body,
          });
          const env: StoredEnvelope = {
            id: b64(message.msgId),
            ciphertext: utf8Text(decrypted.body),
            ts: Date.now(),
            expiresAt: Date.now() + TTL_MS,
          };
          return { ok: true, result: [env] };
        }
        case 'ack': {
          const R = this.recipientFrom(op.queueId);
          for (const id of op.ids ?? []) {
            await this.client.acknowledgeMessage(R, unb64(id), {});
          }
          return { ok: true, result: true };
        }
        case 'delete': {
          const R = this.recipientFrom(op.queueId);
          await this.client.deleteQueue(R, {});
          return { ok: true, result: true };
        }
      }
    } catch (e) {
      console.error('[smpRelayWire] op', op.op, 'failed:', e);
      return { ok: false, error: (e as Error)?.message ?? 'smp error' };
    }
  }
}

