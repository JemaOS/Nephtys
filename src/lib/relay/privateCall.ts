// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Mode privé — appels (contrôleur de signalisation WebRTC).
 *
 * Le `RTCPeerConnection` est **injecté** (`createPeer`) → entièrement testable
 * avec un faux pair. La signalisation (offer/answer/ICE/end) transite via le
 * canal privé chiffré fourni par `send` (le relais ne voit rien).
 *
 * Sécurité :
 *   • **Consentement obligatoire** : une `offer` entrante passe en état
 *     `ringing` et N'ACQUIERT AUCUN média ni ne répond avant un appel explicite
 *     à `accept()` (l'UI affiche Accepter/Refuser). Aucune caméra/micro n'est
 *     ouvert depuis le simple signal.
 *   • **Anti-rejeu / rattachement d'appel** : chaque signal porte un `callId`
 *     et un `seq` monotone ; les signaux d'un autre appel, rejoués ou anciens
 *     sont ignorés (seul `offer` peut (re)démarrer une sonnerie).
 *
 * Repli gracieux : si WebRTC est indisponible (`createPeer` → null), l'état
 * passe à `unsupported` sans planter.
 */

import { encodeCallSignal, parseCallSignal, type CallSignal } from './callSignaling';

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

function newCallId(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  } catch {
    return `call-${Date.now()}`;
  }
}

export class PrivateCall {
  private peer: PeerLike | null = null;
  private conversationId: string | null = null;
  private state: CallState = 'idle';
  private callId: string | null = null;
  private outSeq = 0;
  private lastSeq = -1;
  private readonly seenSeqs = new Set<number>();
  /** Identifiants d'appels entrants déjà traités (anti-rejeu d'`offer`). */
  private readonly seenCallIds = new Set<string>();
  private pendingOffer: string | null = null;
  private pendingIce: (RTCIceCandidateInit | null)[] = [];

  constructor(private readonly deps: CallDeps) {}

  /** Vrai si un appel entrant est en attente de consentement (Accepter/Refuser). */
  get isRinging(): boolean {
    return this.state === 'ringing' && this.pendingOffer !== null;
  }

  private setState(state: CallState): void {
    this.state = state;
    if (this.conversationId) this.deps.onState(this.conversationId, state);
  }

  private reset(conversationId: string, callId: string | null = null): void {
    // Ferme le pair précédent AVANT de l'écraser (sinon fuite de PeerConnection
    // et de ses médias/ICE).
    this.peer?.close();
    this.peer = null;
    this.conversationId = conversationId;
    this.callId = callId ?? newCallId();
    this.outSeq = 0;
    this.lastSeq = -1;
    this.seenSeqs.clear();
    this.pendingOffer = null;
    this.pendingIce = [];
  }

  private async sendSignal(conversationId: string, signal: CallSignal): Promise<void> {
    const seq = ++this.outSeq;
    await this.deps.send(
      conversationId,
      encodeCallSignal(signal, { callId: this.callId ?? undefined, seq, ts: Date.now() }),
    );
  }

