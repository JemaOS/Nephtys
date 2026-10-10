// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Mode privé — appels (contrôleur de signalisation WebRTC).
 *
 * Le `RTCPeerConnection` est **injecté** (`createPeer`) → entièrement testable
 * avec un faux pair. La signalisation (offer/answer/ICE/end) transite via le
 * canal privé chiffré fourni par `send` (le relais ne voit rien).
 *
 * Repli gracieux : si WebRTC est indisponible (`createPeer` → null), l'état
 * passe à `unsupported` sans planter.
 */

import { encodeCallSignal, parseCallSignal } from './callSignaling';

export interface PeerLike {
  onicecandidate: ((ev: { candidate: RTCIceCandidateInit | null }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  connectionState?: string | null;
  createOffer(): Promise<{ type: string; sdp?: string }>;
  createAnswer(): Promise<{ type: string; sdp?: string }>;
  setLocalDescription(desc: unknown): Promise<void>;
  setRemoteDescription(desc: unknown): Promise<void>;
  addIceCandidate(candidate: unknown): Promise<void>;
  close(): void;
}

export type CallState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'ended' | 'unsupported';

export interface CallDeps {
  /** Crée un pair, ou `null` si WebRTC indisponible. */
  createPeer: () => PeerLike | null;
  send: (conversationId: string, text: string) => Promise<void>;
  onState: (conversationId: string, state: CallState) => void;
}

export class PrivateCall {
  private peer: PeerLike | null = null;
  private conversationId: string | null = null;

  constructor(private readonly deps: CallDeps) {}

  private setState(state: CallState): void {
    if (this.conversationId) this.deps.onState(this.conversationId, state);
  }

  private setupPeer(conversationId: string): PeerLike | null {
    const peer = this.deps.createPeer();
    if (!peer) {
      this.conversationId = conversationId;
      this.setState('unsupported');
      return null;
    }
    peer.onicecandidate = ev => {
      void this.deps.send(conversationId, encodeCallSignal({ kind: 'ice', candidate: ev.candidate }));
    };
    peer.onconnectionstatechange = () => {
      const st = peer.connectionState;
      if (st === 'connected') this.setState('connected');
      else if (st === 'failed' || st === 'disconnected' || st === 'closed') this.setState('ended');
    };
    return peer;
  }

  /** Démarre un appel sortant. */
  async start(conversationId: string): Promise<void> {
    this.conversationId = conversationId;
    const peer = this.setupPeer(conversationId);
    if (!peer) return;
    this.peer = peer;
    this.setState('calling');
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await this.deps.send(conversationId, encodeCallSignal({ kind: 'offer', sdp: offer.sdp ?? '' }));
  }

  /** Traite une signalisation entrante. */
  async handleSignal(conversationId: string, text: string): Promise<void> {
    const signal = parseCallSignal(text);
    if (!signal) return;

    if (signal.kind === 'end') {
      this.peer?.close();
      this.peer = null;
      this.conversationId = conversationId;
      this.setState('ended');
      return;
    }

    if (signal.kind === 'offer') {
      this.conversationId = conversationId;
      if (!this.peer) {
        const peer = this.setupPeer(conversationId);
        if (!peer) return;
        this.peer = peer;
      }
      this.setState('ringing');
      await this.peer.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      const answer = await this.peer.createAnswer();
      await this.peer.setLocalDescription(answer);
      this.setState('connecting');
      await this.deps.send(conversationId, encodeCallSignal({ kind: 'answer', sdp: answer.sdp ?? '' }));
      return;
    }

    if (signal.kind === 'answer') {
      if (!this.peer) return;
      await this.peer.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      this.setState('connecting');
      return;
    }

    if (signal.kind === 'ice') {
      if (!this.peer) return;
      try {
        await this.peer.addIceCandidate(signal.candidate ?? null);
      } catch {
        // candidat invalide → ignoré
      }
    }
  }

  /** Termine l'appel. */
  async end(conversationId: string): Promise<void> {
    try {
      await this.deps.send(conversationId, encodeCallSignal({ kind: 'end' }));
    } catch {
      // best-effort
    }
    this.peer?.close();
    this.peer = null;
    this.conversationId = conversationId;
    this.setState('ended');
  }
}
