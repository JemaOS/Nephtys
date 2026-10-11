// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Préférence de proxy SOCKS (façon SimpleX).
 *
 * ⚠️ Limitation navigateur : une page web ne peut PAS imposer de proxy SOCKS
 * à ses propres connexions (pas de socket brut, pas d'accès au proxy du
 * navigateur depuis le JS). Cette préférence est donc **stockée** et affichée,
 * mais **non appliquée** par la version web. Elle est destinée aux futures
 * versions natives (ou à un pont). Côté web, l'équivalent fonctionnel est le
 * routage **Tor** (passerelle WASM).
 */

const ENABLED_KEY = 'nephtys_socks_enabled';
const URL_KEY = 'nephtys_socks_proxy';

export const SOCKS_BROWSER_NOTE =
  "Un proxy SOCKS n'est pas appliqué par les navigateurs (limitation web). Réservé aux futures versions natives.";

export function isSocksEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSocksEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(ENABLED_KEY, '1');
    else localStorage.removeItem(ENABLED_KEY);
  } catch {
    // localStorage indisponible
  }
}

export function getSocksProxy(): string {
  try {
    return localStorage.getItem(URL_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setSocksProxy(url: string): void {
  try {
    const value = url.trim();
    if (value) localStorage.setItem(URL_KEY, value);
    else localStorage.removeItem(URL_KEY);
  } catch {
    // localStorage indisponible
  }
}
