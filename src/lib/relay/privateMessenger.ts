// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Mode privé anonyme (modèle SMP pour le 1:1) — OPT-IN, non intrusif.
 *
 * Combine :
 *   • le **relais sans identifiants** (aucune notion d'utilisateur côté serveur) ;
 *   • des **identités locales éphémères** par connexion (aucun compte, aucune
 *     clé publiée sur un serveur) ;
 *   • un **lien d'invitation hors-bande** qui transporte le bundle X3DH et les
 *     adresses de files (comme le lien de connexion SMP) ;
 *   • le **Double Ratchet** (forward secrecy) entre les deux pairs.
 *
 * Conséquence : le serveur ne voit ni identités, ni graphe social, ni contenu —
 * uniquement des files opaques et du ciphertext. C'est le niveau SMP pour
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
  assertPqNotDowngraded,
  type LocalRatchetKeys,
  type PeerBundle,
} from '../ratchet/service';
import { base64ToBytes, bytesToBase64, utf8 } from '../ratchet/primitives';
import { deflate, inflate } from 'pako';
import { RelayTransport, type RelayQueueRef } from './relayTransport';
import type { RelayWire } from './wire';
import { CALL_MARKER } from './callSignaling';
import { STATUS_MARKER } from './statusStore';
import type {
  PendingInit,
  PrivateConnectionRecord,
  PrivateConnectionStore,
} from './connectionStore';
import type { PrivateHistoryStore, PrivateMessageRecord } from './historyStore';
import { COVER_TRAFFIC_PROFILES, getCoverTrafficIntensity } from '../privacyPrefs';

/**
 * Marqueur des messages de couverture (brouillage) — jamais affichés.
 *
 * Marqueur **réservé** en tête de charge utile : les messages de couverture
 * portent un remplissage variable après le marqueur (`COVER_MARKER + filler`),
 * d'où la détection par préfixe (`startsWith`) et non par égalité stricte. Un
 * pair ne le voit jamais comme message applicatif : il est filtré au
 * déchiffrement et jamais persisté.
 */
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

/**
 * Vrai pour un message de CONTRÔLE ÉPHÉMÈRE (couverture, rotation de file,
 * signalisation d'appel, statut) : jamais persisté dans l'historique local, et
 * filtré au chargement (après un rechargement l'UI ne doit pas réafficher les
 * marqueurs bruts `CALL`/`STATUS`).
 *
 * La couverture est détectée par **préfixe** : sa charge utile est
 * `COVER_MARKER + remplissage` (taille réaliste), pas le marqueur nu.
 */
function isTransientMessage(text: string): boolean {
  return (
    text.startsWith(COVER_MARKER) ||
    text.startsWith(CONTROL_PREFIX) ||
    text.startsWith(CALL_MARKER) ||
    text.startsWith(STATUS_MARKER)
  );
}

/**
 * Paramètres du trafic de couverture. Bornes **temporelles** (aucune période
 * fixe) et probabilités de salve. Toutes optionnelles : les valeurs par défaut
 * proviennent de l'intensité configurée dans `privacyPrefs`.
 */
export interface CoverTrafficOptions {
  minIntervalMs?: number;
  maxIntervalMs?: number;
  burstProbability?: number;
  tripleProbability?: number;
}

/**
 * Paliers de taille (octets) des charges utiles de couverture. On réutilise le
 * **principe de paliers** du rembourrage texte existant (`TEXT_PAD_BUCKETS`,
 * `textEncryption.ts`) pour que la couverture tombe sur des tailles plausibles
 * de message réel — au lieu de l'ancien marqueur nu (~10 o), signature
 * immédiate d'analyse de taille côté relais. Borné volontairement bas : pas de
 * tailles aberrantes (le chemin ratchet n'applique pas de rembourrage).
 */
