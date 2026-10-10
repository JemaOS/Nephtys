// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Mode privé — signalisation d'appel (WebRTC) via le canal chiffré 1:1.
 *
 * Les messages de signalisation (offer/answer/ICE/end) sont sérialisés avec un
 * marqueur dédié, puis transitent comme n'importe quel message privé chiffré
 * (ratchet). Le relais ne voit rien.
 *
 * Module PUR (codec) → testable.
 */

export const CALL_MARKER = '\u0000NPT-CALL:';

export type CallSignal =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit | null }
  | { kind: 'end' };

export function encodeCallSignal(signal: CallSignal): string {
  return CALL_MARKER + JSON.stringify(signal);
}

export function parseCallSignal(text: string): CallSignal | null {
  if (!text.startsWith(CALL_MARKER)) return null;
  try {
    const s = JSON.parse(text.slice(CALL_MARKER.length)) as CallSignal;
    if (s && typeof s.kind === 'string') return s;
    return null;
  } catch {
    return null;
  }
}

export function isCallSignal(text: string): boolean {
  return text.startsWith(CALL_MARKER);
}