  private createPeer(conversationId: string): PeerLike | null {
    const peer = this.deps.createPeer();
    if (!peer) {
      this.setState('unsupported');
      return null;
    }
    peer.onicecandidate = ev => {
      void this.sendSignal(conversationId, { kind: 'ice', candidate: ev.candidate });
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
    if (this.state !== 'idle' && this.state !== 'ended') return;
    this.reset(conversationId);
    this.setState('calling');
    const peer = this.createPeer(conversationId);
    if (!peer) return;
    this.peer = peer;
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await this.sendSignal(conversationId, { kind: 'offer', sdp: offer.sdp ?? '' });
  }

  /**
   * Accepte un appel entrant (après acquisition des médias par l'appelant).
   * Crée alors seulement la réponse WebRTC et l'envoie.
   */
  async accept(conversationId: string): Promise<void> {
    if (this.pendingOffer === null || this.conversationId !== conversationId || this.state !== 'ringing') return;
    const offerSdp = this.pendingOffer;
    this.pendingOffer = null;

    const peer = this.createPeer(conversationId);
    if (!peer) return;
    this.peer = peer;
    await peer.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    this.setState('connecting');
    await this.sendSignal(conversationId, { kind: 'answer', sdp: answer.sdp ?? '' });

    // Candidats ICE arrivés avant l'acceptation : rejoués maintenant.
    const buffered = this.pendingIce;
    this.pendingIce = [];
    for (const candidate of buffered) {
      try {
        await peer.addIceCandidate(candidate);
      } catch {
        // candidat invalide → ignoré
      }
    }
  }

  /** Refuse un appel entrant (aucun média n'a été acquis). */
  async reject(conversationId: string): Promise<void> {
    if (this.conversationId !== conversationId) return;
    this.pendingOffer = null;
    this.pendingIce = [];
    try {
      await this.sendSignal(conversationId, { kind: 'end' });
    } catch {
      // best-effort
    }
    this.peer?.close();
    this.peer = null;
    this.setState('idle');
  }

  /** Traite une signalisation entrante. */
  async handleSignal(conversationId: string, text: string): Promise<void> {
    const signal = parseCallSignal(text);
    if (!signal) return;

    const busy = this.state !== 'idle' && this.state !== 'ended';

    // Rattachement à l'appel actif : un signal (hors nouvelle `offer`) pour une
    // autre conversation pendant un appel actif est ignoré.
    if (busy && this.conversationId && this.conversationId !== conversationId) return;
    if (signal.kind !== 'offer') {
      if (this.conversationId !== conversationId || !busy) return;
      // Anti-rejeu : identifiant d'appel + numéro de séquence monotone.
      if (signal.callId && this.callId && signal.callId !== this.callId) return;
      if (typeof signal.seq === 'number') {
        if (this.seenSeqs.has(signal.seq)) return; // rejoué
        if (signal.seq <= this.lastSeq) return;    // ancien
        this.seenSeqs.add(signal.seq);
        this.lastSeq = signal.seq;
      }
    }

    if (signal.kind === 'end') {
      this.peer?.close();
      this.peer = null;
      this.pendingOffer = null;
      this.pendingIce = [];
      this.setState('ended');
      return;
    }

    if (signal.kind === 'offer') {
      // Offre rejouée, appel déjà en cours/fini, ou NOUS sommes déjà en train
      // d'appeler (`calling`) → on est « occupé » : on ignore l'offre entrante
      // (aucun droit d'écraser un appel sortant en cours).
      if (
        this.pendingOffer !== null ||
        (signal.callId != null && this.seenCallIds.has(signal.callId)) ||
        (this.conversationId === conversationId &&
          (this.state === 'calling' ||
            this.state === 'ringing' ||
            this.state === 'connecting' ||
            this.state === 'connected'))
      ) {
        return;
      }
      this.reset(conversationId, signal.callId ?? null);
      if (signal.callId) {
        this.callId = signal.callId;
        // Anti-rejeu d'`offer` : mémorise l'identifiant d'appel (borne mémoire).
        if (this.seenCallIds.size > 64) this.seenCallIds.clear();
        this.seenCallIds.add(signal.callId);
      }
      // IMPORTANT : aucune acquisition média ni réponse ici. On sonne.
      this.pendingOffer = signal.sdp;
      this.setState('ringing');
      return;
    }

    if (signal.kind === 'answer') {
      if (!this.peer || this.state !== 'calling') return; // tardif/rejoué
      await this.peer.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      this.setState('connecting');
      return;
    }

    if (signal.kind === 'ice') {
      if (!this.peer) {
        this.pendingIce.push(signal.candidate ?? null);
        return;
      }
      try {
        await this.peer.addIceCandidate(signal.candidate ?? null);
      } catch {
        // candidat invalide → ignoré
      }
    }
  }

  /** Termine l'appel. */
  async end(conversationId: string): Promise<void> {
    if (this.conversationId !== conversationId) this.conversationId = conversationId;
    try {
      await this.sendSignal(conversationId, { kind: 'end' });
    } catch {
      // best-effort
    }
    this.peer?.close();
    this.peer = null;
    this.pendingOffer = null;
    this.pendingIce = [];
    this.setState('ended');
  }
}