const COVER_SIZE_BUCKETS: readonly number[] = [32, 48, 80, 128, 192, 256, 384];
/** Bornes de la salve (imite une courte conversation). */
const COVER_BURST_MAX = 3;
const COVER_BURST_GAP_MIN_MS = 1_200;
const COVER_BURST_GAP_MAX_MS = 4_500;
const COVER_FILLER_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Entier aléatoire uniforme dans `[min, max]` (inclus). */
function randomIntBetween(min: number, max: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return Math.max(0, Math.floor(min) || 0);
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Remplissage aléatoire ASCII (1 caractère = 1 octet) — jamais du contenu réel. */
function randomFiller(length: number): string {
  if (length <= 0) return '';
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < length; i++) out += COVER_FILLER_ALPHABET[bytes[i] & 63];
  return out;
}

/** Taille cible (octets) tirée des paliers, biaisée vers les messages courts. */
function pickCoverSizeBytes(): number {
  const n = COVER_SIZE_BUCKETS.length;
  const idx = Math.min(n - 1, Math.floor(Math.random() * Math.random() * n));
  return COVER_SIZE_BUCKETS[idx];
}

/**
 * Charge utile de couverture : marqueur réservé + remplissage aléatoire de
 * taille réaliste. Aucun contenu utilisateur n'y transite.
 */
function buildCoverPayload(): string {
  const filler = Math.max(0, pickCoverSizeBytes() - COVER_MARKER.length);
  return COVER_MARKER + randomFiller(filler);
}

interface ResolvedCoverOptions {
  minIntervalMs: number;
  maxIntervalMs: number;
  burstProbability: number;
  tripleProbability: number;
}

