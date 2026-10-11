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
 *   • `removeMember` → **rotation** de clé ET **diffusion de la nouvelle liste
 *     `members`** (signée admin), distribuées aux membres restants seulement
 *     (le retiré ne peut plus lire).
 *
 * Autorité (audit S1) :
 *   • Le groupe a un **admin** : la clé publique Ed25519 du créateur (transmise
 *     dans l'invitation). Les payloads de contrôle `members`/`rotate` ne sont
 *     appliqués que s'ils sont **signés par cet admin** ; un `text` reste
 *     accepté de tout membre connu. Les `join` sont gérés par l'admin seul.
 *   • Rétrocompatibilité : un groupe **sans admin déclaré** (`adminKey`
 *     absent — enregistrement/invitation d'une version antérieure) conserve
 *     l'ancien comportement tolérant : les payloads de contrôle d'un membre
 *     connu sont encore appliqués.
 *   • Anti-rejeu d'époque : un message de contenu (`text`) dont l'époque de
 *     chiffrement est **antérieure à l'époque courante connue** est refusé
 *     (un membre retiré qui détient encore une ancienne époque ne peut plus
 *     écrire). Les payloads de contrôle, eux, sont volontairement distribués
 *     avec une époque antérieure et donc exemptés.
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
  /**
   * Clé publique Ed25519 de l'**admin** du groupe (le créateur). Seuls les
   * payloads `members`/`rotate` signés par cette clé sont appliqués.
   * Absent (optionnel) pour les groupes créés avant l'introduction de
   * l'autorité → comportement hérité tolérant (tout membre connu).
   */
  adminKey?: string;
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
  /** Version du format d'invitation (v1 = sans admin, v2 = admin déclaré). */
  v: number;
  groupId: string;
  name: string;
  send: QueueRef;
  epoch: number;
  key: string;
  /** Clé publique Ed25519 de l'invitant (authentifie ses futurs payloads). */
  signingKey: string;
  /**
   * Clé publique Ed25519 de l'admin (v2). Absente dans les invitations v1 :
   * le groupe reste alors en mode hérité tolérant.
   */
  adminKey?: string;
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
  | { type: 'members'; members: GroupMember[]; epoch: number; key: string; adminKey?: string; v?: number }
  | { type: 'rotate'; epoch: number; key: string; v?: number };

/**
 * Enveloppe signée d'un payload de groupe. `from` est la clé publique Ed25519
 * de l'émetteur, `sig` couvre `(groupId, seq, from, JSON(payload))`. Le tout est
 * ensuite chiffré avec la clé d'époque → confidentialité + authenticité.
 *
 * `v` versionne l'enveloppe (absente en lecture = v1) ; la signature ne couvre
 * que `payload`, donc les anciens lecteurs restent compatibles.
 */
interface SignedEnvelope {
  seq: number;
  from: string;
  sig: string;
  payload: Payload;
  v?: number;
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
    const envelope: SignedEnvelope = { seq, from, sig, payload, v: 2 };
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
      signing, sendSeq: 0, peerSeqs: {}, adminKey: signing.publicKey,
    };
    await this.store.save(record);
    const invite = encodeGroupInvite({
      v: 2, groupId, name, send, epoch: 0, key: keyB64,
      signingKey: signing.publicKey, adminKey: signing.publicKey,
    });
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
      // v2 : l'admin est le créateur annoncé par l'invitation. Une invitation
      // v1 (sans `adminKey`) laisse le groupe en mode hérité tolérant.
      adminKey: inv.adminKey,
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

  /**
   * Retire un membre : rotation de clé ET diffusion de la **nouvelle liste
   * `members`** (signée admin), distribuées aux membres restants. Les retirés
   * ne reçoivent rien : ils conservent une ancienne époque mais ne peuvent plus
   * ni lire (clé inconnue) ni écrire (époque antérieure refusée).
   *
   * Réservé à l'admin lorsque le groupe en déclare un ; un groupe hérité (sans
   * `adminKey`) autorise tout membre, comme auparavant.
   */
  async removeMember(groupId: string, memberId: string): Promise<void> {
    const record = await this.store.load(groupId);
    if (!record) return;
    if (record.adminKey && record.adminKey !== record.signing.publicKey) {
      throw new Error('Seul l’administrateur du groupe peut retirer un membre.');
    }
    const { state: rotated, keyB64 } = rotateGroupKeys(record.keys);
    const pruned = pruneEpochKeys(rotated);
    const remaining = record.members.filter(m => m.id !== memberId);

    // Nouvelle liste d'appartenance (source d'autorité = l'admin) : soi-même
    // en tête, puis les membres restants.
    const list: GroupMember[] = [
      { id: record.mySend.queueId, name: record.name, send: record.mySend, signingKey: record.signing.publicKey },
      ...remaining,
    ];
    const payload: Payload = {
      type: 'members',
      members: list,
      epoch: pruned.currentEpoch,
      key: keyB64,
      adminKey: record.adminKey ?? record.signing.publicKey,
      v: 2,
    };

    // Distribue la nouvelle liste + clé aux membres RESTANTS, chiffrée avec
    // l'ANCIENNE époque et signée par notre clé identité (admin). Le retiré ne
    // peut pas lire et sa future écriture sera refusée (époque antérieure).
    const oldEpoch = record.keys.currentEpoch;
    const oldKey = record.keys.keys[String(oldEpoch)];
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

    // Authentification de l'émetteur puis autorité (audit S1) :
    //   • la signature Ed25519 (couvre groupId, seq, from, payload) authentifie
    //     `from` AVANT toute décision d'autorité ;
    //   • `join` : nouvel émetteur inconnu → TOFU, mais seul l'admin du groupe
    //     gère l'appartenance (les autres enregistrements l'ignorent) ;
    //   • `text` : accepté de tout membre connu (ou soi) ;
    //   • `members`/`rotate` : l'émetteur DOIT être l'admin déclaré. Si aucun
    //     admin n'est déclaré (groupe hérité), un membre connu est accepté
    //     (comportement tolérant documenté).
    const payloadType = payload.type;
    const isControl = payloadType === 'join' || payloadType === 'members' || payloadType === 'rotate';
    if (!verifyGroupPayload(record.groupId, envelope.seq, envelope.from, JSON.stringify(payload), envelope.sig)) {
      return record;
    }

    const isSelf = envelope.from === record.signing.publicKey;
    const knownMember = record.members.find(m => m.signingKey === envelope.from);
    const adminDeclared = typeof record.adminKey === 'string' && record.adminKey.length > 0;
    const isAdminEmitter = adminDeclared && envelope.from === record.adminKey;

    if (payloadType === 'join') {
      // Seul l'admin (ou un groupe hérité) traite une demande d'adhésion.
      if (adminDeclared && record.signing.publicKey !== record.adminKey) return record;
    } else if (!isSelf && !knownMember) {
      return record;
    } else if ((payloadType === 'members' || payloadType === 'rotate') && adminDeclared && !isAdminEmitter) {
      return record; // tentative d'imposer une clé/liste sans l'autorité admin
    }

    // Anti-rejeu : numéro de séquence strictement croissant par émetteur.
    const last = record.peerSeqs[envelope.from] ?? -1;
    if (envelope.seq <= last) return record;

    // Anti-rejeu d'époque : un message de CONTENU (`text`) doit être au moins à
    // l'époque courante connue. Les payloads de contrôle sont distribués
    // volontairement avec une époque antérieure (ex. nouvelle clé chiffrée avec
    // l'ancienne pour atteindre tout le monde) → exemptés.
    if (!isControl && parsed.epoch < record.keys.currentEpoch) return record;

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
        // Annonce la clé admin pour que l'invité adopte la même autorité.
        adminKey: withMember.adminKey ?? withMember.signing.publicKey,
        v: 2,
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
      // On apprend la liste complète + la clé courante. La source d'autorité
      // est l'admin (payload signé par lui) : on adopte aussi sa clé admin.
      const others = payload.members.filter(m => m.send.queueId !== record.mySend.queueId);
      const keys = pruneEpochKeys(addEpochKey(base.keys, payload.epoch, payload.key));
      const adminKey = payload.adminKey ?? base.adminKey;
      return { ...base, members: others, keys, adminKey };
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
