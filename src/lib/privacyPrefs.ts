// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Préférences de vie privée locales (jamais envoyées au serveur).
 */

const COVER_KEY = 'nephtys_cover_traffic';
const COVER_INTENSITY_KEY = 'nephtys_cover_traffic_intensity';

export type CoverTrafficIntensity = 'low' | 'normal' | 'high';

/**
 * Profil de couverture : bornes **temporelles** (jamais de période fixe) et
 * probabilité de **salve**. Les intervalles sont tirés aléatoirement dans
 * `[minIntervalMs, maxIntervalMs]` (le jitter est donc toujours présent).
 */
export interface CoverTrafficProfile {
  minIntervalMs: number;
  maxIntervalMs: number;
  /** Probabilité qu'un tick déclenche une salve de 2–3 messages. */
  burstProbability: number;
  /** Parmi les salves, probabilité d'en envoyer 3 (sinon 2). */
  tripleProbability: number;
}

/**
 * Bornes par intensité. Même à « low », l'intervalle reste aléatoire : aucune
 * cadence régulière ne doit être détectable côté relais.
 */
export const COVER_TRAFFIC_PROFILES: Record<CoverTrafficIntensity, CoverTrafficProfile> = {
  low: { minIntervalMs: 45_000, maxIntervalMs: 150_000, burstProbability: 0.06, tripleProbability: 0.30 },
  normal: { minIntervalMs: 20_000, maxIntervalMs: 90_000, burstProbability: 0.12, tripleProbability: 0.35 },
  high: { minIntervalMs: 8_000, maxIntervalMs: 40_000, burstProbability: 0.20, tripleProbability: 0.40 },
};

const DEFAULT_INTENSITY: CoverTrafficIntensity = 'normal';

/**
 * Trafic de couverture (brouillage timing/volume) : envoie périodiquement des
 * messages factices indiscernables des vrais portés par le relais.
 * **Activé par défaut.**
 */
export function isCoverTrafficEnabled(): boolean {
  try {
    const value = localStorage.getItem(COVER_KEY);
    return value === null ? true : value === '1';
  } catch {
    return true;
  }
}

export function setCoverTrafficEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(COVER_KEY, enabled ? '1' : '0');
  } catch {
    // localStorage indisponible
  }
}

function isCoverTrafficIntensity(value: unknown): value is CoverTrafficIntensity {
  return value === 'low' || value === 'normal' || value === 'high';
}

/** Intensité du trafic de couverture (`normal` par défaut). */
export function getCoverTrafficIntensity(): CoverTrafficIntensity {
  try {
    const value = localStorage.getItem(COVER_INTENSITY_KEY);
    return isCoverTrafficIntensity(value) ? value : DEFAULT_INTENSITY;
  } catch {
    return DEFAULT_INTENSITY;
  }
}

export function setCoverTrafficIntensity(intensity: CoverTrafficIntensity): void {
  try {
    localStorage.setItem(COVER_INTENSITY_KEY, intensity);
  } catch {
    // localStorage indisponible
  }
}
