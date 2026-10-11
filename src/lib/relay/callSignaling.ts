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

/**
 * Métadonnées anti-rejeu/horodatage jointes à chaque signal. `callId` rattache
 * le signal à UN appel précis et `seq` est monotone par appel → un `end`/`ice`/
 * `answer` rejoué (même seq) ou un signal d'un autre appel est rejeté côté
 * contrôleur (`PrivateCall.handleSignal`).
 */
export interface CallSignalMeta {
  callId?: string;
  seq?: number;
  ts?: number;
}

export type ParsedCallSignal = CallSignal & CallSignalMeta;

export function encodeCallSignal(signal: CallSignal, meta?: CallSignalMeta): string {
  const payload = meta ? { ...signal, ...meta } : signal;
  return CALL_MARKER + JSON.stringify(payload);
}

export function parseCallSignal(text: string): ParsedCallSignal | null {
  if (!text.startsWith(CALL_MARKER)) return null;
  try {
    const s = JSON.parse(text.slice(CALL_MARKER.length)) as ParsedCallSignal;
    if (s && typeof s.kind === 'string') return s;
    return null;
  } catch {
    return null;
  }
}

export function isCallSignal(text: string): boolean {
  return text.startsWith(CALL_MARKER);
}
