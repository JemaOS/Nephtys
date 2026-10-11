import { describe, it, expect } from 'vitest';
import { RelayCore, type StoredEnvelope } from './relayCore';
import { LocalWire } from './wire';
import { GroupMessenger, InMemoryGroupStore, type GroupRecord, type GroupMember } from './groupMessenger';
import { generateGroupSigningPair, signGroupPayload } from './groupAuth';
import { encryptGroupMessage, rotateGroupKeys } from './groupKeys';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Attend qu'une condition (potentiellement async) devienne vraie (robuste au jitter des timers). */
const waitFor = async (cond: () => boolean | Promise<boolean>, timeout = 8000): Promise<boolean> => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await cond()) return true;
    await wait(25);
  }
  return await cond();
};
const mk = (core: RelayCore) => new GroupMessenger(new LocalWire(core), new InMemoryGroupStore(), 10);
const memberCount = async (m: GroupMessenger, gid: string): Promise<number> =>
  (await m.listGroups()).find(g => g.groupId === gid)?.members.length ?? -1;
const recordOf = async (m: GroupMessenger, gid: string): Promise<GroupRecord> => {
  const rec = (await m.listGroups()).find(g => g.groupId === gid);
  if (!rec) throw new Error('record introuvable');
  return rec;
};

/** Accès contrôlé à la logique interne d'ingestion (pour forger des payloads malveillants). */
interface GroupInternals {
  handleIncoming(record: GroupRecord, stored: StoredEnvelope, onText: (t: string) => void): Promise<GroupRecord>;
}
const handleIncomingOf = (m: GroupMessenger) =>
  (m as unknown as GroupInternals).handleIncoming.bind(m);

/** Construit un message signé + chiffré (comme un émetteur quelconque du groupe). */
async function forge(params: {
  groupId: string;
  from: string;
  privateKey: string;
  epoch: number;
  keyB64: string;
  payload: unknown;
  seq?: number;
  /** true → enveloppe v1 (sans champ `v`), pour tester la lecture de l'ancien format. */
  v1?: boolean;
}): Promise<StoredEnvelope> {
  const seq = params.seq ?? 1000;
  const json = JSON.stringify(params.payload);
  const sig = signGroupPayload(params.groupId, seq, params.from, json, params.privateKey);
  const env: Record<string, unknown> = { seq, from: params.from, sig, payload: params.payload };
  if (!params.v1) env.v = 2;
  const msg = await encryptGroupMessage(params.groupId, params.epoch, params.keyB64, JSON.stringify(env));
  return { id: `forged-${seq}`, ciphertext: JSON.stringify(msg), ts: 0, expiresAt: Date.now() + 60_000 };
}

/** Ajoute un membre connu (attaquant) à une copie du record. */
const withKnownMember = (rec: GroupRecord, signingKey: string, queueId = 'q-atk'): GroupRecord => ({
  ...rec,
  members: [...rec.members, { id: `m-${queueId}`, name: 'Atk', send: { queueId, queueKey: 'k' }, signingKey } satisfies GroupMember],
});


describe('GroupMessenger (mode privé, files anonymes)', () => {
  it('création + join + maillage + retrait avec rotation', async () => {
    const core = new RelayCore();
    const creator = mk(core);
    const alice = mk(core);
    const bob = mk(core);

    const { record, invite } = await creator.create('Team');
    const gid = record.groupId;

    const cRecv: string[] = [];
    const aRecv: string[] = [];
    const bRecv: string[] = [];
    const unsubC = creator.subscribe(gid, t => cRecv.push(t));

    const aRec = await alice.join(invite, 'Alice');
    const unsubA = alice.subscribe(gid, t => aRecv.push(t));

    // Handshake : l'invitant doit avoir enregistré Alice avant d'envoyer.
    await waitFor(async () => (await memberCount(creator, gid)) >= 1);

    // Créateur → Alice
    await creator.send(gid, 'hello all');
    await waitFor(() => aRecv.includes('hello all'));

    // Alice → Créateur
    await alice.send(gid, 'hi creator');
    await waitFor(() => cRecv.includes('hi creator'));

    // Bob rejoint → maillage complet
    const bRec = await bob.join(invite, 'Bob');
    const unsubB = bob.subscribe(gid, t => bRecv.push(t));
    await waitFor(async () => (await memberCount(creator, gid)) >= 2);
    // Alice apprend Bob via la diffusion de la liste des membres.
    await waitFor(async () => (await memberCount(alice, gid)) >= 2);

    await creator.send(gid, 'second');
    await waitFor(() => aRecv.includes('second') && bRecv.includes('second'));

    // Alice et Bob se connaissent désormais (maillage) : Alice → Bob
    await alice.send(gid, 'coucou bob');
    await waitFor(() => bRecv.includes('coucou bob'));

    // Retrait de Bob : rotation → Bob ne reçoit plus les nouveaux messages
    const bobMemberId = `m-${bRec.mySend.queueId}`;
    await creator.removeMember(gid, bobMemberId);
    await waitFor(async () => (await memberCount(creator, gid)) === 1);
    // La nouvelle liste `members` (diffusée par l'admin) est appliquée chez les
    // restants : Alice ne connaît plus Bob.
    await waitFor(async () => (await memberCount(alice, gid)) === 1);
    const aliceRec = await recordOf(alice, gid);
    expect(aliceRec.members.some(m => m.id === bobMemberId)).toBe(false);
    await creator.send(gid, 'secret apres retrait');
    await waitFor(() => aRecv.includes('secret apres retrait'));
    // Laisse le temps à un éventuel message tardif d'arriver chez Bob.
    await wait(300);
    expect(bRecv).not.toContain('secret apres retrait');

    unsubC(); unsubA(); unsubB();
  });
});

