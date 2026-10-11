// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Mode privé — messagerie de GROUPE via les files anonymes.
 *
 * Combine :
 *   • les **files anonymes** (`RelayWire` : Supabase `anon_queues` ou relais WS)
 *     — aucune identité côté serveur ;
 *   • les **clés de groupe par époque** (`groupKeys`) — rotation au retrait.
 *
 * Cycle :
 *   • `create(name)` → crée une file perso + clé époque 0, renvoie un lien.
 *   • `join(invite)`  → crée sa file, envoie un « join » à l'invitant.
 *   • l'invitant répond la **liste des membres** → chacun peut écrire à tous.
 *   • `send` chiffre avec la clé courante et dépose dans la file de CHAQUE membre.
 *   • `removeMember` → **rotation** de clé, distribuée aux membres restants
 *     seulement (le retiré ne peut plus lire).
 *
 * Le payload (texte ou contrôle) est un JSON chiffré (AES-GCM) ; le relais ne
 * voit que du ciphertext.
 */

import type { RelayWire } from './wire';
import type { StoredEnvelope } from './relayCore';
import { bytesToBase64, randomBytes } from '../ratchet/primitives';
import {
  createGroupKeys,
  rotateGroupKeys,
  addEpochKey,
  pruneEpochKeys,
  encryptGroupMessage,
  decryptGroupMessage,
  serializeGroupKeys,
  deserializeGroupKeys,
  type GroupEpochKeys,
} from './groupKeys';
import { generateGroupSigningPair, signGroupPayload, verifyGroupPayload, type GroupSigningPair } from './groupAuth';

export interface QueueRef {
  queueId: string;
  queueKey: string;
}

export interface GroupMember {
  id: string;
  name: string;
  /** file où ÉCRIRE pour joindre ce membre (queueId + sendKey) */
  send: QueueRef;
  /** Clé publique Ed25519 du membre (authentifie ses payloads). */
  signingKey?: string;
}

export interface GroupRecord {
  groupId: string;
  name: string;
  mySend: QueueRef; // pour que les autres m'écrivent
  myRcv: QueueRef;  // pour lire
  keys: GroupEpochKeys;
  members: GroupMember[]; // exclut soi-même
  /** Paire de signature Ed25519 locale (authentifie nos payloads). */
  signing: GroupSigningPair;
  /** Compteur de séquence sortant (anti-rejeu). */
  sendSeq: number;
  /** Plus haut numéro de séquence reçu par émetteur (clé pub) → anti-rejeu. */
  peerSeqs: Record<string, number>;
}

// ─── Persistance ──────────────────────────────────────────────────────

export interface GroupStore {
  load(groupId: string): Promise<GroupRecord | null>;
  save(record: GroupRecord): Promise<void>;
  list(): Promise<GroupRecord[]>;
  remove(groupId: string): Promise<void>;
}

export class InMemoryGroupStore implements GroupStore {
  private readonly records = new Map<string, GroupRecord>();
  async load(id: string) { return this.records.get(id) ?? null; }
  async save(r: GroupRecord) { this.records.set(r.groupId, r); }
  async list() { return [...this.records.values()]; }
  async remove(id: string) { this.records.delete(id); }
}

// ─── Lien d'invitation ────────────────────────────────────────────────

const INVITE_PREFIX = 'nept-group://';

interface Invite {
  v: 1;
  groupId: string;
  name: string;
  send: QueueRef;
  epoch: number;
  key: string;
  /** Clé publique Ed25519 de l'invitant (authentifie ses futurs payloads). */
  signingKey: string;
}

