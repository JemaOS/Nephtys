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
 * Autorité (audit S1/S2) :
 *   • Le groupe a un **ensemble d'admins** : au départ la clé publique Ed25519
 *     du créateur (transmise dans l'invitation). Les payloads de contrôle
 *     `members`/`rotate`/`promote`/`demote` ne sont appliqués que s'ils sont
 *     **signés par l'un de ces admins** ; un `text` reste accepté de tout membre
 *     connu. Les `join` sont gérés par un admin.
 *   • Un admin peut **promouvoir** un membre (payload `promote`) ou **retirer**
 *     un rôle admin (`demote`) ; l'ensemble résultant est diffusé signé et ne
 *     peut jamais devenir vide.
 *   • Rétrocompatibilité : un groupe **sans admin déclaré** (`adminKey`/`admins`
 *     absents — enregistrement/invitation d'une version antérieure) conserve
 *     l'ancien comportement tolérant. Un groupe v1/v2 à admin unique
 *     (`adminKey`) est lu comme un ensemble d'un seul admin.
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
   * Clé publique Ed25519 de l'admin **historique/principal** du groupe (le
   * créateur). Conservé pour la rétrocompatibilité v1 : un groupe qui ne
   * possède que ce champ reste piloté par un admin unique. Lorsqu'il est
   * présent à côté d'`admins`, il reflète `admins[0]` (interop lecteurs v1).
   */
  adminKey?: string;
  /**
   * Ensemble des clés publiques Ed25519 des **admins** du groupe (audit S2).
   * Les payloads de contrôle `members`/`rotate`/`promote`/`demote` ne sont
   * appliqués que s'ils sont signés par **l'un** de ces admins. Repli sur
   * `adminKey` (format v1, admin unique) puis sur l'ensemble vide (groupe
   * hérité tolérant). Ne doit jamais être vide une fois établi.
   */
  admins?: string[];
  /** Compteur de séquence sortant (anti-rejeu). */
  sendSeq: number;
  /** Plus haut numéro de séquence reçu par émetteur (clé pub) → anti-rejeu. */
  peerSeqs: Record<string, number>;
}

/** Vue minimale portant l'autorité admin d'un groupe (admin unique OU ensemble). */
export type GroupAuthority = Pick<GroupRecord, 'admins' | 'adminKey'>;

/**
 * Ensemble effectif des clés admin d'un groupe.
 *   • `admins` (format v2/S2, plusieurs admins) s'il est non vide ;
 *   • sinon repli sur `adminKey` (format v1, admin unique) ;
 *   • sinon ensemble vide → groupe hérité tolérant (aucune autorité déclarée).
 */
export function groupAdmins(record: GroupAuthority): string[] {
  if (Array.isArray(record.admins) && record.admins.length > 0) {
    return record.admins.filter(k => typeof k === 'string' && k.length > 0);
  }
  if (typeof record.adminKey === 'string' && record.adminKey.length > 0) return [record.adminKey];
  return [];
}

