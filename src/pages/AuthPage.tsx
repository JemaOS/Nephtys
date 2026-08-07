// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { Lock, User, Shield, Zap, EyeOff } from 'lucide-react'

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
const getAuthTitle = (mode: AuthMode): string => {
  if (mode === 'guest') return 'Mode éphémère';
  if (mode === 'signin') return 'Connexion';
  return 'Créer un compte';
}

// Helper function to get auth subtitle based on mode
const getAuthSubtitle = (mode: AuthMode): string => {
  if (mode === 'guest') return 'Session temporaire sans compte';
  if (mode === 'signin') return 'Accédez à vos conversations';
  return 'Rejoignez Nephtys';
}

// Helper function to get auth button text based on mode
const getAuthButtonText = (mode: AuthMode): string => {
  if (mode === 'guest') return 'Démarrer en mode éphémère';
  if (mode === 'signin') return 'Se connecter';
  return 'Créer le compte';
}

export function AuthPage() {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  const { signIn, signUp, signInAsGuest } = useAuth()

  // Validation côté client : aligné sur les règles de l'edge function
  // pour fournir un retour immédiat et ne pas consommer le rate-limiter inutilement.
  const validateForm = (): string | null => {
    const u = username.trim()
    if (!u) return 'Nom d\'utilisateur requis'
    if (u.length < 3 || u.length > 20) {
      return 'Le pseudo doit faire entre 3 et 20 caractères'
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(u)) {
      return 'Le pseudo ne peut contenir que des lettres, chiffres, _ et -'
    }
    if (mode !== 'guest') {
      if (password.length < 1) return 'Mot de passe requis'
      if (password.length > 128) return 'Le mot de passe est trop long (max 128)'
      // Min 8 caractères uniquement à l'inscription (rétrocompat anciens comptes)
      if (mode === 'signup' && password.length < 8) {
        return 'Le mot de passe doit faire au moins 8 caractères'
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
      setError(err.message || 'Une erreur est survenue')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen bg-bg-primary flex items-center justify-center p-4 overflow-hidden">
      {/* Injecte les styles CSS pour l'autofill */}
      <style>{autofillStyles}</style>
      
      <div className="w-full max-w-md lg:max-w-lg xl:max-w-xl space-y-1 sm:space-y-2 lg:space-y-4">
        {/* Logo & Title */}
        <div className="text-center space-y-0.5 sm:space-y-1">
          {/* Logo officiel de l'app (public/icon.svg) — source unique, identique
              au favicon et à l'icône PWA, pastille de notification incluse. */}
          <img src="/icon.svg" alt="Nephtys" className="w-10 h-10 sm:w-12 sm:h-12 lg:w-16 lg:h-16 mx-auto rounded-2xl shadow-xl" />
          <div>
            <h1 className="text-lg sm:text-xl lg:text-3xl font-bold text-text-primary">Nephtys</h1>
            <p className="text-[10px] sm:text-xs lg:text-sm text-text-secondary">Messagerie sécurisée</p>
          </div>
        </div>

        {/* Features */}
        <div className="grid grid-cols-3 gap-2 lg:gap-3">
          <div className="bg-bg-surface rounded-xl p-2 lg:p-3 flex flex-col items-center justify-center gap-1 lg:gap-2">
            <Shield size={16} className="text-accent lg:w-[22px] lg:h-[22px]" />
            <span className="text-[9px] lg:text-xs font-bold text-text-secondary">E2EE</span>
          </div>
          <div className="bg-bg-surface rounded-xl p-2 lg:p-3 flex flex-col items-center justify-center gap-1 lg:gap-2">
            <Zap size={16} className="text-accent lg:w-[22px] lg:h-[22px]" />
            <span className="text-[9px] lg:text-xs font-bold text-text-secondary">P2P</span>
          </div>
          <div className="bg-bg-surface rounded-xl p-2 lg:p-3 flex flex-col items-center justify-center gap-1 lg:gap-2">
            <EyeOff size={16} className="text-accent lg:w-[22px] lg:h-[22px]" />
            <span className="text-[9px] lg:text-xs font-bold text-text-secondary">NO-LOG</span>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="flex gap-2">
          <button
            onClick={() => setMode('signin')}
            className={`flex-1 py-1.5 lg:py-2.5 rounded-xl text-xs lg:text-sm font-medium transition-colors ${
              mode === 'signin' ? 'bg-accent text-white' : 'bg-bg-surface text-text-secondary'
            }`}
          >
            Connexion
          </button>
          <button
            onClick={() => setMode('signup')}
            className={`flex-1 py-1.5 lg:py-2.5 rounded-xl text-xs lg:text-sm font-medium transition-colors ${
              mode === 'signup' ? 'bg-accent text-white' : 'bg-bg-surface text-text-secondary'
            }`}
          >
            Inscription
          </button>
          <button
            onClick={() => setMode('guest')}
            className={`flex-1 py-1.5 lg:py-2.5 rounded-xl text-xs lg:text-sm font-medium transition-colors ${
              mode === 'guest' ? 'bg-accent text-white' : 'bg-bg-surface text-text-secondary'
            }`}
          >
            Éphémère
          </button>
        </div>

        {/* Auth Form */}
        <div className="bg-bg-surface rounded-3xl p-3 sm:p-4 lg:p-7 space-y-2 sm:space-y-3 lg:space-y-5">
          <div className="text-center">
            <h2 className="text-sm sm:text-base lg:text-xl font-semibold text-text-primary mb-0.5">
              {getAuthTitle(mode)}
            </h2>
            <p className="text-[9px] sm:text-[10px] lg:text-xs text-text-secondary">
              {getAuthSubtitle(mode)}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-1.5 sm:space-y-2 lg:space-y-4">
            <div className="space-y-0.5 sm:space-y-1">
              <label htmlFor="username" className="text-[9px] sm:text-[10px] lg:text-xs text-text-secondary font-medium">Pseudo</label>
              <div className="relative">
                <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary lg:w-[18px] lg:h-[18px]" />
                <input
                  id="username"
                  type="text"
                  placeholder="votre_pseudo"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full h-8 sm:h-9 lg:h-11 pl-9 lg:pl-10 pr-3 bg-bg-hover text-text-primary text-sm lg:text-base rounded-xl border border-bg-hover outline-none placeholder:text-text-secondary focus:ring-2 focus:ring-[#6b6fdb]"
                  required
                />
              </div>
            </div>

            {mode !== 'guest' && (
              <div className="space-y-0.5 sm:space-y-1">
                <label htmlFor="password" className="text-[9px] sm:text-[10px] lg:text-xs text-text-secondary font-medium">Mot de passe</label>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary lg:w-[18px] lg:h-[18px]" />
                  <input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-8 sm:h-9 lg:h-11 pl-9 lg:pl-10 pr-3 bg-bg-hover text-text-primary text-sm lg:text-base rounded-xl border border-bg-hover outline-none placeholder:text-text-secondary focus:ring-2 focus:ring-[#6b6fdb]"
                    required
                  />
                </div>
              </div>
            )}
            
            {mode === 'guest' && (
              <div className="p-1.5 sm:p-2 lg:p-3 rounded-xl bg-[#ea4335]/10 border border-[#ea4335]/20">
                <p className="text-[9px] sm:text-[10px] lg:text-xs text-[#ea4335]">⚠️ Mode éphémère : Toutes les données seront perdues à la déconnexion</p>
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
              className="w-full h-8 sm:h-9 lg:h-11 rounded-xl bg-accent hover:bg-[#5a5ec9] text-white font-medium text-sm lg:text-base transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              ) : (
                getAuthButtonText(mode)
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
            <span>Chiffrement de bout en bout</span>
          </div>
          <p className="text-[10px] lg:text-xs text-text-secondary">Aucun email requis</p>
        </div>

        {/* Footer */}
        <div className="text-center pt-1 sm:pt-2">
          <p className="text-[9px] sm:text-[10px] lg:text-xs text-gray-500">
            Développé par <a href="https://www.jematechnology.fr/" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Jema Technology</a> © 2025 • Open Source & sous licence AGPL
          </p>
        </div>
      </div>
    </div>
  )
}
