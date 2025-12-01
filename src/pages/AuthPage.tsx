import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { Lock, User, Shield, Zap, Eye } from 'lucide-react'

export function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'guest'>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  const { signIn, signUp, signInAsGuest } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (!username) {
        setError('Nom d\'utilisateur requis')
        setLoading(false)
        return
      }
      
      if (mode === 'guest') {
        await signInAsGuest(username)
      } else if (mode === 'signin') {
        await signIn(username, password)
      } else {
        await signUp(username, password)
      }
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen bg-bg-primary flex items-center justify-center p-4 overflow-hidden">
      <div className="w-full max-w-md space-y-4">
        {/* Logo & Title */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 mx-auto rounded-3xl bg-gradient-to-br from-[#7578db] to-[#6b6fdb] flex items-center justify-center shadow-2xl">
            <svg width="40" height="40" viewBox="0 0 60 60" fill="none">
              <path d="M 30 10 C 18 10 8 18 8 28 C 8 33 10 37 13 40 L 11 46 L 17 43 C 21 45 25 46 30 46 C 42 46 52 38 52 28 C 52 18 42 10 30 10 Z" 
                    fill="white" 
                    opacity="0.95"/>
              <text x="30" y="35" fontFamily="system-ui" fontSize="24" fontWeight="700" fill="#6b6fdb" textAnchor="middle">A</text>
            </svg>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-text-primary">Nephtys</h1>
            <p className="text-sm text-text-secondary">Messagerie sécurisée</p>
          </div>
        </div>

        {/* Features */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-bg-surface rounded-xl p-2.5 text-center">
            <Shield size={18} className="mx-auto mb-1 text-accent" />
            <div className="text-xs text-text-secondary">E2EE</div>
          </div>
          <div className="bg-bg-surface rounded-xl p-2.5 text-center">
            <Zap size={18} className="mx-auto mb-1 text-accent" />
            <div className="text-xs text-text-secondary">P2P</div>
          </div>
          <div className="bg-bg-surface rounded-xl p-2.5 text-center">
            <Eye size={18} className="mx-auto mb-1 text-accent" />
            <div className="text-xs text-text-secondary">NO-LOG</div>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="flex gap-2">
          <button
            onClick={() => setMode('signin')}
            className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors ${
              mode === 'signin' ? 'bg-accent text-white' : 'bg-bg-surface text-text-secondary'
            }`}
          >
            Connexion
          </button>
          <button
            onClick={() => setMode('signup')}
            className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors ${
              mode === 'signup' ? 'bg-accent text-white' : 'bg-bg-surface text-text-secondary'
            }`}
          >
            Inscription
          </button>
          <button
            onClick={() => setMode('guest')}
            className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors ${
              mode === 'guest' ? 'bg-accent text-white' : 'bg-bg-surface text-text-secondary'
            }`}
          >
            Éphémère
          </button>
        </div>

        {/* Auth Form */}
        <div className="bg-bg-surface rounded-3xl p-5 space-y-4">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-text-primary mb-1">
              {mode === 'guest' ? 'Mode éphémère' : mode === 'signin' ? 'Connexion' : 'Créer un compte'}
            </h2>
            <p className="text-xs text-text-secondary">
              {mode === 'guest' ? 'Session temporaire sans compte' : mode === 'signin' ? 'Accédez à vos conversations' : 'Rejoignez Nephtys'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs text-accent">Pseudo</label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  type="text"
                  placeholder="votre_pseudo"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full h-10 pl-9 pr-3 bg-bg-hover text-text-primary text-sm rounded-xl border-none outline-none placeholder:text-text-secondary focus:ring-2 focus:ring-[#6b6fdb]"
                  required
                />
              </div>
            </div>

            {mode !== 'guest' && (
              <div className="space-y-1.5">
                <label className="text-xs text-accent">Mot de passe</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-10 pl-9 pr-3 bg-bg-hover text-text-primary text-sm rounded-xl border-none outline-none placeholder:text-text-secondary focus:ring-2 focus:ring-[#6b6fdb]"
                    required
                  />
                </div>
              </div>
            )}
            
            {mode === 'guest' && (
              <div className="p-2 rounded-xl bg-[#ea4335]/10 border border-[#ea4335]/20">
                <p className="text-xs text-[#ea4335]">⚠️ Mode éphémère : Toutes les données seront perdues à la déconnexion</p>
              </div>
            )}

            {error && (
              <div className="p-2 rounded-xl bg-[#ea4335]/10 border border-[#ea4335]/20">
                <p className="text-xs text-[#ea4335]">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-xl bg-accent hover:bg-[#5a5ec9] text-white font-medium text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              ) : (
                mode === 'guest' ? 'Démarrer en mode éphémère' : mode === 'signin' ? 'Se connecter' : 'Créer le compte'
              )}
            </button>

          </form>
        </div>

        {/* Privacy Note */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2 text-text-secondary text-xs">
            <svg width="12" height="16" viewBox="0 0 16 20" fill="currentColor">
              <path d="M13 7h-1V5c0-2.21-1.79-4-4-4S4 2.79 4 5v2H3c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm-5 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H4.9V5c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
            <span>Chiffrement de bout en bout</span>
          </div>
          <p className="text-xs text-text-secondary">Aucun email requis</p>
        </div>
      </div>
    </div>
  )
}
