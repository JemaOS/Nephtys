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
});

describe('PrivateCall (signalisation via canal chiffré)', () => {
  it('offer → answer → ICE → connected → end', async () => {
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
    expect(statesB).toContain('ringing');
    expect(statesA).toContain('connecting');
    expect(statesB).toContain('connecting');

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
