import { describe, it, expect } from 'vitest';
import { RelayCore } from './relayCore';
import { LocalWire } from './wire';
import { GroupMessenger, InMemoryGroupStore } from './groupMessenger';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const mk = (core: RelayCore) => new GroupMessenger(new LocalWire(core), new InMemoryGroupStore(), 10);

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
    await wait(250); // handshake (join -> members)

    // Créateur → Alice
    await creator.send(gid, 'hello all');
    await wait(250);
    expect(aRecv).toContain('hello all');

    // Alice → Créateur
    await alice.send(gid, 'hi creator');
    await wait(250);
    expect(cRecv).toContain('hi creator');

    // Bob rejoint → maillage complet
    const bRec = await bob.join(invite, 'Bob');
    const unsubB = bob.subscribe(gid, t => bRecv.push(t));
    await wait(300);

    await creator.send(gid, 'second');
    await wait(300);
    expect(aRecv).toContain('second');
    expect(bRecv).toContain('second');

    // Alice et Bob se connaissent désormais (maillage) : Alice → Bob
    await alice.send(gid, 'coucou bob');
    await wait(300);
    expect(bRecv).toContain('coucou bob');

    // Retrait de Bob : rotation → Bob ne reçoit plus les nouveaux messages
    const bobMemberId = `m-${bRec.mySend.queueId}`;
    await creator.removeMember(gid, bobMemberId);
    await wait(200);
    await creator.send(gid, 'secret apres retrait');
    await wait(300);
    expect(aRecv).toContain('secret apres retrait');
    expect(bRecv).not.toContain('secret apres retrait');

    unsubC(); unsubA(); unsubB();
  });
});
