import { describe, it, expect } from 'vitest';
import { encryptWithKey, decryptWithKey, isAtRestBox } from './atRestCrypto';

describe('atRestCrypto (cœur AES-GCM)', () => {
  it('chiffre et déchiffre une charge sérialisée', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const box = await encryptWithKey(key, JSON.stringify({ a: 1, b: 'secret' }));
    expect(typeof box.iv).toBe('string');
    expect(typeof box.ct).toBe('string');
    const out = await decryptWithKey(key, box);
    expect(JSON.parse(out)).toEqual({ a: 1, b: 'secret' });
  });

  it('échoue à déchiffrer avec une mauvaise clé', async () => {
    const k1 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const k2 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const box = await encryptWithKey(k1, 'x');
    await expect(decryptWithKey(k2, box)).rejects.toBeTruthy();
  });

  it('isAtRestBox distingue un box d’une valeur historique', () => {
    expect(isAtRestBox({ v: 2, iv: 'a', ct: 'b' })).toBe(true);
    expect(isAtRestBox({ a: 1 })).toBe(false);
    expect(isAtRestBox('clair')).toBe(false);
    expect(isAtRestBox(null)).toBe(false);
  });
});
