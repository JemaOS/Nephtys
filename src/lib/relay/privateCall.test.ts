import { describe, it, expect } from 'vitest';
import { encodeCallSignal, parseCallSignal } from './callSignaling';
import { PrivateCall, type PeerLike, type CallState } from './privateCall';

class FakePeer implements PeerLike {
  onicecandidate: ((ev: { candidate: RTCIceCandidateInit | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState: string | null = 'new';
  candidates: unknown[] = [];
  closed = false;

  async createOffer() { return { type: 'offer', sdp: 'OFFER' }; }
  async createAnswer() { return { type: 'answer', sdp: 'ANSWER' }; }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  async addIceCandidate(c: unknown) { this.candidates.push(c); }
  close() { this.closed = true; this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
  emitIce(c: unknown) { this.onicecandidate?.({ candidate: c as RTCIceCandidateInit | null }); }
  setConnected() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); }
}

describe('callSignaling (codec)', () => {
  it('encode/parse une offre', () => {
    const s = encodeCallSignal({ kind: 'offer', sdp: 'x' });
    expect(parseCallSignal(s)).toEqual({ kind: 'offer', sdp: 'x' });
    expect(parseCallSignal('texte')).toBeNull();
  });

  it('joint les métadonnées anti-rejeu (callId/seq) quand fournies', () => {
    const s = encodeCallSignal({ kind: 'end' }, { callId: 'c1', seq: 3 });
    expect(parseCallSignal(s)).toMatchObject({ kind: 'end', callId: 'c1', seq: 3 });
  });
});

describe('PrivateCall (signalisation via canal chiffré)', () => {
  it('offer → sonnerie (pas de réponse) → accept → answer → ICE → connected → end', async () => {
    const statesA: CallState[] = [];
    const statesB: CallState[] = [];
    let peerA: FakePeer | null = null;
    let peerB: FakePeer | null = null;

    const B = new PrivateCall({
      createPeer: () => (peerB = new FakePeer()),
      send: async (_c, text) => { await A.handleSignal('c', text); },
      onState: (_c, s) => statesB.push(s),
    });
    const A = new PrivateCall({
      createPeer: () => (peerA = new FakePeer()),
      send: async (_c, text) => { await B.handleSignal('c', text); },
      onState: (_c, s) => statesA.push(s),
    });

    await A.start('c');
    expect(statesA).toContain('calling');
    // B sonne mais ne répond PAS automatiquement : aucun média, aucune answer.
    expect(statesB).toContain('ringing');
    expect(B.isRinging).toBe(true);
    expect(peerB).toBeNull();
    expect(statesB).not.toContain('connecting');
    expect(statesA).not.toContain('connecting');

    // Acceptation explicite → réponse + mise en connexion.
    await B.accept('c');
    expect(peerB).not.toBeNull();
    expect(statesB).toContain('connecting');
    expect(statesA).toContain('connecting');

    // ICE : A → B
    peerA!.emitIce({ candidate: 'candA' });
    await new Promise(r => setTimeout(r, 0));
    expect(peerB!.candidates).toContainEqual({ candidate: 'candA' });

    // Connexion établie
    peerA!.setConnected();
    expect(statesA).toContain('connected');

    // B raccroche → A reçoit « end »
    await B.end('c');
    expect(statesA).toContain('ended');
    expect(peerA!.closed).toBe(true);
  });

  it('refuse un appel entrant sans acquérir de média (reject)', async () => {
    const statesB: CallState[] = [];
    let peerB: FakePeer | null = null;
    const sent: string[] = [];
    const B = new PrivateCall({
      createPeer: () => (peerB = new FakePeer()),
      send: async (_c, text) => { sent.push(text); },
      onState: (_c, s) => statesB.push(s),
    });

    await B.handleSignal('c', encodeCallSignal({ kind: 'offer', sdp: 'OFFER' }, { callId: 'x1', seq: 1 }));
    expect(statesB).toContain('ringing');
    expect(peerB).toBeNull();

    await B.reject('c');
    expect(peerB).toBeNull();
    expect(sent.some(t => t.includes('"kind":"end"'))).toBe(true);
  });

  it('ignore les signaux rejoués et ceux d’une autre conversation', async () => {
    const statesB: CallState[] = [];
    const B = new PrivateCall({
      createPeer: () => new FakePeer(),
      send: async () => {},
      onState: (_c, s) => statesB.push(s),
    });
    const offer = encodeCallSignal({ kind: 'offer', sdp: 'O' }, { callId: 'k', seq: 1 });
    await B.handleSignal('c', offer);
    await B.handleSignal('c', offer); // rejoué → ignoré (toujours une seule sonnerie)
    expect(statesB.filter(s => s === 'ringing').length).toBe(1);

    // Un « end » d'un AUTRE appel/conversation pendant l'activité est ignoré.
    const ended = statesB.length;
    await B.handleSignal('autre', encodeCallSignal({ kind: 'end' }, { callId: 'k', seq: 9 }));
    expect(statesB.length).toBe(ended);
  });

  it('WebRTC indisponible → repli gracieux (unsupported)', async () => {
    const states: CallState[] = [];
    const call = new PrivateCall({
      createPeer: () => null,
      send: async () => {},
      onState: (_c, s) => states.push(s),
    });
    await call.start('c');
    expect(states).toContain('unsupported');
  });
});
