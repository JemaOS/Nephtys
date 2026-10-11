// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Préférences utilisateur locales persistantes (jamais envoyées au serveur).
 *
 * Avant, les interrupteurs de l'écran Réglages (notifications, sons,
 * vibration, aperçu, sonnerie, téléchargement auto…) étaient de simples
 * `useState` → remis aux valeurs par défaut à chaque reload. On centralise
 * ici leur lecture/écriture dans localStorage, et on les rend consommables
 * hors React (ex. `useNotifications`).
 */

import { useCallback, useState } from 'react';

const PREFIX = 'nephtys_pref_';

export type BoolPrefKey =
  | 'notifications_enabled'
  | 'sound_enabled'
  | 'vibration_enabled'
  | 'message_preview_enabled'
  | 'call_notifications_enabled'
  | 'ringtone_enabled'
  | 'call_vibration_enabled'
  | 'show_caller_name'
  | 'auto_download_wifi'
  | 'auto_download_mobile'
  | 'auto_download_photos'
  | 'auto_download_videos'
  | 'auto_download_files'
  | 'auto_download_audio';

const DEFAULTS: Record<BoolPrefKey, boolean> = {
  notifications_enabled: true,
  sound_enabled: true,
  vibration_enabled: true,
  message_preview_enabled: true,
  call_notifications_enabled: true,
  ringtone_enabled: true,
  call_vibration_enabled: true,
  show_caller_name: true,
  auto_download_wifi: true,
  auto_download_mobile: false,
  auto_download_photos: true,
  auto_download_videos: false,
  auto_download_files: true,
  auto_download_audio: true,
};

/** Valeur persistée d'une préférence booléenne (défaut si absente/indisponible). */
export function getPref(key: BoolPrefKey): boolean {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return DEFAULTS[key];
    return raw === '1';
  } catch {
    return DEFAULTS[key];
  }
}

/** Persiste une préférence booléenne. */
export function setPref(key: BoolPrefKey, value: boolean): void {
  try {
    localStorage.setItem(PREFIX + key, value ? '1' : '0');
  } catch {
    // localStorage indisponible : la préférence reste en mémoire de session.
  }
}

/**
 * Hook React : préférence booléenne persistée. Initialise depuis localStorage,
 * écrit à chaque changement.
 */
export function usePersistentPref(key: BoolPrefKey): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => getPref(key));
  const set = useCallback((next: boolean) => {
    setPref(key, next);
    setValue(next);
  }, [key]);
  return [value, set];
}

// ─── Accès rapides hors React (notifications) ─────────────────────────

export const areNotificationsEnabled = (): boolean => getPref('notifications_enabled');
export const isSoundEnabled = (): boolean => getPref('sound_enabled');
export const isVibrationEnabled = (): boolean => getPref('vibration_enabled');
export const isMessagePreviewEnabled = (): boolean => getPref('message_preview_enabled');

/** Téléchargement automatique autorisé pour un type de média donné. */
export const isAutoDownloadEnabled = (
  kind: 'photos' | 'videos' | 'files' | 'audio',
): boolean => getPref(`auto_download_${kind}` as BoolPrefKey);
