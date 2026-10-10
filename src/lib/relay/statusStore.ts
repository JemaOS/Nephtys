// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Mode privé — STATUTS (type « stories »), chiffrés et éphémères (24 h).
 *
 * Un statut est un court texte diffusé à ses connexions privées via le canal
 * 1:1 chiffré existant. Il porte un marqueur dédié ; le récepteur le stocke
 * localement avec une **expiration (24 h)** et ne l'affiche que tant qu'il est
 * valide. Rien n'est conservé côté relais au-delà du transit.
 *
 * Module PUR (marqueur + filtrage) → testable ; store IndexedDB à part.
 */

export const STATUS_MARKER = '\u0000NPT-STATUS:';
export const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

export interface StatusRecord {
  id: string;
  /** connexion privée d'où provient le statut (ou 'moi' si publié) */
  conversationId: string;
  text: string;
  ts: number;
  expiresAt: number;
}

export interface StatusPayload {
  id: string;
  text: string;
  ts: number;
}

/** Encode un statut pour l'envoi sur le canal privé. */
export function encodeStatus(text: string, id = Math.random().toString(36).slice(2, 10)): string {
  const payload: StatusPayload = { id, text, ts: Date.now() };
  return STATUS_MARKER + JSON.stringify(payload);
}

export function parseStatus(text: string): StatusPayload | null {
  if (!text.startsWith(STATUS_MARKER)) return null;
  try {
    const p = JSON.parse(text.slice(STATUS_MARKER.length)) as StatusPayload;
    if (typeof p?.text !== 'string') return null;
    return p;
  } catch {
    return null;
  }
}

export function isExpired(status: StatusRecord, now = Date.now()): boolean {
  return status.expiresAt <= now;
}

/** Ne garde que les statuts non expirés, du plus récent au plus ancien. */
export function activeStatuses(list: StatusRecord[], now = Date.now()): StatusRecord[] {
  return list.filter(s => !isExpired(s, now)).sort((a, b) => b.ts - a.ts);
}

/** Construit un enregistrement local à partir d'un statut reçu. */
export function toRecord(payload: StatusPayload, conversationId: string, now = Date.now()): StatusRecord {
  return {
    id: payload.id,
    conversationId,
    text: payload.text,
    ts: payload.ts || now,
    expiresAt: (payload.ts || now) + STATUS_TTL_MS,
  };
}
