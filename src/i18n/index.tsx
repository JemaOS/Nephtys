// Copyright (c) 2026 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// ============ I18N PROVIDER ============

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { translations, type Lang } from './translations';

export { LANGUAGES } from './translations';
export type { Lang } from './translations';

// Clé localStorage : la langue choisie est persistée et restaurée au reload.
const LANG_KEY = 'nephtys_lang';

/**
 * Langue par défaut : préférence persistée si présente, sinon détection via
 * `navigator.language` (anglais si le navigateur est en anglais, français
 * sinon).
 */
function detectDefaultLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === 'en' || stored === 'fr') return stored;
  } catch {
    // localStorage indisponible → détection navigateur.
  }
  try {
    const nav = (navigator.language || '').toLowerCase();
    if (nav.startsWith('en')) return 'en';
  } catch {
    // navigator indisponible → repli français.
  }
  return 'fr';
}

let currentLang: Lang = detectDefaultLang();

/** Locale BCP-47 correspondant à la langue courante (dates/heures). */
export function getLocale(): string {
  return currentLang === 'en' ? 'en-US' : 'fr-FR';
}

/** Langue courante (accès hors React). */
export function getCurrentLang(): Lang {
  return currentLang;
}

function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  let text = translations[lang][key] ?? translations.en[key] ?? key;
  if (params) {
    for (const [param, value] of Object.entries(params)) {
      text = text.split(`{${param}}`).join(String(value));
    }
  }
  return text;
}

// Static translation helper for non-hook contexts (class components).
// Reads the current app language at call time.
export function tStatic(key: string, params?: Record<string, string | number>): string {
  return translate(currentLang, key, params);
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

interface I18nProviderProps {
  readonly children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const [lang, setLangState] = useState<Lang>(() => detectDefaultLang());

  // Keep the document language attribute and the static helper in sync.
  useEffect(() => {
    currentLang = lang;
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    try {
      localStorage.setItem(LANG_KEY, newLang);
    } catch {
      // localStorage indisponible : la sélection reste valable en session.
    }
  };

  const t = (key: string, params?: Record<string, string | number>): string => {
    return translate(lang, key, params);
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}
