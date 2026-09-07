// Copyright (c) 2026 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { LANGUAGES, useI18n } from '@/i18n';

// Language selector dropdown (EN/FR toggle). Runtime override only:
// the JemaOS system language always wins on reload / languagechange.
export function LanguageSelector() {
  const { lang, setLang } = useI18n();
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (langCode: string) => {
    setLang(langCode as keyof typeof LANGUAGES);
    setIsOpen(false);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.language-selector')) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [isOpen]);

  const currentLangData = LANGUAGES[lang] || LANGUAGES.en;
  const otherLang = lang === 'en' ? 'fr' : 'en';

  return (
    <div
      className={`language-selector relative flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-lg border border-bg-hover bg-bg-surface hover:bg-bg-hover transition-colors ${isOpen ? 'open' : ''}`}
      onClick={() => setIsOpen(!isOpen)}
    >
      <span className="lang-icon text-text-secondary">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5"
        >
          <path d="M5 8l6 6M4 14h8M5.5 14l2-6h1l2 6" />
          <path d="M14 5h6M17 5v9M14 9h6" />
        </svg>
      </span>
      <span className="lang-text text-text-primary text-sm font-medium">
        {currentLangData.code}/{otherLang}
      </span>
      <ChevronDown size={14} className={`text-text-tertiary transition-transform ${isOpen ? 'rotate-180' : ''}`} />

      {isOpen && (
        <div className="language-dropdown absolute top-full left-0 mt-1 min-w-[10rem] bg-bg-surface border border-bg-hover rounded-lg shadow-lg z-50 overflow-hidden">
          {Object.values(LANGUAGES).map((language) => (
            <div
              key={language.code}
              className={`language-option px-3 py-2 text-sm cursor-pointer transition-colors ${
                lang === language.code
                  ? 'bg-primary-500/15 text-primary-500 font-medium'
                  : 'text-text-primary hover:bg-bg-hover'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                handleSelect(language.code);
              }}
            >
              <span>{language.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default LanguageSelector;
