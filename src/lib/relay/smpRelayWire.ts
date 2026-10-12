// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * `SmpRelayWire` — transport du mode privé via **SMP SMP, 100 % navigateur**.
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
 * (`smp-web`, AGPL-3).
 */

import { connectBrowserSmpWebSocketTransport } from '@/lib/smpweb/browser-smp-websocket-transport.mjs';
import { createBrowserSmpClient } from '@/lib/smpweb/browser-smp-client.mjs';
import {
  generateEd25519KeyPair,
  encodeBase64Url,
  decodeBase64Url,
  utf8Bytes,
  utf8Text,
} from '@/lib/smpweb/browser-smp-core.mjs';
import { decryptRcvMessageBody } from '@/lib/smpweb/browser-smp-agent.mjs';
import type { RelayOp, RelayResponse, RelayWire } from './wire';
import type { QueueCredentials, StoredEnvelope } from './relayCore';
import { netLog } from './netLog';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const READ_TIMEOUT_MS = 300;
/**
 * Drainage : au plus N enveloppes renvoyées par `read`. Le relais SMP stocke les
 * messages côté serveur (pas de suppression à la lecture : l'`ack` les retire),
 * et le client vendoré met en tampon (`rememberPending`) les messages reçus mais
 * non consommés. On peut donc lire plusieurs fois de suite sans I/O tant qu'il
 * reste des enveloppes en attente — ce qui augmente le débit sans changer
 * l'ordre ni risquer perte/duplication.
 *
 * Configurable via `VITE_SMP_READ_MAX` (défaut 100), borné à [1, 1000] : toute
 * valeur absente, non numérique ou hors bornes est ramenée dans l'intervalle
 * (une valeur non numérique retombe sur le défaut).
 */
const READ_MAX_DEFAULT = 100;
const READ_MAX_MIN = 1;
const READ_MAX_MAX = 1000;
export const MAX_READ_ENVELOPES = ((): number => {
  const raw = Number(import.meta.env.VITE_SMP_READ_MAX ?? READ_MAX_DEFAULT);
  if (!Number.isFinite(raw)) return READ_MAX_DEFAULT;
  return Math.min(Math.max(Math.trunc(raw), READ_MAX_MIN), READ_MAX_MAX);
})();
/** Délai (ms) des lectures de drainage après la première (attente longue). */
const DRAIN_TIMEOUT_MS = 1;

/* eslint-disable @typescript-eslint/no-explicit-any */
function b64(bytes: Uint8Array): string {
  return encodeBase64Url(bytes);
}
function unb64(value: string): Uint8Array {
  return decodeBase64Url(value);
}
/**
 * Tokens de file SMP **compacts** : champs joints par `|`. Les clés sont déjà en
 * base64url ; l'URL du serveur et le mode sont base64url-encodés. On supprime le
 * `base64(JSON(...))` qui doublait l'encodage et gonflait l'invitation (QR code).
 * Compatibilité ascendante assurée pour l'ancien format base64(JSON).
 */
