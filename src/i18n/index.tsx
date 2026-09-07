// Copyright (c) 2026 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// ============ I18N PROVIDER ============

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { translations, type Lang } from './translations';

export { LANGUAGES } from './translations';
export type { Lang } from './translations';

// French by default for JemaOS PWAs; the LanguageSelector is a
// session-only override (never persisted).
let currentLang: Lang = 'fr';

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
  const [lang, setLangState] = useState<Lang>('fr');

  // Keep the document language attribute and the static helper in sync.
  useEffect(() => {
    currentLang = lang;
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
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
