// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Mode privé anonyme (modèle SimpleX pour le 1:1) — OPT-IN, non intrusif.
 *
 * Combine :
 *   • le **relais sans identifiants** (aucune notion d'utilisateur côté serveur) ;
 *   • des **identités locales éphémères** par connexion (aucun compte, aucune
 *     clé publiée sur un serveur) ;
 *   • un **lien d'invitation hors-bande** qui transporte le bundle X3DH et les
 *     adresses de files (comme le lien de connexion SimpleX) ;
 *   • le **Double Ratchet** (forward secrecy) entre les deux pairs.
 *
 * Conséquence : le serveur ne voit ni identités, ni graphe social, ni contenu —
 * uniquement des files opaques et du ciphertext. C'est le niveau SimpleX pour
 * une conversation directe.
 *
 * Ne modifie pas l'appli existante : ce module est un chemin parallèle,
 * activable au choix (il ne touche pas à Supabase).
 */

import {
  initReceiverSession,
  initSenderSession,
  ratchetDecrypt,
  ratchetEncrypt,
  signPreKey,
  x3dhInitiate,
  x3dhRespond,
  type RatchetHeader,
  type RatchetMessage,
  type SessionState,
} from '../ratchet/index';
import {
  generateLocalRatchetKeys,
  type LocalRatchetKeys,
  type PeerBundle,
} from '../ratchet/service';
import { base64ToBytes, bytesToBase64, utf8 } from '../ratchet/primitives';
import { RelayTransport, type RelayQueueRef } from './relayTransport';
import type { RelayWire } from './wire';
import type {
  PendingInit,
  PrivateConnectionRecord,
  PrivateConnectionStore,
} from './connectionStore';
import type { PrivateHistoryStore, PrivateMessageRecord } from './historyStore';

/** Marqueur des messages de couverture (brouillage) — jamais affichés. */
export const COVER_MARKER = '\u0000NPT-COVER';

/** Préfixe des messages de contrôle (rotation de file) — jamais affichés. */
const CONTROL_PREFIX = '\u0000NPT-CTRL:';

/** Préfixe des messages-fichier (descripteur chiffré) — rendus comme fichiers. */
export const FILE_MARKER = '\u0000NPT-FILE:';

export function encodeFileMessage(descriptor: unknown): string {
  return FILE_MARKER + JSON.stringify(descriptor);
}

export function parseFileMessage(text: string): unknown | null {
  if (!text.startsWith(FILE_MARKER)) return null;
  try {
    return JSON.parse(text.slice(FILE_MARKER.length));
  } catch {
    return null;
  }
}

/** Message tel qu'il circule dans le relais (opaque, base64). */
interface WireMessage {
  header: RatchetHeader;
  iv: string;
  ct: string;
  init: PendingInit | null;
}

function pack(message: WireMessage): string {
  return bytesToBase64(utf8(JSON.stringify(message)));
}

function unpack(raw: string): WireMessage {
  return JSON.parse(new TextDecoder().decode(base64ToBytes(raw))) as WireMessage;
}

export interface PrivateInvite {
  /** Lien hors-bande à transmettre (QR, message, etc.). */
  link: string;
}

export class PrivateMessenger {
  private readonly relay: RelayTransport;

  constructor(
    wire: RelayWire,
    private readonly store: PrivateConnectionStore,
    pollMs = 1500,
    private readonly historyStore?: PrivateHistoryStore,
  ) {
    this.relay = new RelayTransport(wire, pollMs);
  }

  /** Historique local des messages d'une connexion (persistant). */
  async history(conversationId: string): Promise<PrivateMessageRecord[]> {
    return this.historyStore ? this.historyStore.load(conversationId) : [];
  }

  /** Supprime l'historique local d'une connexion. */
  async clearHistory(conversationId: string): Promise<void> {
    if (this.historyStore) await this.historyStore.clear(conversationId);
  }

  /**
   * Démarre un **trafic de couverture** : envoie périodiquement des messages
   * factices (indiscernables des vrais au niveau du relais) pour brouiller
   * l'analyse de timing/volume. Retourne une fonction d'arrêt.
   */
  startCoverTraffic(conversationId: string, everyMs = 30_000): () => void {
    const timer = setInterval(() => {
      this.send(conversationId, COVER_MARKER).catch(() => undefined);
    }, everyMs);
    return () => clearInterval(timer);
  }

  // ─── Rotation de file (anti-corrélation longue durée) ──────────────

  private async sendControl(conversationId: string, control: unknown): Promise<void> {
    const record = await this.store.load(conversationId);
    if (!record?.session) throw new Error('Mode privé: session absente');

    const message = await ratchetEncrypt(record.session, CONTROL_PREFIX + JSON.stringify(control));
    const wire: WireMessage = {
      header: message.header,
      iv: message.ivB64,
      ct: message.ctB64,
      init: record.pendingInit,
    };
    record.pendingInit = null;
    await this.relay.sendMessage({
      conversationId,
      senderId: 'private',
      content: pack(wire),
      type: 'text',
    });
    await this.store.save(record);
  }

  private async handleControl(conversationId: string, json: string): Promise<void> {
    try {
      const control = JSON.parse(json) as { rotateTo?: RelayQueueRef };
      if (control.rotateTo) {
        this.relay.setSendQueue(conversationId, control.rotateTo);
        const record = await this.store.load(conversationId);
        if (record) {
          record.relay = { ...record.relay, sendQueue: control.rotateTo };
          await this.store.save(record);
        }
      }
    } catch {
      // contrôle illisible → ignoré
    }
  }

  /**
   * **Rotation de file** : crée une nouvelle file de réception, l'annonce au
   * pair (message de contrôle chiffré), laisse l'ancienne s'écouler (grâce)
   * puis la supprime. Empêche de corréler durablement les messages à une même
   * file côté relais.
   */
  async rotateQueue(conversationId: string, graceMs = 15_000): Promise<void> {
    const record = await this.store.load(conversationId);
    if (!record?.session) throw new Error('Mode privé: session absente');

    const previous = record.relay.rcvQueue;
    const { ourRcv, peerRef } = await this.relay.createReceiveQueue();
    this.relay.addReceiveQueue(conversationId, ourRcv);
    record.relay = { ...record.relay, rcvQueue: ourRcv };
    await this.store.save(record);

    await this.sendControl(conversationId, { rotateTo: peerRef });

    setTimeout(() => {
      this.relay.removeReceiveQueue(conversationId, previous, true).catch(() => undefined);
    }, graceMs);
  }

  /** Démarre une rotation périodique de la file de réception. */
  startQueueRotation(conversationId: string, everyMs = 5 * 60 * 1000, graceMs = 15_000): () => void {
    const timer = setInterval(() => {
      this.rotateQueue(conversationId, graceMs).catch(() => undefined);
    }, everyMs);
    return () => clearInterval(timer);
  }

  /** Liste les connexions privées stockées localement. */
  async listConnections(): Promise<PrivateConnectionRecord[]> {
    return this.store.list();
  }

  /** Oublie une connexion (supprime le mapping local). */
  async forget(conversationId: string): Promise<void> {
    await this.store.remove(conversationId);
  }

  /**
   * Crée une connexion privée : génère les files du relais + des clés locales,
   * et renvoie le lien d'invitation à transmettre hors-bande.
   */
  async establish(conversationId: string): Promise<PrivateInvite> {
    const { connection, invite: relayInvite } = await this.relay.createConnection();
    this.relay.registerConnection(conversationId, connection);
    const localKeys = generateLocalRatchetKeys();
    const oneTimePreKey = Object.keys(localKeys.oneTimePreKeys)[0] ?? null;

    const bundle: PeerBundle = {
      identityKey: localKeys.identityKeyPair.publicKey,
      signingKey: localKeys.signingKeyPair.publicKey,
      signedPreKey: localKeys.signedPreKey.publicKey,
      signedPreKeySignature: signPreKey(localKeys.signingKeyPair.privateKey, localKeys.signedPreKey.publicKey),
      oneTimePreKey,
    };

    const link = bytesToBase64(utf8(JSON.stringify({ r: relayInvite, b: bundle })));
    await this.store.save({
      conversationId,
      relay: connection,
      localKeys,
      session: null,
      pendingInit: null,
    });
    return { link };
  }

  /** Rejoint une connexion privée à partir d'un lien d'invitation (initiateur). */
  async accept(conversationId: string, link: string): Promise<void> {
    const parsed = JSON.parse(new TextDecoder().decode(base64ToBytes(link))) as {
      r: string;
      b: PeerBundle;
    };
    const connection = this.relay.acceptInvite(conversationId, parsed.r);
    const localKeys = generateLocalRatchetKeys();

    const init = await x3dhInitiate(localKeys.identityKeyPair, parsed.b);
    const session = await initSenderSession(
      init.rootKey,
      parsed.b.signedPreKey,
      init.associatedData,
      init.ratchetKeyPair,
    );

    await this.store.save({
      conversationId,
      relay: connection,
      localKeys,
      session,
      pendingInit: {
        identityKey: localKeys.identityKeyPair.publicKey,
        ephemeralPublicKey: init.ephemeralPublicKey,
        usedOneTimePreKey: parsed.b.oneTimePreKey ?? null,
      },
    });
  }

  /** Envoie un message privé (chiffré E2EE via ratchet, livré par le relais). */
  async send(conversationId: string, plaintext: string): Promise<void> {
    const record = await this.store.load(conversationId);
    if (!record?.session) throw new Error('Mode privé: session absente (connexion non établie)');

    const message: RatchetMessage = await ratchetEncrypt(record.session, plaintext);
    const wire: WireMessage = {
      header: message.header,
      iv: message.ivB64,
      ct: message.ctB64,
      init: record.pendingInit,
    };

    record.pendingInit = null;
    await this.relay.sendMessage({
      conversationId,
      senderId: 'private',
      content: pack(wire),
      type: 'text',
    });
    await this.store.save(record);

    // Persiste l'historique local (jamais les messages de couverture).
    if (this.historyStore && plaintext !== COVER_MARKER) {
      await this.historyStore.append({
        conversationId,
        id: `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: plaintext,
        mine: true,
        ts: Date.now(),
      });
    }
  }

  /** Envoie un descripteur de fichier (le fichier est déjà chiffré+uploadé). */
  async sendFile(conversationId: string, descriptor: unknown): Promise<void> {
    await this.send(conversationId, encodeFileMessage(descriptor));
  }

  /** Écoute les messages privés entrants et livre le clair. */
  subscribe(conversationId: string, onPlaintext: (text: string) => void): () => void {
    return this.relay.subscribe(conversationId, async incoming => {
      try {
        const wire = unpack(incoming.content);
        const record = await this.store.load(conversationId);
        if (!record) return;

        let session: SessionState | null = record.session;
        if (!session) {
          if (!wire.init) return; // pas de session et pas d'init → indéchiffrable
          const opkPublic = wire.init.usedOneTimePreKey;
          const opkPrivate = opkPublic ? record.localKeys.oneTimePreKeys[opkPublic] : null;
          const response = await x3dhRespond(
            record.localKeys.identityKeyPair,
            record.localKeys.signedPreKey,
            opkPublic && opkPrivate ? { privateKey: opkPrivate, publicKey: opkPublic } : null,
            wire.init.identityKey,
            wire.init.ephemeralPublicKey,
          );
          session = initReceiverSession(response.rootKey, record.localKeys.signedPreKey, response.associatedData);
        }

        const text = await ratchetDecrypt(session, {
          header: wire.header,
          ivB64: wire.iv,
          ctB64: wire.ct,
        });
        record.session = session;
        await this.store.save(record);

        // Messages de contrôle (rotation de file) : traités, jamais affichés.
        if (text.startsWith(CONTROL_PREFIX)) {
          await this.handleControl(conversationId, text.slice(CONTROL_PREFIX.length));
          return;
        }
        // Ignore le trafic de couverture ; persiste le reste localement.
        if (text === COVER_MARKER) return;
        if (this.historyStore) {
          await this.historyStore.append({
            conversationId,
            id: `in-${incoming.id}`,
            text,
            mine: false,
            ts: Date.now(),
          });
        }
        onPlaintext(text);
      } catch (e) {
        console.warn('[private] déchiffrement échoué:', e);
      }
    });
  }
}
