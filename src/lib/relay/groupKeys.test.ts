import { describe, it, expect } from 'vitest';
import {
  createGroupKeys,
  rotateGroupKeys,
  addEpochKey,
  pruneEpochKeys,
  encryptGroupMessage,
  decryptGroupMessage,
  serializeGroupKeys,
  deserializeGroupKeys,
} from './groupKeys';

describe('groupKeys (clés de groupe par époque)', () => {
  it('round-trip époque 0', async () => {
    const { state, keyB64 } = createGroupKeys('g1');
    const msg = await encryptGroupMessage('g1', 0, keyB64, 'salut le groupe');
    expect(msg.epoch).toBe(0);
    expect(await decryptGroupMessage(state, msg.epoch, msg.iv, msg.ct)).toBe('salut le groupe');
  });

  it('rotation : nouvelle époque, l’ancienne reste lisible', async () => {
    const { state, keyB64 } = createGroupKeys('g1');
    const msg0 = await encryptGroupMessage('g1', 0, keyB64, 'avant');
    const { state: s1, keyB64: k1 } = rotateGroupKeys(state);
    const msg1 = await encryptGroupMessage('g1', s1.currentEpoch, k1, 'apres');

    expect(await decryptGroupMessage(s1, msg0.epoch, msg0.iv, msg0.ct)).toBe('avant');
    expect(await decryptGroupMessage(s1, msg1.epoch, msg1.iv, msg1.ct)).toBe('apres');
    expect(s1.currentEpoch).toBe(1);
    expect(k1).not.toBe(keyB64);
  });

  it('un membre retiré ne peut pas lire la nouvelle époque', async () => {
    const { state } = createGroupKeys('g1');
    const { state: rotated, keyB64: k1 } = rotateGroupKeys(state);
    const msg1 = await encryptGroupMessage('g1', rotated.currentEpoch, k1, 'secret');
    await expect(decryptGroupMessage(state, msg1.epoch, msg1.iv, msg1.ct)).rejects.toThrow(/poque/);
  });

  it('distribution d’une clé d’époque à un nouveau membre', async () => {
    const { state: base } = createGroupKeys('g1');
    const { state: rotated, keyB64: k1 } = rotateGroupKeys(base);

    const outsider = addEpochKey({ groupId: 'g1', currentEpoch: 0, keys: {} }, rotated.currentEpoch, k1);
    const msg = await encryptGroupMessage('g1', rotated.currentEpoch, k1, 'bienvenue');
    expect(await decryptGroupMessage(outsider, msg.epoch, msg.iv, msg.ct)).toBe('bienvenue');
  });

  it('mauvais groupId → échec (AAD liée au groupe)', async () => {
    const { state, keyB64 } = createGroupKeys('g1');
    const msg = await encryptGroupMessage('g1', 0, keyB64, 'x');
    const other = { ...state, groupId: 'g2' };
    await expect(decryptGroupMessage(other, 0, msg.iv, msg.ct)).rejects.toBeTruthy();
  });

  it('serialize/deserialize + prune des époques', () => {
    let st = createGroupKeys('g1').state;
    for (let i = 0; i < 8; i++) st = rotateGroupKeys(st).state;
    const pruned = pruneEpochKeys(st, 3);
    expect(Object.keys(pruned.keys).length).toBe(3);
    expect(deserializeGroupKeys(serializeGroupKeys(pruned))).toEqual(pruned);
  });
});
