import { describe, it, expect } from 'vitest';
import { generateLinkCode, linkCodeCommitment, fulfillLinkRequest } from './deviceLinkChannel';
import { isDeviceLink, redeemDeviceLink } from './deviceLink';

describe('deviceLinkChannel — code de confirmation', () => {
  it('génère un code à 6 chiffres', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateLinkCode()).toMatch(/^\d{6}$/);
    }
  });

  it('engagement déterministe, dépendant du code et de la file', async () => {
    const a = await linkCodeCommitment('123456', 'queue-1');
    const b = await linkCodeCommitment('123456', 'queue-1');
    const c = await linkCodeCommitment('654321', 'queue-1');
    const d = await linkCodeCommitment('123456', 'queue-2');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });

  it('refuse un QR dont le code ne satisfait pas l’engagement', async () => {
    const h = await linkCodeCommitment('123456', 'queue-1');
    const qr = JSON.stringify({ q: 'queue-1', s: 'send', e: 'eph', h });
    await expect(fulfillLinkRequest(qr, '000000')).rejects.toThrow(/incorrect/i);
  });

  it('refuse un QR malformé', async () => {
    await expect(fulfillLinkRequest('pas-du-json', '123456')).rejects.toThrow(/QR/i);
  });

  it('refuse un code non numérique / incomplet', async () => {
    const h = await linkCodeCommitment('123456', 'queue-1');
    const qr = JSON.stringify({ q: 'queue-1', s: 'send', e: 'eph', h });
    await expect(fulfillLinkRequest(qr, '12ab')).rejects.toThrow(/6 chiffres/i);
  });
});

describe('deviceLink — confirmation obligatoire', () => {
  it('reconnaît le préfixe du lien', () => {
    expect(isDeviceLink('NEPHTYS-DEVICE1:abc')).toBe(true);
    expect(isDeviceLink('autre')).toBe(false);
  });

  it('refuse une liaison sans confirmation explicite', async () => {
    await expect(redeemDeviceLink('NEPHTYS-DEVICE1:abc')).rejects.toThrow(/confirmation/i);
  });
});
