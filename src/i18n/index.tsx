// Copyright (c) 2026 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// ============ I18N PROVIDER ============

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { translations, type Lang } from './translations';

export { LANGUAGES } from './translations';
export type { Lang } from './translations';

// Detect the system language (JemaOS sets navigator.language).
export function getSystemLang(): Lang {
  const browserLang = navigator.language || (navigator as any).userLanguage || 'fr';
  const short = browserLang.split('-')[0].toLowerCase();
  return short === 'fr' ? 'fr' : 'en';
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
// Reads the current system language at call time.
export function tStatic(key: string, params?: Record<string, string | number>): string {
  return translate(getSystemLang(), key, params);
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
  const [lang, setLangState] = useState<Lang>(getSystemLang);

  // The system language always wins: follow the OS language on load and on
  // every `languagechange` event. The selector is a runtime override only.
  useEffect(() => {
    const handleLanguageChange = () => {
      setLangState(getSystemLang());
    };
    window.addEventListener('languagechange', handleLanguageChange);
    return () => window.removeEventListener('languagechange', handleLanguageChange);
  }, []);

  // Keep the document language attribute in sync.
  useEffect(() => {
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
