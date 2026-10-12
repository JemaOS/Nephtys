// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Lock, User, Shield, Zap, EyeOff, X } from 'lucide-react'
import { useI18n } from '@/i18n'
import { SafeQrCode } from '@/components/SafeQrCode'
import { createLinkRequest, applyLinkResponse, type LinkRequest } from '@/lib/recovery/deviceLinkChannel'

// Type alias for auth mode
type AuthMode = 'signin' | 'signup' | 'guest'

// Styles CSS pour empêcher le navigateur de changer les couleurs en mode autofill
const autofillStyles = `
  /* Empêche le navigateur de changer la couleur de fond en autofill */
  input:-webkit-autofill,
  input:-webkit-autofill:hover,
  input:-webkit-autofill:focus,
  input:-webkit-autofill:active {
    -webkit-box-shadow: 0 0 0 1000px var(--bg-hover) inset !important;
    -webkit-text-fill-color: var(--text-primary) !important;
    caret-color: var(--text-primary) !important;
    transition: background-color 5000s ease-in-out 0s;
  }
  
  /* Firefox */
  input:-moz-autofill {
    background-color: var(--bg-hover) !important;
    color: var(--text-primary) !important;
  }
`

// Helper function to get auth title based on mode
const getAuthTitle = (mode: AuthMode, t: (key: string) => string): string => {
  if (mode === 'guest') return t('guestMode');
  if (mode === 'signin') return t('signInTitle');
  return t('signUpTitle');
}

// Helper function to get auth subtitle based on mode
const getAuthSubtitle = (mode: AuthMode, t: (key: string) => string): string => {
  if (mode === 'guest') return t('guestModeSubtitle');
  if (mode === 'signin') return t('signInSubtitle');
  return t('signUpSubtitle');
}

// Helper function to get auth button text based on mode
const getAuthButtonText = (mode: AuthMode, t: (key: string) => string): string => {
  if (mode === 'guest') return t('guestModeButton');
  if (mode === 'signin') return t('signInButton');
  return t('signUpButton');
}

