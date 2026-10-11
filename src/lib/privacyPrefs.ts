// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Préférences de vie privée locales (jamais envoyées au serveur).
 */

const COVER_KEY = 'nephtys_cover_traffic';

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
