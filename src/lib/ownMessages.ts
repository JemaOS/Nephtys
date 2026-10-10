// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Registre LOCAL des messages que J'AI envoyés (par id).
 *
 * Nécessaire depuis le « sealed sender » : le serveur ne stocke plus
 * `sender_id` (il est NULL). Du coup `message.sender_id === moi` est FAUX pour
 * mes propres messages → ils s'affichaient du mauvais côté (« décalés »).
 * On mémorise donc localement les ids de mes envois, persistés en
 * localStorage (survit au rechargement).
 */

const KEY = 'nephtys_own_messages_v1';
const MAX = 2000;

let ownSet: Set<string> | null = null;

function load(): Set<string> {
  if (ownSet) return ownSet;
  ownSet = new Set<string>();
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(KEY);
      if (raw) for (const id of JSON.parse(raw) as string[]) ownSet.add(id);
    }
  } catch {
    // ignore
  }
  return ownSet;
}

function persist(): void {
  try {
    if (typeof localStorage === 'undefined' || !ownSet) return;
    const arr = [...ownSet];
    const trimmed = arr.length > MAX ? arr.slice(arr.length - MAX) : arr;
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
}

/** Marque un message comme « envoyé par moi ». */
export function markOwnMessage(id: string): void {
  if (!id) return;
  const s = load();
  if (!s.has(id)) {
    s.add(id);
    persist();
  }
}

/** Vrai si ce message a été envoyé par moi (même si sender_id est NULL). */
export function isOwnMessage(id: string): boolean {
  return load().has(id);
}