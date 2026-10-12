import { describe, it, expect } from 'vitest';
import { comparePublicBundles } from './recoveryService';

const DERIVED = {
  identityKey: 'id-1',
  signingKey: 'sig-1',
  signedPreKey: 'spk-1',
  mlKemKey: 'mlkem-1',
  x25519Key: 'x25519:key-1',
};

describe('comparePublicBundles (phrase vs clés publiées)', () => {
  it('accepte une phrase qui correspond au bundle publié', () => {
    const r = comparePublicBundles(
      {
        ratchet_identity_key: 'id-1',
        ratchet_signing_key: 'sig-1',
        ratchet_signed_prekey: 'spk-1',
        ml_kem_public_key: 'mlkem-1',
        x25519_public_key: 'x25519:key-1',
      },
      DERIVED,
    );
    expect(r.published).toBe(true);
    expect(r.matches).toBe(true);
    expect(r.mismatches).toEqual([]);
  });

  it('refuse une phrase qui ne correspond PAS (substitution de clés)', () => {
    const r = comparePublicBundles(
      { ratchet_identity_key: 'id-1', x25519_public_key: 'x25519:autre' },
      DERIVED,
    );
    expect(r.published).toBe(true);
    expect(r.matches).toBe(false);
    expect(r.mismatches).toContain('x25519_public_key');
  });

  it('autorise un compte sans aucune clé publiée (rien à comparer)', () => {
    const r = comparePublicBundles(
      { ratchet_identity_key: null, x25519_public_key: null },
      DERIVED,
    );
    expect(r.published).toBe(false);
    expect(r.matches).toBe(true);
  });
});
