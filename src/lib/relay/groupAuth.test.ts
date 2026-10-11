import { describe, it, expect } from 'vitest';
import { generateGroupSigningPair, signGroupPayload, verifyGroupPayload } from './groupAuth';

describe('groupAuth (authentification des payloads de groupe, Ed25519)', () => {
  it('signe et vérifie un payload avec la clé de l’émetteur', () => {
    const kp = generateGroupSigningPair();
    const payload = JSON.stringify({ type: 'rotate', epoch: 3, key: 'abc' });
    const sig = signGroupPayload('g1', 7, kp.publicKey, payload, kp.privateKey);
    expect(verifyGroupPayload('g1', 7, kp.publicKey, payload, sig)).toBe(true);
  });

  it('rejette un payload altéré', () => {
    const kp = generateGroupSigningPair();
    const sig = signGroupPayload('g1', 1, kp.publicKey, JSON.stringify({ x: 1 }), kp.privateKey);
    expect(verifyGroupPayload('g1', 1, kp.publicKey, JSON.stringify({ x: 2 }), sig)).toBe(false);
  });

  it('rejette un rejeu sous un autre groupe, une autre seq ou un autre émetteur', () => {
    const a = generateGroupSigningPair();
    const b = generateGroupSigningPair();
    const payload = JSON.stringify({ type: 'members', epoch: 1, key: 'k' });
    const sig = signGroupPayload('g1', 5, a.publicKey, payload, a.privateKey);

    expect(verifyGroupPayload('g2', 5, a.publicKey, payload, sig)).toBe(false); // autre groupe
    expect(verifyGroupPayload('g1', 6, a.publicKey, payload, sig)).toBe(false); // autre seq
    expect(verifyGroupPayload('g1', 5, b.publicKey, payload, sig)).toBe(false); // usurpation d'émetteur
  });
});