export function AuthPage() {
  const { t, lang, setLang } = useI18n()
  const navigate = useNavigate()
  const [mode, setMode] = useState<AuthMode>('signin')
  const [linkReq, setLinkReq] = useState<LinkRequest | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)

  // Page de connexion = appareil NON connecté → on AFFICHE un QR, et on attend
  // que l'appareil déjà connecté le scanne pour transmettre la session + clés.
  const startLinking = async () => {
    setLinkError(null)
    try {
      setLinkReq(await createLinkRequest())
    } catch (e) {
      setLinkError((e as Error).message)
    }
  }

  useEffect(() => {
    if (!linkReq) return
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const res = await linkReq.poll()
        if (!res || cancelled) return
        cancelled = true
        clearInterval(timer)
        setLinking(true)
        await applyLinkResponse(res)
        navigate('/chats')
      } catch {
        /* on réessaiera */
      }
    }, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [linkReq, navigate])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  const { signIn, signUp, signInAsGuest } = useAuth()

  // Validation côté client : aligné sur les règles de l'edge function
  // pour fournir un retour immédiat et ne pas consommer le rate-limiter inutilement.
  const validateForm = (): string | null => {
    const u = username.trim()
    if (!u) return t('usernameRequired')
    if (u.length < 3 || u.length > 20) {
      return t('usernameLengthError')
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(u)) {
      return t('usernameCharsError')
    }
    if (mode !== 'guest') {
      if (password.length < 1) return t('passwordRequired')
      if (password.length > 128) return t('passwordTooLong')
      // Min 8 caractères uniquement à l'inscription (rétrocompat anciens comptes)
      if (mode === 'signup' && password.length < 8) {
        return t('passwordMinLength')
      }
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    try {
      if (mode === 'guest') {
        await signInAsGuest(username.trim())
      } else if (mode === 'signin') {
        await signIn(username.trim(), password)
      } else {
        await signUp(username.trim(), password)
      }
    } catch (err: any) {
      setError(err.message || t('errorOccurred'))
    } finally {
      setLoading(false)
    }
  }

  // Écran DÉDIÉ de liaison (opaque, dans le thème de l'app) — pas de superposition.
  if (linkReq) {
    return (
      <div className="h-screen-safe bg-bg-primary flex flex-col items-center justify-center p-6 gap-5 overflow-auto">
        <button
          type="button"
          onClick={() => setLinkReq(null)}
          className="absolute top-3 right-3 p-2 rounded-lg bg-bg-surface text-text-primary"
          aria-label="Fermer"
        >
          <X size={18} />
        </button>
        <div className="flex flex-col items-center gap-1">
          <img src="/icon.svg" alt="Nephtys" className="w-11 h-11 rounded-2xl" />
          <h1 className="text-lg font-bold text-text-primary">Nephtys</h1>
        </div>
        <h2 className="text-base font-semibold text-text-primary text-center">Liez votre appareil</h2>
        <ol className="text-sm text-text-secondary space-y-1.5 max-w-sm list-decimal list-inside">
          <li>Ouvrez Nephtys sur votre <b className="text-text-primary">autre appareil</b> (déjà connecté).</li>
          <li>Paramètres → <b className="text-text-primary">Code QR</b> → <b className="text-text-primary">Scanner le code</b>.</li>
          <li>Scannez ce code QR.</li>
        </ol>
        <div className="bg-white p-4 rounded-2xl shadow-lg">
          <SafeQrCode value={linkReq.payload} size={220} />
        </div>
        <p className="text-xs text-text-secondary text-center">
          {linking ? 'Connexion en cours…' : 'En attente du scan…'}
        </p>
        {linkError && <p className="text-xs text-amber-300 [.light_&]:text-amber-700 text-center max-w-xs">{linkError}</p>}
      </div>
    )
  }

  return (
    <div className="relative h-screen-safe bg-bg-primary flex items-center justify-center p-3 sm:p-4 overflow-hidden">
      {/* Sélecteur de langue (FR/EN) — haut à droite, dès la 1re page */}
      <div className="absolute top-3 right-3 z-10 flex gap-1 p-1 rounded-xl bg-bg-surface">
        {(['fr', 'en'] as const).map(l => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${lang === l ? 'bg-[#7578db] text-white' : 'text-text-secondary'}`}
            aria-label={l === 'fr' ? 'Français' : 'English'}
            aria-pressed={lang === l}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      {/* Injecte les styles CSS pour l'autofill */}
      <style>{autofillStyles}</style>

      <div className="w-full max-w-md lg:max-w-lg max-h-full overflow-y-auto space-y-1.5">
        {/* Logo & Title */}
        <div className="text-center space-y-0.5 sm:space-y-1">
          {/* Logo officiel de l'app (public/icon.svg) — source unique, identique
              au favicon et à l'icône PWA, pastille de notification incluse. */}
          <img src="/icon.svg" alt="Nephtys" className="w-10 h-10 sm:w-11 sm:h-11 lg:w-11 lg:h-11 mx-auto rounded-2xl shadow-xl" />
          <div>
            <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-text-primary">Nephtys</h1>
            <p className="text-[10px] sm:text-xs text-text-secondary">{t('secureMessaging')}</p>
          </div>
        </div>

        {/* Features */}
        <div className="grid grid-cols-3 gap-2 lg:gap-3">
          <div className="bg-bg-surface rounded-xl p-2 lg:p-2.5 flex flex-col items-center justify-center gap-1 lg:gap-1.5">
            <Shield size={16} className="text-accent lg:w-[20px] lg:h-[20px]" />
            <span className="text-[9px] lg:text-[11px] font-bold text-text-secondary">E2EE</span>
          </div>
          <div className="bg-bg-surface rounded-xl p-2 lg:p-2.5 flex flex-col items-center justify-center gap-1 lg:gap-1.5">
            <Zap size={16} className="text-accent lg:w-[20px] lg:h-[20px]" />
            <span className="text-[9px] lg:text-[11px] font-bold text-text-secondary">P2P</span>
          </div>
          <div className="bg-bg-surface rounded-xl p-2 lg:p-2.5 flex flex-col items-center justify-center gap-1 lg:gap-1.5">
            <EyeOff size={16} className="text-accent lg:w-[20px] lg:h-[20px]" />
            <span className="text-[9px] lg:text-[11px] font-bold text-text-secondary">NO-LOG</span>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="flex gap-2">
          <button
            onClick={() => setMode('signin')}
            className={`flex-1 py-1.5 lg:py-2 rounded-xl text-xs lg:text-sm font-medium transition-colors ${
              mode === 'signin' ? 'bg-accent text-white' : 'bg-bg-surface text-text-secondary'
            }`}
          >
            {t('signInTitle')}
          </button>
          <button
            onClick={() => setMode('signup')}
            className={`flex-1 py-1.5 lg:py-2 rounded-xl text-xs lg:text-sm font-medium transition-colors ${
              mode === 'signup' ? 'bg-accent text-white' : 'bg-bg-surface text-text-secondary'
            }`}
          >
            {t('signUpShort')}
          </button>
          <button
            onClick={() => setMode('guest')}
            className={`flex-1 py-1.5 lg:py-2 rounded-xl text-xs lg:text-sm font-medium transition-colors ${
              mode === 'guest' ? 'bg-accent text-white' : 'bg-bg-surface text-text-secondary'
            }`}
          >
            {t('guestShort')}
          </button>
        </div>

        {/* Auth Form */}
        <div className="bg-bg-surface rounded-3xl p-3 sm:p-3.5 lg:p-3.5 space-y-1.5 sm:space-y-2 lg:space-y-2.5">
          <div className="text-center">
            <h2 className="text-sm sm:text-base lg:text-lg font-semibold text-text-primary mb-0.5">
              {getAuthTitle(mode, t)}
            </h2>
            <p className="text-[9px] sm:text-[10px] lg:text-xs text-text-secondary">
              {getAuthSubtitle(mode, t)}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-1.5">
            <div className="space-y-0.5 sm:space-y-1">
              <label htmlFor="username" className="text-[9px] sm:text-[10px] lg:text-xs text-text-secondary font-medium">{t('usernameShort')}</label>
              <div className="relative">
                <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary lg:w-[18px] lg:h-[18px]" />
                <input
                  id="username"
                  type="text"
                  placeholder={t('usernamePlaceholder')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full h-9 sm:h-10 lg:h-10 pl-9 lg:pl-10 pr-3 bg-bg-hover text-text-primary text-sm rounded-xl border border-bg-hover outline-none placeholder:text-text-secondary focus:ring-2 focus:ring-[#6b6fdb]"
                  required
                />
              </div>
            </div>

            {mode !== 'guest' && (
              <div className="space-y-0.5 sm:space-y-1">
                <label htmlFor="password" className="text-[9px] sm:text-[10px] lg:text-xs text-text-secondary font-medium">{t('passwordLabel')}</label>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary lg:w-[18px] lg:h-[18px]" />
                  <input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-9 sm:h-10 lg:h-10 pl-9 lg:pl-10 pr-3 bg-bg-hover text-text-primary text-sm rounded-xl border border-bg-hover outline-none placeholder:text-text-secondary focus:ring-2 focus:ring-[#6b6fdb]"
                    required
                  />
                </div>
              </div>
            )}
            
            {mode === 'guest' && (
              <div className="p-1.5 sm:p-2 lg:p-3 rounded-xl bg-[#ea4335]/10 border border-[#ea4335]/20">
                <p className="text-[9px] sm:text-[10px] lg:text-xs text-[#ea4335]">{t('guestModeWarning')}</p>
              </div>
            )}

            {error && (
              <div className="p-1.5 sm:p-2 lg:p-3 rounded-xl bg-[#ea4335]/10 border border-[#ea4335]/20">
                <p className="text-[9px] sm:text-[10px] lg:text-xs text-[#ea4335]">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-9 sm:h-10 lg:h-10 rounded-xl bg-accent hover:bg-[#5a5ec9] text-white font-medium text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              ) : (
                getAuthButtonText(mode, t)
              )}
            </button>

          </form>
        </div>

        {/* Privacy Note - Hidden on small screens */}
        <div className="hidden sm:block text-center space-y-0.5">
          <div className="flex items-center justify-center gap-2 text-text-secondary text-[10px] lg:text-xs">
            <svg width="10" height="14" viewBox="0 0 16 20" fill="currentColor">
              <path d="M13 7h-1V5c0-2.21-1.79-4-4-4S4 2.79 4 5v2H3c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm-5 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H4.9V5c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
            <span>{t('endToEndEncryption')}</span>
          </div>
          <p className="text-[10px] lg:text-xs text-text-secondary">{t('noEmailRequired')}</p>
        </div>

        {/* Mode privé anonyme — accessible sans compte */}
        <div className="text-center pt-1 space-y-1">
          <button
            type="button"
            onClick={() => navigate('/private')}
            className="text-[10px] lg:text-xs text-accent hover:underline block w-full"
          >
            Utiliser en mode privé (sans compte)
          </button>
          <button
            type="button"
            onClick={() => { setLinkError(null); void startLinking() }}
            className="text-[10px] lg:text-xs text-accent hover:underline block w-full"
          >
            Lier un nouvel appareil (QR)
          </button>
        </div>

        {/* Footer */}
        <div className="text-center pt-1 sm:pt-2">
          <p className="text-[9px] sm:text-[10px] lg:text-xs text-gray-500">
            {t('developedBy')} <a href="https://www.jematechnology.fr/" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Jema Technology</a> {t('footerLicense')}
          </p>
        </div>

        </div>
    </div>
  )
}