function encField(value: string | null | undefined): string {
  return value ? b64(utf8Bytes(value)) : '';
}
function decField(value: string | undefined): string | null {
  return value ? utf8Text(unb64(value)) : null;
}
interface RecipientToken {
  server: string | null;
  queueMode: string;
  rcvId: string;
  rcvSignPub: string;
  rcvSignSec: string;
  serverDhSecret: string;
}
interface SenderToken {
  server: string | null;
  queueMode: string;
  sndId: string;
  sndSignPub: string;
  sndSignSec: string;
}
function recipientToken(f: RecipientToken): string {
  return [encField(f.server), encField(f.queueMode), f.rcvId, f.rcvSignPub, f.rcvSignSec, f.serverDhSecret].join('|');
}
function parseRecipientToken(value: string): RecipientToken {
  if (!value.includes('|')) {
    const t = JSON.parse(utf8Text(unb64(value)));
    return {
      server: t.server ?? null,
      queueMode: t.queueMode || 'messaging',
      rcvId: t.rcvId,
      rcvSignPub: t.rcvSignPub,
      rcvSignSec: t.rcvSignSec,
      serverDhSecret: t.serverDhSecret,
    };
  }
  const p = value.split('|');
  return {
    server: decField(p[0]),
    queueMode: decField(p[1]) || 'messaging',
    rcvId: p[2] ?? '',
    rcvSignPub: p[3] ?? '',
    rcvSignSec: p[4] ?? '',
    serverDhSecret: p[5] ?? '',
  };
}
function senderToken(f: SenderToken): string {
  return [encField(f.server), encField(f.queueMode), f.sndId, f.sndSignPub, f.sndSignSec].join('|');
}
function parseSenderToken(value: string): SenderToken {
  if (!value.includes('|')) {
    const t = JSON.parse(utf8Text(unb64(value)));
    return {
      server: t.server ?? null,
      queueMode: t.queueMode || 'messaging',
      sndId: t.sndId,
      sndSignPub: t.sndSignPub,
      sndSignSec: t.sndSignSec,
    };
  }
  const p = value.split('|');
  return {
    server: decField(p[0]),
    queueMode: decField(p[1]) || 'messaging',
    sndId: p[2] ?? '',
    sndSignPub: p[3] ?? '',
    sndSignSec: p[4] ?? '',
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface SmpRelayOptions {
  /** URL du relais SMP browser-profile (wss://…). */
  url: string;
  /** Hash d'identité du serveur (optionnel pour le profil navigateur). */
  keyHash?: string;
  /**
   * Fabrique d'un `WebSocketImpl` alternatif (ex. socket Tor WASM adossé à
   * `tor-js`). Par défaut : le WebSocket natif du navigateur.
   */
  webSocketImplFactory?: () => Promise<unknown>;
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
        const WebSocketImpl = this.opts.webSocketImplFactory
          ? await this.opts.webSocketImplFactory()
          : undefined;
        const base = {
          url: this.opts.url,
          keyHash: this.opts.keyHash ?? '',
          WebSocketImpl,
        };
        // Certains serveurs SMP (ex. tiers) refusent le sous-protocole WS : on
        // réessaie sans sous-protocole si la première tentative échoue. Le
        // sous-protocole est donc dépendant du serveur, pas figé.
        let transport;
        try {
          transport = await connectBrowserSmpWebSocketTransport({
            ...base,
            protocols: ['smp.v4.ws'],
          });
        } catch {
          transport = await connectBrowserSmpWebSocketTransport({ ...base, protocols: [] });
        }
        this.client = createBrowserSmpClient({ transport });
      })();
    }
    return this.connecting;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recipientFrom(queueId: string): any {
    const t = parseRecipientToken(queueId);
    return {
      server: t.server,
      queueMode: t.queueMode,
      rcvId: unb64(t.rcvId),
      rcvSignKey: { publicKeyDer: unb64(t.rcvSignPub), secretKey: unb64(t.rcvSignSec) },
      serverDhSecret: unb64(t.serverDhSecret),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private senderFrom(sendKey: string): any {
    const t = parseSenderToken(sendKey);
    return {
      server: t.server,
      queueMode: t.queueMode,
      sndId: unb64(t.sndId),
      senderSignKey: { publicKeyDer: unb64(t.sndSignPub), secretKey: unb64(t.sndSignSec) },
    };
  }

  async request(op: RelayOp): Promise<RelayResponse> {
    const t0 = Date.now();
    const run = this.chain.then(
      () => this.doRequest(op),
      () => this.doRequest(op),
    );
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    const resp = await run;
    netLog({
      layer: 'smp',
      op: op.op,
      status: resp.ok ? 'ok' : 'fail',
      endpoint: this.opts.url,
      detail: resp.ok ? undefined : resp.error,
      ms: Date.now() - t0,
    });
    return resp;
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

          const queueId = recipientToken({
            server: R.server ?? null,
            queueMode: R.queueMode || 'messaging',
            rcvId: b64(R.rcvId),
            rcvSignPub: b64(R.rcvSignKey.publicKeyDer),
            rcvSignSec: b64(R.rcvSignKey.secretKey),
            serverDhSecret: b64(R.serverDhSecret),
          });
          const sendKey = senderToken({
            server: R.server ?? null,
            queueMode: R.queueMode || 'messaging',
            sndId: b64(R.sndId),
            sndSignPub: b64(senderSign.publicKeyDer),
            sndSignSec: b64(senderSign.secretKey),
          });
          const creds: QueueCredentials = {
            queueId,
            sendKey,
            rcvKey: 'r',
            // Tag systématique du relais hôte (routage par file, failover).
            relay: this.opts.url,
          };
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
          // Drainage borné : la première lecture attend un message (READ_TIMEOUT_MS),
          // les suivantes ne font que vider ce qui est déjà en attente. On ne
          // renvoie chaque message qu'une fois (le client SMP le retire de son
          // tampon), et on n'acquitte jamais ici : l'`ack` reste à la charge de
          // l'appelant → aucune perte ni duplication.
          const limit = Math.min(
            Math.max(Math.trunc(op.limit ?? MAX_READ_ENVELOPES) || MAX_READ_ENVELOPES, 1),
            MAX_READ_ENVELOPES,
          );
          const envelopes: StoredEnvelope[] = [];
          for (let i = 0; i < limit; i++) {
            let message: { msgId: Uint8Array; body: Uint8Array };
            try {
              message = (await this.client.receiveQueueMessage(R, {
                timeoutMs: i === 0 ? READ_TIMEOUT_MS : DRAIN_TIMEOUT_MS,
                maxBatches: i === 0 ? undefined : 1,
              })).message;
            } catch {
              // Plus d'enveloppe en attente (timeout) → fin du drainage.
              break;
            }
            const decrypted = decryptRcvMessageBody({
              serverDhSecret: R.serverDhSecret,
              msgId: message.msgId,
              encryptedBody: message.body,
            });
            envelopes.push({
              id: b64(message.msgId),
              ciphertext: utf8Text(decrypted.body),
              ts: Date.now(),
              expiresAt: Date.now() + TTL_MS,
            });
          }
          return { ok: true, result: envelopes };
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

  /** Tag `relay` des files hébergées par ce relais (routage par file). */
  get relayIds(): string[] {
    return [this.opts.url];
  }
}

