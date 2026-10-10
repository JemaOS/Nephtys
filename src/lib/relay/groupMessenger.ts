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
  encryptGroupMessage,
  decryptGroupMessage,
  serializeGroupKeys,
  deserializeGroupKeys,
  type GroupEpochKeys,
} from './groupKeys';

export interface QueueRef {
  queueId: string;
  queueKey: string;
}

export interface GroupMember {
  id: string;
  name: string;
  /** file où ÉCRIRE pour joindre ce membre (queueId + sendKey) */
  send: QueueRef;
}

export interface GroupRecord {
  groupId: string;
  name: string;
  mySend: QueueRef; // pour que les autres m'écrivent
  myRcv: QueueRef;  // pour lire
  keys: GroupEpochKeys;
  members: GroupMember[]; // exclut soi-même
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

  private async encryptPayload(record: GroupRecord, payload: Payload): Promise<string> {
    const epoch = record.keys.currentEpoch;
    const key = record.keys.keys[String(epoch)];
    const msg = await encryptGroupMessage(record.groupId, epoch, key, JSON.stringify(payload));
    return JSON.stringify(msg);
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
    const record: GroupRecord = { groupId, name, mySend: send, myRcv: rcv, keys: state, members: [] };
    await this.store.save(record);
    const invite = encodeGroupInvite({ v: 1, groupId, name, send, epoch: 0, key: keyB64 });
    return { record, invite };
  }

  /** Rejoint un groupe via un lien ; envoie un « join » à l'invitant. */
  async join(inviteLink: string, myName = 'moi'): Promise<GroupRecord> {
    const inv = decodeGroupInvite(inviteLink);
    if (!inv) throw new Error('Lien de groupe invalide.');
    const { send, rcv } = await this.newQueueRefs();
    const keys = addEpochKey({ groupId: inv.groupId, currentEpoch: -1, keys: {} }, inv.epoch, inv.key);
    const record: GroupRecord = {
      groupId: inv.groupId,
      name: inv.name,
      mySend: send,
      myRcv: rcv,
      keys,
      members: [{ id: 'inviter', name: 'inviter', send: inv.send }],
    };
    const payload: Payload = { type: 'join', name: myName, send };
    const msg = await encryptGroupMessage(inv.groupId, inv.epoch, inv.key, JSON.stringify(payload));
    await this.rawSend(inv.send, JSON.stringify(msg));
    await this.store.save(record);
    return record;
  }

  /** Envoie un texte à tous les membres du groupe. */
  async send(groupId: string, text: string): Promise<void> {
    const record = await this.store.load(groupId);
    if (!record) throw new Error('Groupe introuvable.');
    const packed = await this.encryptPayload(record, { type: 'text', text });
    for (const member of record.members) await this.rawSend(member.send, packed);
  }

  /** Retire un membre : rotation de clé distribuée aux membres restants. */
  async removeMember(groupId: string, memberId: string): Promise<void> {
    const record = await this.store.load(groupId);
    if (!record) return;
    const { state: rotated, keyB64 } = rotateGroupKeys(record.keys);
    const remaining = record.members.filter(m => m.id !== memberId);

    // Distribue la nouvelle clé aux membres RESTANTS, chiffrée avec l'ANCIENNE.
    const payload: Payload = { type: 'rotate', epoch: rotated.currentEpoch, key: keyB64 };
    const oldEpoch = record.keys.currentEpoch;
    const oldKey = record.keys.keys[String(oldEpoch)];
    const msg = await encryptGroupMessage(record.groupId, oldEpoch, oldKey, JSON.stringify(payload));
    const packed = JSON.stringify(msg);
    for (const member of remaining) await this.rawSend(member.send, packed);

    await this.store.save({ ...record, keys: rotated, members: remaining });
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

    let payload: Payload;
    try {
      payload = JSON.parse(await decryptGroupMessage(record.keys, parsed.epoch, parsed.iv, parsed.ct)) as Payload;
    } catch {
      return record; // époque inconnue (message d'un retiré après rotation) → ignoré
    }

    if (payload.type === 'text') {
      onText(payload.text);
      return record;
    }
    if (payload.type === 'join') {
      // Nouveau membre : on l'ajoute et on (re)diffuse la liste des membres
      // à TOUT le monde (le nouveau + les existants) pour un maillage complet.
      const member: GroupMember = { id: `m-${payload.send.queueId}`, name: payload.name, send: payload.send };
      const withMember: GroupRecord = record.members.some(m => m.send.queueId === member.send.queueId)
        ? record
        : { ...record, members: [...record.members, member] };

      const epoch = withMember.keys.currentEpoch;
      const reply: Payload = {
        type: 'members',
        members: [
          { id: withMember.mySend.queueId, name: withMember.name, send: withMember.mySend },
          ...withMember.members,
        ],
        epoch,
        key: withMember.keys.keys[String(epoch)],
      };
      const msg = await encryptGroupMessage(withMember.groupId, epoch, withMember.keys.keys[String(epoch)], JSON.stringify(reply));
      const packed = JSON.stringify(msg);

      await this.rawSend(member.send, packed);
      for (const m of withMember.members) {
        if (m.send.queueId !== member.send.queueId) await this.rawSend(m.send, packed);
      }
      return withMember;
    }
    if (payload.type === 'members') {
      // On apprend la liste complète + la clé courante.
      const others = payload.members.filter(m => m.send.queueId !== record.mySend.queueId);
      const keys = addEpochKey(record.keys, payload.epoch, payload.key);
      return { ...record, members: others, keys };
    }
    if (payload.type === 'rotate') {
      return { ...record, keys: addEpochKey(record.keys, payload.epoch, payload.key) };
    }
    return record;
  }
}

// Serialization helpers (pour un store IndexedDB côté prod).
export function serializeGroupRecord(r: GroupRecord): string {
  return JSON.stringify({ ...r, keys: serializeGroupKeys(r.keys) });
}

export function deserializeGroupRecord(json: string): GroupRecord {
  const raw = JSON.parse(json) as GroupRecord & { keys: string | GroupEpochKeys };
  return { ...raw, keys: typeof raw.keys === 'string' ? deserializeGroupKeys(raw.keys) : raw.keys };
}
