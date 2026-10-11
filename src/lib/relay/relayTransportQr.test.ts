import { describe, it, expect } from 'vitest';
import { encodeInvite, decodeInvite } from './relayTransport';

// Tokens simules de la taille reelle post-compaction (~560 car. base64url).
function rnd(n: number): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let s = '';
  for (let i = 0; i < n; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

describe('invitation compacte (QR)', () => {
  it('tient sous la capacité du QR code', () => {
    const invite = {
      rcvQueue: { queueId: rnd(560), queueKey: rnd(560), relay: 'wss://78-232-3-78.sslip.io/' },
      sendQueue: { queueId: rnd(560), queueKey: rnd(560), relay: 'wss://78-232-3-78.sslip.io/' },
    };
    const encoded = encodeInvite(invite);
    expect(decodeInvite(encoded)).toEqual(invite);
    expect(encoded.length).toBeLessThan(2950);
  });
});