/** Vrai si `key` fait partie des admins déclarés du groupe. */
export function isGroupAdmin(record: GroupAuthority, key: string): boolean {
  return groupAdmins(record).includes(key);
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
  /**
   * Ensemble des admins (v2/S2). Optionnel : absent d'une invitation v1, ou
   * d'une invitation v2 où l'admin est unique (`adminKey` seul).
   */
  admins?: string[];
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
  | { type: 'members'; members: GroupMember[]; epoch: number; key: string; adminKey?: string; admins?: string[]; v?: number }
  | { type: 'rotate'; epoch: number; key: string; v?: number }
  // Audit S2 — gestion des admins (signés par un admin existant) :
  //   • `promote` : ajoute `member` (clé de signature) à l'ensemble `admins` ;
  //   • `demote`  : retire `member` ; `admins` reflète l'ensemble résultant.
  | { type: 'promote'; member: string; admins: string[]; v?: number }
  | { type: 'demote'; member: string; admins: string[]; v?: number };

/**
 * Enveloppe signée d'un payload de groupe. `from` est la clé publique Ed25519
 * de l'émetteur, `sig` couvre `(groupId, seq, from, JSON(payload))`. Le tout est
 * ensuite chiffré avec la clé d'époque → confidentialité + authenticité.
 *
 * `v` versionne l'enveloppe (absente en lecture = v1) ; la signature ne couvre
 * que `payload`, donc les anciens lecteurs restent compatibles.
 *
 * Versions : v1 = enveloppe héritée ; v2 = autorité admin (admin unique) ;
 * v3 = ensemble d'admins (promotion/rétrogradation). Le champ `v` n'est pas
 * contrôlé en lecture (tolérance ascendante) mais documente la capacité.
 */
const ENVELOPE_VERSION = 3;

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
    const envelope: SignedEnvelope = { seq, from, sig, payload, v: ENVELOPE_VERSION };
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

  /** Renomme localement un groupe (nom affiché, jamais transmis au pair). */
  async rename(groupId: string, name: string): Promise<void> {
    const record = await this.store.load(groupId);
    if (!record) return;
    const trimmed = name.trim();
    if (trimmed) record.name = trimmed;
    await this.store.save(record);
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
      admins: [signing.publicKey],
    };
    await this.store.save(record);
    const invite = encodeGroupInvite({
      v: 3, groupId, name, send, epoch: 0, key: keyB64,
      signingKey: signing.publicKey, adminKey: signing.publicKey,
      admins: [signing.publicKey],
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
    // Ensemble d'admins annoncé par l'invitation (v3), sinon repli sur `adminKey`
    // (v2, admin unique) ; une invitation v1 (sans aucun) reste en mode hérité.
    const invitedAdmins = inv.admins && inv.admins.length > 0 ? inv.admins : (inv.adminKey ? [inv.adminKey] : undefined);
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
      // v2/v3 : l'admin est le créateur annoncé par l'invitation. Une invitation
      // v1 (sans `adminKey`) laisse le groupe en mode hérité tolérant.
      adminKey: inv.adminKey ?? invitedAdmins?.[0],
      admins: invitedAdmins,
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
    const admins = groupAdmins(record);
    if (admins.length > 0 && !admins.includes(record.signing.publicKey)) {
      throw new Error('Seul l’administrateur du groupe peut retirer un membre.');
    }
    // Ensemble d'admins à (ré)diffuser : on préserve l'existant, sinon on
    // « établit » l'autorité sur soi-même (comme l'ancien adminKey pour un
    // groupe hérité).
    const nextAdmins = admins.length > 0 ? admins : [record.signing.publicKey];
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
      adminKey: nextAdmins[0],
      admins: nextAdmins,
      v: 3,
    };

    // Distribue la nouvelle liste + clé aux membres RESTANTS, chiffrée avec
    // l'ANCIENNE époque et signée par notre clé identité (admin). Le retiré ne
    // peut pas lire et sa future écriture sera refusée (époque antérieure).
    const oldEpoch = record.keys.currentEpoch;
    const oldKey = record.keys.keys[String(oldEpoch)];
    const { packed, seq } = await this.buildSigned(record, payload, oldEpoch, oldKey);
    await this.store.save({ ...record, keys: pruned, members: remaining, admins: nextAdmins, adminKey: nextAdmins[0], sendSeq: seq });
    for (const member of remaining) await this.rawSend(member.send, packed);
  }

  /**
   * Promeut un membre en admin (audit S2). Réservé à un admin existant.
   * `memberIdOrKey` accepte soit l'`id` d'un membre connu (résolu vers sa clé de
   * signature), soit directement une clé de signature. Diffuse `promote` (signé)
   * avec le nouvel ensemble d'admins à tous les membres.
   */
  async promoteMember(groupId: string, memberIdOrKey: string): Promise<void> {
    const record = await this.store.load(groupId);
    if (!record) throw new Error('Groupe introuvable.');
    const admins = groupAdmins(record);
    if (admins.length > 0 && !admins.includes(record.signing.publicKey)) {
      throw new Error('Seul un administrateur du groupe peut promouvoir un membre.');
    }
    const key = record.members.find(m => m.id === memberIdOrKey)?.signingKey ?? memberIdOrKey;
    if (!key) throw new Error('Membre introuvable ou sans clé de signature.');
    const currentAdmins = admins.length > 0 ? admins : [record.signing.publicKey];
    const nextAdmins = currentAdmins.includes(key) ? currentAdmins : [...currentAdmins, key];
    const payload: Payload = { type: 'promote', member: key, admins: nextAdmins, v: 3 };
    const { packed, seq } = await this.buildSigned(record, payload);
    await this.store.save({ ...record, admins: nextAdmins, adminKey: nextAdmins[0], sendSeq: seq });
    for (const member of record.members) await this.rawSend(member.send, packed);
  }

  /**
   * Retire le rôle admin d'un autre admin (audit S2), ou transfère le sien.
   * Réservé à un admin existant. Ne laisse **jamais zéro admin** : refuse de
   * retirer le dernier. Diffuse `demote` (signé) avec l'ensemble résultant.
   */
  async demoteAdmin(groupId: string, adminIdOrKey: string): Promise<void> {
    const record = await this.store.load(groupId);
    if (!record) throw new Error('Groupe introuvable.');
    const admins = groupAdmins(record);
    if (admins.length === 0) throw new Error('Aucun administrateur déclaré pour ce groupe.');
    if (!admins.includes(record.signing.publicKey)) {
      throw new Error('Seul un administrateur du groupe peut retirer un rôle admin.');
    }
    const key = record.members.find(m => m.id === adminIdOrKey)?.signingKey ?? adminIdOrKey;
    if (!admins.includes(key)) throw new Error('Ce membre n’est pas administrateur.');
    const nextAdmins = admins.filter(k => k !== key);
    if (nextAdmins.length === 0) throw new Error('Impossible de retirer le dernier administrateur.');
    const payload: Payload = { type: 'demote', member: key, admins: nextAdmins, v: 3 };
    const { packed, seq } = await this.buildSigned(record, payload);
    await this.store.save({ ...record, admins: nextAdmins, adminKey: nextAdmins[0], sendSeq: seq });
    for (const member of record.members) await this.rawSend(member.send, packed);
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

    // Authentification de l'émetteur puis autorité (audit S1/S2) :
    //   • la signature Ed25519 (couvre groupId, seq, from, payload) authentifie
    //     `from` AVANT toute décision d'autorité ;
    //   • `join` : nouvel émetteur inconnu → TOFU, mais seuls des admins gèrent
    //     l'appartenance (les autres enregistrements l'ignorent) ;
    //   • `text` : accepté de tout membre connu (ou soi) ;
    //   • `members`/`rotate`/`promote`/`demote` : l'émetteur DOIT être **l'un des
    //     admins** déclarés. Si aucun admin n'est déclaré (groupe hérité), un
    //     membre connu est accepté (comportement tolérant documenté).
    const payloadType = payload.type;
    const isControl = payloadType === 'join' || payloadType === 'members' || payloadType === 'rotate'
      || payloadType === 'promote' || payloadType === 'demote';
    const isAdminPayload = payloadType === 'members' || payloadType === 'rotate'
      || payloadType === 'promote' || payloadType === 'demote';
    if (!verifyGroupPayload(record.groupId, envelope.seq, envelope.from, JSON.stringify(payload), envelope.sig)) {
      return record;
    }

    const isSelf = envelope.from === record.signing.publicKey;
    const knownMember = record.members.find(m => m.signingKey === envelope.from);
    const admins = groupAdmins(record);
    const adminDeclared = admins.length > 0;
    const isAdminEmitter = admins.includes(envelope.from);

    if (payloadType === 'join') {
      // Seul un admin (ou un groupe hérité) traite une demande d'adhésion.
      if (adminDeclared && !admins.includes(record.signing.publicKey)) return record;
    } else if (!isSelf && !knownMember && !(isAdminPayload && isAdminEmitter)) {
      // Émetteur inconnu : refusé, SAUF s'il est admin (son autorité provient de
      // l'ensemble d'admins, lui-même établi par des `promote` signés).
      return record;
    } else if (isAdminPayload && adminDeclared && !isAdminEmitter) {
      return record; // tentative d'imposer une clé/liste/role sans l'autorité admin
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
      const replyAdmins = groupAdmins(withMember);
      const reply: Payload = {
        type: 'members',
        members: [
          { id: withMember.mySend.queueId, name: withMember.name, send: withMember.mySend, signingKey: withMember.signing.publicKey },
          ...withMember.members,
        ],
        epoch: pruned.currentEpoch,
        key: keyB64,
        // Annonce l'autorité admin pour que l'invité adopte le même ensemble.
        adminKey: withMember.adminKey ?? replyAdmins[0] ?? withMember.signing.publicKey,
        admins: replyAdmins.length > 0 ? replyAdmins : [withMember.signing.publicKey],
        v: 3,
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
      // On apprend la liste complète + la clé courante. La source d'autorité est
      // un admin (payload signé par lui) : on adopte aussi son ensemble d'admins.
      const others = payload.members.filter(m => m.send.queueId !== record.mySend.queueId);
      const keys = pruneEpochKeys(addEpochKey(base.keys, payload.epoch, payload.key));
      const adminKey = payload.adminKey ?? base.adminKey;
      let nextAdmins = groupAdmins(base);
      if (Array.isArray(payload.admins) && payload.admins.length > 0) nextAdmins = payload.admins;
      else if (nextAdmins.length === 0 && adminKey) nextAdmins = [adminKey];
      return { ...base, members: others, keys, admins: nextAdmins.length > 0 ? nextAdmins : base.admins, adminKey };
    }
    if (payload.type === 'rotate') {
      return { ...base, keys: pruneEpochKeys(addEpochKey(base.keys, payload.epoch, payload.key)) };
    }
    if (payload.type === 'promote') {
      // `promote` est strictement ADDITIF : l'ensemble diffusé doit contenir
      // tous les admins actuels ET le membre promu (on ne peut pas rétrograder
      // via un `promote`).
      const current = groupAdmins(base);
      const next = Array.isArray(payload.admins) && payload.admins.length > 0 ? payload.admins : current;
      const additive = current.every(k => next.includes(k)) && next.includes(payload.member);
      if (!additive) return base;
      return { ...base, admins: next, adminKey: next[0] };
    }
    if (payload.type === 'demote') {
      // `demote` retire un admin ; jamais zéro admin. Le retiré doit être un
      // admin courant et disparaître de l'ensemble ; les admins restants doivent
      // provenir de l'ensemble courant (pas d'injection d'admins arbitraires).
      const current = groupAdmins(base);
      const next = Array.isArray(payload.admins) ? payload.admins : [];
      if (!current.includes(payload.member)) return base;
      if (next.length === 0) return base;
      if (next.includes(payload.member)) return base;
      if (!next.every(k => current.includes(k))) return base;
      return { ...base, admins: next, adminKey: next[0] };
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
  // paire de signature ni compteurs → on les complète à la volée. Un
  // enregistrement v1/v2 (admin unique) voit son `adminKey` promu en ensemble
  // `admins` d'un seul élément.
  const admins = Array.isArray(raw.admins) && raw.admins.length > 0
    ? raw.admins
    : (typeof raw.adminKey === 'string' && raw.adminKey.length > 0 ? [raw.adminKey] : raw.admins);
  return {
    ...raw,
    keys,
    signing: raw.signing ?? generateGroupSigningPair(),
    sendSeq: raw.sendSeq ?? 0,
    peerSeqs: raw.peerSeqs ?? {},
    members: (raw.members ?? []).map(m => ({ ...m })),
    admins,
  };
}
