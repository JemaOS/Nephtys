// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { describe, it, expect } from 'vitest';
import { generateMlKemKeyPair, mlKemEncapsulate, mlKemDecapsulate } from './pqKem';

describe('pqKem (ML-KEM-768 — hybride post-quantique)', () => {
  it('encapsulation/décapsulation : même secret partagé', () => {
    const kp = generateMlKemKeyPair();
    const { cipherText, sharedSecret } = mlKemEncapsulate(kp.publicKey);
    const recovered = mlKemDecapsulate(cipherText, kp.secretKey);
    expect(recovered).toBe(sharedSecret);
  });

  it('un secret différent à chaque encapsulation (aléa)', () => {
    const kp = generateMlKemKeyPair();
    const a = mlKemEncapsulate(kp.publicKey);
    const b = mlKemEncapsulate(kp.publicKey);
    expect(a.sharedSecret).not.toBe(b.sharedSecret);
    expect(a.cipherText).not.toBe(b.cipherText);
  });

  it('une mauvaise clé secrète ne retrouve pas le secret', () => {
    const kp = generateMlKemKeyPair();
    const other = generateMlKemKeyPair();
    const { cipherText, sharedSecret } = mlKemEncapsulate(kp.publicKey);
    const wrong = mlKemDecapsulate(cipherText, other.secretKey);
    expect(wrong).not.toBe(sharedSecret);
  });
});
