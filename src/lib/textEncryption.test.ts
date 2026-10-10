import { describe, it, expect, vi } from 'vitest';

// Évite d'instancier le client Supabase dans l'environnement de test.
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import {
  encryptText,
  decryptText,
  decryptTextPayload,
  parseEnvelope,
  decryptMessageContent,
  decryptMessageRows,
} from './textEncryption';

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

describe('textEncryption', () => {
  it('round-trips a short text', async () => {
    const { ciphertextB64, ivB64, rawKey } = await encryptText('hello world');
    expect(ciphertextB64).not.toContain('hello');
    expect(await decryptText(ciphertextB64, ivB64, rawKey)).toBe('hello world');
  });

  it('round-trips long text and unicode/emoji', async () => {
    const text = 'é'.repeat(5000) + ' 🚀 مرحبا 😀';
    const { ciphertextB64, ivB64, rawKey } = await encryptText(text);
    expect(await decryptText(ciphertextB64, ivB64, rawKey)).toBe(text);
  });

  it('round-trips the link preview inside the encrypted payload', async () => {
    const linkPreview = { url: 'https://a.b', title: 'Titre', image: 'img', domain: 'a.b' };
    const { ciphertextB64, ivB64, rawKey } = await encryptText('regarde', linkPreview);
    expect(ciphertextB64).not.toContain('Titre');
    const decoded = await decryptTextPayload(ciphertextB64, ivB64, rawKey);
    expect(decoded.text).toBe('regarde');
    expect(decoded.linkPreview).toEqual(linkPreview);
  });

  it('pads the plaintext to a 256-byte multiple (length hiding)', async () => {
    const { ciphertextB64 } = await encryptText('a');
    const len = atob(ciphertextB64).length;
    // 16 octets = tag AES-GCM ; le reste est le plaintext rembourré.
    expect((len - 16) % 256).toBe(0);
  });

  it('fails to decrypt tampered ciphertext', async () => {
    const { ciphertextB64, ivB64, rawKey } = await encryptText('secret');
    const bytes = b64ToBytes(ciphertextB64);
    bytes[0] ^= 0xff;
    await expect(decryptText(bytesToB64(bytes), ivB64, rawKey)).rejects.toBeTruthy();
  });

  it('returns content unchanged for non-encrypted messages', async () => {
    expect(await decryptMessageContent({ id: 'x', content: 'plain' }, 'user')).toBe('plain');
  });

  it('leaves non-encrypted rows untouched', async () => {
    const rows = [{ id: '1', content: 'plain', is_text_encrypted: false }];
    await decryptMessageRows(rows, 'user');
    expect(rows[0].content).toBe('plain');
  });

  it('parses the envelope defensively', () => {
    expect(parseEnvelope(null)).toBeNull();
    expect(parseEnvelope('nope')).toBeNull();
    expect(parseEnvelope({ v: 1 })).toBeNull();
    expect(parseEnvelope({ v: 1, iv: 'abc' })?.iv).toBe('abc');
    expect(parseEnvelope({ iv: 'abc' })?.v).toBe(1);
  });
});
