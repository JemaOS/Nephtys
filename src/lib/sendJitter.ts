// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Jitter/batching à l'envoi : décale aléatoirement la diffusion RÉSEAU d'un
 * message pour casser la corrélation temporelle (« l'heure d'un message trahit
 * la conversation »). L'affichage optimiste reste instantané ; seul l'envoi
 * réseau est différé, de façon bornée (jamais au-delà de la borne configurée)
 * et désactivable (borne = 0).
 *
 * La préférence est locale (localStorage, jamais envoyée au serveur). Le module
 * est volontairement autonome : il ne dépend pas d'un fichier de préférences
 * partagé, afin que la configuration reste stable même si d'autres préférences
 * de vie privée évoluent en parallèle.
 */

const SEND_JITTER_KEY = 'nephtys_send_jitter';

/** Borne haute par défaut (ms) : latence raisonnable, jamais bloquante. */
export const DEFAULT_SEND_JITTER_MAX_MS = 1200;

/** Plafond dur : ne jamais retarder un envoi de plus de 2 s. */
export const MAX_SEND_JITTER_MAX_MS = 2000;

function clampMax(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_SEND_JITTER_MAX_MS;
  return Math.max(0, Math.min(Math.floor(ms), MAX_SEND_JITTER_MAX_MS));
}

/** Borne haute configurée en ms (`0` = jitter désactivé). */
export function getSendJitterMaxMs(): number {
  try {
    const raw = localStorage.getItem(SEND_JITTER_KEY);
    if (raw === null) return DEFAULT_SEND_JITTER_MAX_MS;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return DEFAULT_SEND_JITTER_MAX_MS;
    return clampMax(parsed);
  } catch {
    return DEFAULT_SEND_JITTER_MAX_MS;
  }
}

/** Persiste la borne haute (ms). `0` désactive le jitter. */
export function setSendJitterMaxMs(ms: number): void {
  try {
    localStorage.setItem(SEND_JITTER_KEY, String(clampMax(ms)));
  } catch {
    // localStorage indisponible
  }
}

export function isSendJitterEnabled(): boolean {
  return getSendJitterMaxMs() > 0;
}

/** Active/désactive le jitter (activé = borne par défaut, désactivé = 0). */
export function setSendJitterEnabled(enabled: boolean): void {
  setSendJitterMaxMs(enabled ? DEFAULT_SEND_JITTER_MAX_MS : 0);
}

/**
 * Délai de jitter courant en ms : tirage aléatoire uniforme dans
 * `[0, borne]` où la borne est la préférence persistée (`nephtys_send_jitter`).
 * Retourne `0` si la fonctionnalité est désactivée (borne = 0).
 */
export function getSendJitterMs(): number {
  const max = getSendJitterMaxMs();
  if (max <= 0) return 0;
  return Math.floor(Math.random() * (max + 1));
}

/**
 * Attend le délai de jitter. À appeler APRÈS l'affichage optimiste et AVANT
 * l'insertion réseau / la diffusion — jamais pour les mutations locales ni les
 * accusés de réception. Le délai est borné (max `MAX_SEND_JITTER_MAX_MS`) donc
 * l'envoi n'est jamais bloqué indéfiniment.
 */
export async function applySendJitter(): Promise<void> {
  const ms = getSendJitterMs();
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