describe('GroupMessenger — autorité admin & anti-rejeu (audit S1)', () => {
  it('un membre NON-admin ne peut pas imposer `members`/`rotate`', async () => {
    const core = new RelayCore();
    const creator = mk(core);
    const { record } = await creator.create('Team');
    const gid = record.groupId;
    const h = handleIncomingOf(creator);

    const attacker = generateGroupSigningPair();
    const rec = withKnownMember(record, attacker.publicKey);
    const epoch = rec.keys.currentEpoch;
    const key = rec.keys.keys[String(epoch)];

    for (const payload of [
      { type: 'members', members: [], epoch: 99, key: 'AAAA', adminKey: attacker.publicKey, v: 2 },
      { type: 'rotate', epoch: 99, key: 'AAAA', v: 2 },
    ]) {
      const stored = await forge({
        groupId: gid, from: attacker.publicKey, privateKey: attacker.privateKey,
        epoch, keyB64: key, payload,
      });
      const out = await h(rec, stored, () => {});
      expect(out.keys.currentEpoch).toBe(epoch);
      expect(out.keys.keys['99']).toBeUndefined();
    }
  });

  it('un `text` reste accepté d’un membre connu (non-admin)', async () => {
    const core = new RelayCore();
    const creator = mk(core);
    const { record } = await creator.create('Team');
    const gid = record.groupId;
    const h = handleIncomingOf(creator);

    const attacker = generateGroupSigningPair();
    const rec = withKnownMember(record, attacker.publicKey);
    const epoch = rec.keys.currentEpoch;
    const seen: string[] = [];
    const stored = await forge({
      groupId: gid, from: attacker.publicKey, privateKey: attacker.privateKey,
      epoch, keyB64: rec.keys.keys[String(epoch)], payload: { type: 'text', text: 'salut' },
    });
    await h(rec, stored, t => seen.push(t));
    expect(seen).toEqual(['salut']);
  });

  it('anti-rejeu d’époque : un `text` à une époque antérieure est refusé', async () => {
    const core = new RelayCore();
    const creator = mk(core);
    const { record } = await creator.create('Team');
    const gid = record.groupId;
    const h = handleIncomingOf(creator);

    const attacker = generateGroupSigningPair();
    const { state: rotated, keyB64: k1 } = rotateGroupKeys(record.keys);
    const rec = withKnownMember({ ...record, keys: rotated }, attacker.publicKey);
    const oldEpoch = record.keys.currentEpoch;

    const seen: string[] = [];
    // Écriture forgée à l'ancienne époque (0) alors que l'époque courante est 1.
    const stale = await forge({
      groupId: gid, from: attacker.publicKey, privateKey: attacker.privateKey,
      epoch: oldEpoch, keyB64: record.keys.keys[String(oldEpoch)], payload: { type: 'text', text: 'retard' },
    });
    await h(rec, stale, t => seen.push(t));
    expect(seen).toEqual([]);

    // À l'époque courante, le même émetteur passe.
    const fresh = await forge({
      groupId: gid, from: attacker.publicKey, privateKey: attacker.privateKey,
      epoch: rotated.currentEpoch, keyB64: k1, seq: 1001, payload: { type: 'text', text: 'a jour' },
    });
    await h(rec, fresh, t => seen.push(t));
    expect(seen).toEqual(['a jour']);
  });

  it('groupe HÉRITÉ (sans admin déclaré) : contrôle d’un membre connu encore accepté (tolérance)', async () => {
    const core = new RelayCore();
    const creator = mk(core);
    const { record } = await creator.create('Team');
    const gid = record.groupId;
    const h = handleIncomingOf(creator);

    const attacker = generateGroupSigningPair();
    const { state: rotated, keyB64: k1 } = rotateGroupKeys(record.keys);
    // adminKey retirée → mode hérité tolérant, et enveloppe v1 (sans `v`).
    const rec: GroupRecord = withKnownMember({ ...record, adminKey: undefined }, attacker.publicKey);
    const stored = await forge({
      groupId: gid, from: attacker.publicKey, privateKey: attacker.privateKey,
      epoch: rec.keys.currentEpoch, keyB64: rec.keys.keys[String(rec.keys.currentEpoch)],
      v1: true,
      payload: {
        type: 'members',
        members: [{ id: 'inviter', name: 'inviter', send: { queueId: 'qc', queueKey: 'kc' }, signingKey: attacker.publicKey }],
        epoch: rotated.currentEpoch, key: k1,
      },
    });
    const out = await h(rec, stored, () => {});
    expect(out.keys.currentEpoch).toBe(rotated.currentEpoch);
    expect(out.keys.keys[String(rotated.currentEpoch)]).toBe(k1);
  });

  it('l’admin diffuse la liste : `removeMember` refusé à un non-admin', async () => {
    const core = new RelayCore();
    const creator = mk(core);
    const alice = mk(core);
    const { record, invite } = await creator.create('Team');
    await alice.join(invite, 'Alice');
    await expect(alice.removeMember(record.groupId, 'inviter')).rejects.toThrow(/administrateur/i);
  });
});