export function encodeGroupInvite(invite: Invite): string {
  return INVITE_PREFIX + bytesToBase64(new TextEncoder().encode(JSON.stringify(invite))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function decodeGroupInvite(link: string): Invite | null {
  if (!link.startsWith(INVITE_PREFIX)) return null;
  try {
    let b64 = link.slice(INVITE_PREFIX.length).replaceAll('-', '+').replaceAll('_', '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes)) as Invite;
  } catch {
    return null;
  }
}

function newGroupId(): string {
  return 'g-' + bytesToBase64(randomBytes(9)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

// ─── Messenger ────────────────────────────────────────────────────────

type Payload =
  | { type: 'text'; text: string }
  | { type: 'join'; name: string; send: QueueRef }
  | { type: 'members'; members: GroupMember[]; epoch: number; key: string }
  | { type: 'rotate'; epoch: number; key: string };

/**
 * Enveloppe signée d'un payload de groupe. `from` est la clé publique Ed25519
 * de l'émetteur, `sig` couvre `(groupId, seq, from, JSON(payload))`. Le tout est
 * ensuite chiffré avec la clé d'époque → confidentialité + authenticité.
 */
interface SignedEnvelope {
  seq: number;
  from: string;
  sig: string;
  payload: Payload;
}

export class GroupMessenger {
  constructor(
    private readonly wire: RelayWire,
    private readonly store: GroupStore,
    private readonly pollMs = 1500,
  ) {}

  private async newQueueRefs(): Promise<{ send: QueueRef; rcv: QueueRef }> {
    const resp = await this.wire.request({ op: 'createQueue' });
    if (!resp.ok || !resp.result) throw new Error('group: création de file échouée');
    const c = resp.result as { queueId: string; sendKey: string; rcvKey: string };
    return {
      send: { queueId: c.queueId, queueKey: c.sendKey },
      rcv: { queueId: c.queueId, queueKey: c.rcvKey },
    };
  }

  private async rawSend(ref: QueueRef, packed: string): Promise<void> {
    await this.wire.request({ op: 'send', queueId: ref.queueId, queueKey: ref.queueKey, ciphertext: packed });
  }

  private async rawRead(rcv: QueueRef): Promise<StoredEnvelope[]> {
    const resp = await this.wire.request({ op: 'read', queueId: rcv.queueId, queueKey: rcv.queueKey });
    return (resp.result as StoredEnvelope[]) ?? [];
  }

  private async rawAck(rcv: QueueRef, ids: string[]): Promise<void> {
    if (ids.length) await this.wire.request({ op: 'ack', queueId: rcv.queueId, queueKey: rcv.queueKey, ids });
  }

  /**
   * Construit une enveloppe signée + chiffrée pour `payload`.
   * `epoch`/`keyB64` peuvent être surchargés pour chiffrer avec une ancienne
   * époque (distribution d'une nouvelle clé) ou l'époque de l'invitation.
   */
  private async buildSigned(
    record: GroupRecord,
    payload: Payload,
    epoch: number = record.keys.currentEpoch,
    keyB64: string = record.keys.keys[String(epoch)],
  ): Promise<{ packed: string; seq: number }> {
    const seq = (record.sendSeq ?? 0) + 1;
    const from = record.signing.publicKey;
    const payloadJson = JSON.stringify(payload);
    const sig = signGroupPayload(record.groupId, seq, from, payloadJson, record.signing.privateKey);
    const envelope: SignedEnvelope = { seq, from, sig, payload };
    const msg = await encryptGroupMessage(record.groupId, epoch, keyB64, JSON.stringify(envelope));
    return { packed: JSON.stringify(msg), seq };
  }

  /** Liste les groupes stockés localement. */
  async listGroups(): Promise<GroupRecord[]> {
    return this.store.list();
  }

  /** Oublie un groupe (supprime le mapping local). */
  async forgetGroup(groupId: string): Promise<void> {
    await this.store.remove(groupId);
  }

  /** Crée un groupe ; renvoie son id + le lien d'invitation à partager. */
  async create(name: string): Promise<{ record: GroupRecord; invite: string }> {
    const groupId = newGroupId();
    const { send, rcv } = await this.newQueueRefs();
    const { state, keyB64 } = createGroupKeys(groupId);
    const signing = generateGroupSigningPair();
    const record: GroupRecord = {
      groupId, name, mySend: send, myRcv: rcv, keys: state, members: [],
      signing, sendSeq: 0, peerSeqs: {},
    };
    await this.store.save(record);
    const invite = encodeGroupInvite({ v: 1, groupId, name, send, epoch: 0, key: keyB64, signingKey: signing.publicKey });
    return { record, invite };
  }

  /** Rejoint un groupe via un lien ; envoie un « join » signé à l'invitant. */
  async join(inviteLink: string, myName = 'moi'): Promise<GroupRecord> {
    const inv = decodeGroupInvite(inviteLink);
    if (!inv) throw new Error('Lien de groupe invalide.');
    const { send, rcv } = await this.newQueueRefs();
    const keys = addEpochKey({ groupId: inv.groupId, currentEpoch: -1, keys: {} }, inv.epoch, inv.key);
    const signing = generateGroupSigningPair();
    const record: GroupRecord = {
      groupId: inv.groupId,
      name: inv.name,
      mySend: send,
      myRcv: rcv,
      keys,
      members: [{ id: 'inviter', name: 'inviter', send: inv.send, signingKey: inv.signingKey }],
      signing,
      sendSeq: 0,
      peerSeqs: {},
    };
    const payload: Payload = { type: 'join', name: myName, send };
    // Le « join » est chiffré avec la clé de l'invitation (que seul l'invité connaît).
    const { packed, seq } = await this.buildSigned(record, payload, inv.epoch, inv.key);
    await this.rawSend(inv.send, packed);
    const saved: GroupRecord = { ...record, sendSeq: seq };
    await this.store.save(saved);
    return saved;
  }

  /** Envoie un texte signé à tous les membres du groupe. */
  async send(groupId: string, text: string): Promise<void> {
    const record = await this.store.load(groupId);
    if (!record) throw new Error('Groupe introuvable.');
    const { packed, seq } = await this.buildSigned(record, { type: 'text', text });
    await this.store.save({ ...record, sendSeq: seq });
    for (const member of record.members) await this.rawSend(member.send, packed);
  }

  /** Retire un membre : rotation de clé signée, distribuée aux membres restants. */
  async removeMember(groupId: string, memberId: string): Promise<void> {
    const record = await this.store.load(groupId);
    if (!record) return;
    const { state: rotated, keyB64 } = rotateGroupKeys(record.keys);
    const pruned = pruneEpochKeys(rotated);
    const remaining = record.members.filter(m => m.id !== memberId);

    // Distribue la nouvelle clé aux membres RESTANTS, chiffrée avec l'ANCIENNE
    // époque et signée par notre clé identité (le retiré ne peut pas lire).
    const oldEpoch = record.keys.currentEpoch;
    const oldKey = record.keys.keys[String(oldEpoch)];
    const payload: Payload = { type: 'rotate', epoch: pruned.currentEpoch, key: keyB64 };
    const { packed, seq } = await this.buildSigned(record, payload, oldEpoch, oldKey);
    await this.store.save({ ...record, keys: pruned, members: remaining, sendSeq: seq });
    for (const member of remaining) await this.rawSend(member.send, packed);
  }

  /** Écoute les messages du groupe (texte livré via `onText`). */
  subscribe(groupId: string, onText: (text: string) => void): () => void {
    let stopped = false;
    let inFlight = false;

    const tick = async (): Promise<void> => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const record = await this.store.load(groupId);
        if (!record) return;
        const messages = await this.rawRead(record.myRcv);
        if (messages.length === 0) return;

        const ids: string[] = [];
        let updated = record;
        for (const stored of messages) {
          ids.push(stored.id);
          updated = await this.handleIncoming(updated, stored, onText);
        }
        await this.rawAck(record.myRcv, ids);
        await this.store.save(updated);
      } catch {
        // ignore (polling)
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(() => { tick().catch(() => {}); }, this.pollMs);
    tick().catch(() => {});
    return () => { stopped = true; clearInterval(timer); };
  }

  private async handleIncoming(
    record: GroupRecord,
    stored: StoredEnvelope,
    onText: (text: string) => void,
  ): Promise<GroupRecord> {
    let parsed: { epoch: number; iv: string; ct: string };
    try {
      parsed = JSON.parse(stored.ciphertext);
    } catch {
      return record;
    }

    let plaintext: string;
    try {
      plaintext = await decryptGroupMessage(record.keys, parsed.epoch, parsed.iv, parsed.ct);
    } catch {
      return record; // époque inconnue (message d'un retiré après rotation) → ignoré
    }

    let envelope: SignedEnvelope;
    try {
      envelope = JSON.parse(plaintext) as SignedEnvelope;
    } catch {
      return record;
    }
    const payload = envelope?.payload;
    if (
      !envelope ||
      typeof envelope.seq !== 'number' ||
      typeof envelope.from !== 'string' ||
      typeof envelope.sig !== 'string' ||
      !payload ||
      typeof (payload as { type?: unknown }).type !== 'string'
    ) {
      return record;
    }

    // Authentification de l'émetteur :
    //   • `join` : nouvel émetteur inconnu → TOFU (l'autorité est la possession
    //     de la clé d'époque, distribuée hors-bande par l'invitation) ;
    //   • `text`/`members`/`rotate` : l'émetteur DOIT être un membre connu (ou soi)
    //     → refuse toute rotation non authentifiée.
    const isSelf = envelope.from === record.signing.publicKey;
    const knownMember = record.members.find(m => m.signingKey === envelope.from);
    if (!isSelf && !knownMember && payload.type !== 'join') return record;

    // Vérifie la signature Ed25519 (couvre groupId, seq, from, payload).
    if (!verifyGroupPayload(record.groupId, envelope.seq, envelope.from, JSON.stringify(payload), envelope.sig)) {
      return record;
    }

    // Anti-rejeu : numéro de séquence strictement croissant par émetteur.
    const last = record.peerSeqs[envelope.from] ?? -1;
    if (envelope.seq <= last) return record;
    const base: GroupRecord = { ...record, peerSeqs: { ...record.peerSeqs, [envelope.from]: envelope.seq } };

    if (payload.type === 'text') {
      onText(payload.text);
      return base;
    }
    if (payload.type === 'join') {
      // Nouveau membre : on l'ajoute, on ROTATIONNE la clé (changement
      // d'appartenance) puis on (re)diffuse la liste + la nouvelle clé à TOUT
      // le monde pour un maillage complet.
      const member: GroupMember = {
        id: `m-${payload.send.queueId}`,
        name: payload.name,
        send: payload.send,
        signingKey: envelope.from,
      };
      const withMember: GroupRecord = base.members.some(m => m.send.queueId === member.send.queueId)
        ? base
        : { ...base, members: [...base.members, member] };

      const { state: rotated, keyB64 } = rotateGroupKeys(withMember.keys);
      const pruned = pruneEpochKeys(rotated);
      const reply: Payload = {
        type: 'members',
        members: [
          { id: withMember.mySend.queueId, name: withMember.name, send: withMember.mySend, signingKey: withMember.signing.publicKey },
          ...withMember.members,
        ],
        epoch: pruned.currentEpoch,
        key: keyB64,
      };
      // Chiffrée avec l'époque de l'invité (qu'il possède forcément).
      const recvKey = withMember.keys.keys[String(parsed.epoch)];
      const { packed, seq } = await this.buildSigned(withMember, reply, parsed.epoch, recvKey);

      // Persiste AVANT de répondre : un envoi concurrent ne doit pas lire un
      // état périmé (membre non encore enregistré).
      await this.store.save({ ...withMember, keys: pruned, sendSeq: seq });

      await this.rawSend(member.send, packed);
      for (const m of withMember.members) {
        if (m.send.queueId !== member.send.queueId) await this.rawSend(m.send, packed);
      }
      return { ...withMember, keys: pruned, sendSeq: seq };
    }
    if (payload.type === 'members') {
      // On apprend la liste complète + la clé courante.
      const others = payload.members.filter(m => m.send.queueId !== record.mySend.queueId);
      const keys = pruneEpochKeys(addEpochKey(base.keys, payload.epoch, payload.key));
      return { ...base, members: others, keys };
    }
    if (payload.type === 'rotate') {
      return { ...base, keys: pruneEpochKeys(addEpochKey(base.keys, payload.epoch, payload.key)) };
    }
    return base;
  }
}

// Serialization helpers (pour un store IndexedDB côté prod).
export function serializeGroupRecord(r: GroupRecord): string {
  return JSON.stringify({ ...r, keys: serializeGroupKeys(r.keys) });
}

export function deserializeGroupRecord(json: string): GroupRecord {
  const raw = JSON.parse(json) as GroupRecord & { keys: string | GroupEpochKeys };
  const keys = typeof raw.keys === 'string' ? deserializeGroupKeys(raw.keys) : raw.keys;
  // Rétro-compatibilité : les enregistrements pré-authentification n'ont ni
  // paire de signature ni compteurs → on les complète à la volée.
  return {
    ...raw,
    keys,
    signing: raw.signing ?? generateGroupSigningPair(),
    sendSeq: raw.sendSeq ?? 0,
    peerSeqs: raw.peerSeqs ?? {},
    members: (raw.members ?? []).map(m => ({ ...m })),
  };
}