/** Fusionne les options explicites avec le profil d'intensité configuré. */
function resolveCoverOptions(options?: number | CoverTrafficOptions): ResolvedCoverOptions {
  const profile = COVER_TRAFFIC_PROFILES[getCoverTrafficIntensity()];
  const resolved: ResolvedCoverOptions = {
    minIntervalMs: profile.minIntervalMs,
    maxIntervalMs: profile.maxIntervalMs,
    burstProbability: profile.burstProbability,
    tripleProbability: profile.tripleProbability,
  };
  // Rétro-compatibilité : l'ancien second paramètre était `everyMs` (période
  // fixe). Il devient la borne BASSE d'un intervalle aléatoire équivalent.
  if (typeof options === 'number') {
    if (Number.isFinite(options) && options > 0) {
      resolved.minIntervalMs = options;
      resolved.maxIntervalMs = Math.max(options * 3, options + 1);
    }
    return resolved;
  }
  if (options && typeof options === 'object') {
    if (typeof options.minIntervalMs === 'number') resolved.minIntervalMs = options.minIntervalMs;
    if (typeof options.maxIntervalMs === 'number') resolved.maxIntervalMs = options.maxIntervalMs;
    if (typeof options.burstProbability === 'number') resolved.burstProbability = options.burstProbability;
    if (typeof options.tripleProbability === 'number') resolved.tripleProbability = options.tripleProbability;
  }
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  resolved.burstProbability = clamp01(resolved.burstProbability);
  resolved.tripleProbability = clamp01(resolved.tripleProbability);
  if (!(resolved.minIntervalMs > 0)) resolved.minIntervalMs = 1;
  if (resolved.maxIntervalMs < resolved.minIntervalMs) resolved.maxIntervalMs = resolved.minIntervalMs;
  return resolved;
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

/**
 * Lien d'invitation **compressé** (deflate) : la clé ML-KEM (1184 o) rendait le
 * base64(JSON) trop long pour un QR code. On compresse → le QR tient.
 * Rétro-compatibilité avec l'ancien format base64(JSON).
 */
function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function fromB64Url(value: string): Uint8Array {
  let b64 = value.replaceAll('-', '+').replaceAll('_', '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
interface PrivateLinkPayload {
  r: string;
  b: PeerBundle;
}
function encodePrivateLink(payload: PrivateLinkPayload): string {
  const json = utf8(JSON.stringify(payload));
  return 'n1' + toB64Url(deflate(json, { level: 9 }));
}
function decodePrivateLink(link: string): PrivateLinkPayload {
  const trimmed = link.trim();
  if (trimmed.startsWith('n1')) {
    const out = inflate(fromB64Url(trimmed.slice(2)));
    return JSON.parse(new TextDecoder().decode(out)) as PrivateLinkPayload;
  }
  return JSON.parse(new TextDecoder().decode(base64ToBytes(trimmed))) as PrivateLinkPayload;
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
    const rows = this.historyStore ? await this.historyStore.load(conversationId) : [];
    // Filtre défensif : aucun marqueur de contrôle (appel/statut/rotation) ne
    // doit être affiché, même si une version antérieure les a persistés.
    return rows.filter(r => !isTransientMessage(r.text));
  }

  /** Supprime l'historique local d'une connexion. */
  async clearHistory(conversationId: string): Promise<void> {
    if (this.historyStore) await this.historyStore.clear(conversationId);
  }

  /**
   * Démarre un **trafic de couverture** : envoie des messages factices de
   * taille réaliste, à **intervalles aléatoires** (jamais de cadence fixe),
   * avec du jitter, et des **salves** occasionnelles (2–3 messages) imitant une
   * conversation. Les messages passent par le MÊME chemin que les vrais
   * (ratchet chiffré + dépôt relais) : indiscernables pour le relais ; filtrés
   * côté pair (jamais affichés, jamais persistés).
   *
   * Cycle de vie : `setTimeout` récursif (pas de `setInterval`), les erreurs
   * d'envoi n'interrompent pas la boucle (reprise au tick suivant), le retour
   * au premier plan replanifie une salve (onglet réveillé), et la fonction
   * d'arrêt retournée est **idempotente** (arrêt net : timers + listener).
   *
   * Rétro-compatibilité : `options` peut être l'ancien `everyMs` (nombre), qui
   * devient alors la borne basse de l'intervalle aléatoire.
   */
  startCoverTraffic(conversationId: string, options?: number | CoverTrafficOptions): () => void {
    const opts = resolveCoverOptions(options);
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let gapTimer: ReturnType<typeof setTimeout> | null = null;
    let gapResolve: (() => void) | null = null;

    /** Attente d'inter-salve, interruptible par `stop()` (ne pas suspendre l'UI). */
    const waitGap = (ms: number): Promise<void> =>
      new Promise<void>(resolve => {
        gapResolve = resolve;
        gapTimer = setTimeout(() => {
          gapTimer = null;
          gapResolve = null;
          resolve();
        }, ms);
      });

    const emitOne = async (): Promise<void> => {
      try {
        await this.send(conversationId, buildCoverPayload());
      } catch {
        // Session absente / relais indisponible : on n'interrompt PAS la
        // boucle (reprise propre au tick suivant), et on ne bloque jamais l'UI.
      }
    };

    const scheduleNext = (): void => {
      if (stopped) return;
      timer = setTimeout(run, randomIntBetween(opts.minIntervalMs, opts.maxIntervalMs));
    };

    const run = (): void => {
      if (stopped || running) return;
      running = true;
      const burst =
        Math.random() < opts.burstProbability
          ? Math.random() < opts.tripleProbability
            ? 3
            : 2
          : 1;
      void (async () => {
        const count = Math.min(burst, COVER_BURST_MAX);
        for (let i = 0; i < count; i++) {
          if (stopped) return;
          await emitOne();
          if (stopped || i === count - 1) return;
          await waitGap(randomIntBetween(COVER_BURST_GAP_MIN_MS, COVER_BURST_GAP_MAX_MS));
        }
      })()
        .catch(() => undefined)
        .finally(() => {
          running = false;
          scheduleNext();
        });
    };

    // Reprise propre après une mise en veille de l'onglet : les navigateurs
    // suspendent/throttlent les timers en arrière-plan ; au retour au premier
    // plan, on replanifie une salve pour ne pas rester muet.
    const onVisibility = (): void => {
      if (stopped || running) return;
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      timer = setTimeout(run, randomIntBetween(1_000, 5_000));
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    scheduleNext();

    return () => {
      if (stopped) return;
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (gapTimer) {
        clearTimeout(gapTimer);
        gapTimer = null;
      }
      gapResolve?.();
      gapResolve = null;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
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
      signedPreKeySignature: signPreKey(localKeys.signingKeyPair.privateKey, localKeys.signedPreKey.publicKey, localKeys.mlKemKeyPair?.publicKey),
      oneTimePreKey,
      mlKemPublicKey: localKeys.mlKemKeyPair?.publicKey ?? null,
    };

    const link = encodePrivateLink({ r: relayInvite, b: bundle });
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
    const parsed = decodePrivateLink(link);
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
        mlKemCiphertext: init.mlKemCiphertext ?? null,
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

    // Persiste l'historique local (jamais les messages de contrôle éphémères :
    // couverture, appels, statuts).
    if (this.historyStore && !isTransientMessage(plaintext)) {
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

  /** Charge les connexions stockées et les (ré)enregistre dans le transport. */
  async refreshConnections(): Promise<void> {
    const records = await this.store.list();
    for (const r of records) this.relay.registerConnection(r.conversationId, r.relay);
  }

  private async ensureRegistered(conversationId: string): Promise<void> {
    const record = await this.store.load(conversationId);
    if (record) this.relay.registerConnection(conversationId, record.relay);
  }

  /** Écoute les messages privés entrants et livre le clair. */
  subscribe(conversationId: string, onPlaintext: (text: string) => void): () => void {
    let stopped = false;
    let relayUnsub: (() => void) | null = null;

    void (async () => {
      // Après un rechargement, la connexion n'est plus en mémoire : on la
      // ré-enregistre depuis le stockage local AVANT de s'abonner (sinon le
      // transport lève « aucune connexion pour cette conversation »).
      await this.ensureRegistered(conversationId);
      if (stopped) return;
      try {
        relayUnsub = this.relay.subscribe(conversationId, async incoming => {
          try {
            const wire = unpack(incoming.content);
            const record = await this.store.load(conversationId);
            if (!record) return;

            let session: SessionState | null = record.session;
            if (!session) {
              if (!wire.init) return; // pas de session et pas d'init → indéchiffrable
              // Fail-closed anti-downgrade post-quantique : identique au chemin
              // `ratchet/service.ts`. Si nous avons publié une clé ML-KEM, tout
              // `ratchet-init` doit transporter la partie PQ — sinon on REFUSE
              // plutôt que d'établir une session en mode dégradé silencieux.
              assertPqNotDowngraded(record.localKeys, {
                type: 'ratchet-init',
                v: 1,
                header: wire.header,
                iv: wire.iv,
                pq: !!wire.init.mlKemCiphertext,
                mlKemCiphertext: wire.init.mlKemCiphertext ?? null,
              });
              const opkPublic = wire.init.usedOneTimePreKey;
              const opkPrivate = opkPublic ? record.localKeys.oneTimePreKeys[opkPublic] : null;
              const response = await x3dhRespond(
                record.localKeys.identityKeyPair,
                record.localKeys.signedPreKey,
                opkPublic && opkPrivate ? { privateKey: opkPrivate, publicKey: opkPublic } : null,
                wire.init.identityKey,
                wire.init.ephemeralPublicKey,
                wire.init.mlKemCiphertext ?? null,
                wire.init.mlKemCiphertext ? record.localKeys.mlKemKeyPair?.secretKey ?? null : null,
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
            // Ignore le trafic de couverture (marqueur réservé + remplissage) ;
            // ne persiste jamais les marqueurs de contrôle (appels/statuts) mais
            // les transmet quand même à l'UI.
            if (text.startsWith(COVER_MARKER)) return;
            if (this.historyStore && !isTransientMessage(text)) {
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
      } catch (e) {
        console.warn('[private] subscribe indisponible:', e);
      }
    })();

    return () => {
      stopped = true;
      relayUnsub?.();
    };
  }
}
