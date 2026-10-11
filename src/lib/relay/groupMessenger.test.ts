import { describe, it, expect } from 'vitest';
import { RelayCore } from './relayCore';
import { LocalWire } from './wire';
import { GroupMessenger, InMemoryGroupStore } from './groupMessenger';

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
    await creator.send(gid, 'secret apres retrait');
    await waitFor(() => aRecv.includes('secret apres retrait'));
    // Laisse le temps à un éventuel message tardif d'arriver chez Bob.
    await wait(300);
    expect(bRecv).not.toContain('secret apres retrait');

    unsubC(); unsubA(); unsubB();
  });
});
