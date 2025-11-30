import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase, Profile } from '@/lib/supabase'

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  signIn: (username: string, password: string) => Promise<void>
  signUp: (username: string, password: string) => Promise<void>
  signInAsGuest: (username: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        loadProfile(session.user.id)
      }
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        loadProfile(session.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Subscribe to profile changes in real-time
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel('profile-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`
        },
        (payload) => {
          console.log('Profile updated:', payload)
          setProfile(payload.new as Profile)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  const loadProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (!error && data) {
      setProfile(data)
    }
  }

  const signIn = async (username: string, password: string) => {
    try {
      // Utiliser l'edge function pour connexion par pseudo
      const { data, error } = await supabase.functions.invoke('auth-with-username', {
        body: { action: 'signin', username, password }
      })

      if (error) {
        console.error('SignIn error:', error)
        throw new Error('❌ Identifiants incorrects\n\nVérifiez votre pseudo et mot de passe.')
      }
      
      if (data?.error) {
        console.error('SignIn data error:', data.error)
        const errorMsg = data.error.message || ''
        
        if (errorMsg.includes('Invalid login') || errorMsg.includes('Invalid credentials')) {
          throw new Error('❌ Identifiants incorrects\n\nLe pseudo ou le mot de passe est incorrect.')
        } else if (errorMsg.includes('User not found')) {
          throw new Error('❌ Compte introuvable\n\nCe pseudo n\'existe pas. Créez un compte d\'abord.')
        } else {
          throw new Error('❌ Erreur de connexion\n\nVeuillez réessayer dans quelques instants.')
        }
      }

      // Définir la session manuellement
      if (data?.data?.session) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.data.session.access_token,
          refresh_token: data.data.session.refresh_token
        })
        if (sessionError) {
          console.error('Session error:', sessionError)
          throw new Error('❌ Erreur de session\n\nImpossible de vous connecter.')
        }
      } else {
        throw new Error('❌ Erreur de connexion\n\nAucune session reçue.')
      }
    } catch (err: any) {
      // Si c'est déjà notre erreur formatée, la relancer
      if (err.message.startsWith('❌')) {
        throw err
      }
      // Sinon, formater l'erreur
      console.error('Unexpected signin error:', err)
      throw new Error('❌ Erreur de connexion\n\nVérifiez votre connexion internet et réessayez.')
    }
  }

  const signUp = async (username: string, password: string) => {
    try {
      // Utiliser l'edge function pour inscription par pseudo
      const { data, error } = await supabase.functions.invoke('auth-with-username', {
        body: { action: 'signup', username, password }
      })

      if (error) {
        console.error('SignUp error:', error)
        throw new Error('❌ Erreur d\'inscription\n\nImpossible de créer le compte.')
      }
      
      if (data?.error) {
        console.error('SignUp data error:', data.error)
        const errorMsg = data.error.message || ''
        
        if (errorMsg.includes('already exists') || errorMsg.includes('duplicate')) {
          throw new Error('❌ Pseudo déjà utilisé\n\nCe pseudo existe déjà. Choisissez-en un autre.')
        } else if (errorMsg.includes('password')) {
          throw new Error('❌ Mot de passe invalide\n\nLe mot de passe doit contenir au moins 6 caractères.')
        } else {
          throw new Error('❌ Erreur d\'inscription\n\nVeuillez réessayer.')
        }
      }

      // Définir la session manuellement
      if (data?.data?.session) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.data.session.access_token,
          refresh_token: data.data.session.refresh_token
        })
        if (sessionError) {
          console.error('Session error:', sessionError)
          throw new Error('❌ Erreur de session\n\nCompte créé mais impossible de vous connecter.')
        }
      } else {
        throw new Error('❌ Erreur d\'inscription\n\nAucune session reçue.')
      }
    } catch (err: any) {
      // Si c'est déjà notre erreur formatée, la relancer
      if (err.message.startsWith('❌')) {
        throw err
      }
      // Sinon, formater l'erreur
      console.error('Unexpected signup error:', err)
      throw new Error('❌ Erreur d\'inscription\n\nVérifiez votre connexion internet et réessayez.')
    }
  }

  const signInAsGuest = async (username: string) => {
    try {
      // Créer un compte temporaire avec un email valide
      const timestamp = Date.now()
      const randomId = Math.random().toString(36).substring(2, 8)
      const randomPassword = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2) + '!A1'
      
      const uniqueUsername = `${username.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user'}${timestamp.toString(36)}`
      
      // Créer le compte temporaire via l'edge function
      const { data, error } = await supabase.functions.invoke('auth-with-username', {
        body: {
          action: 'signup',
          username: uniqueUsername,
          password: randomPassword,
          display_name: username,
          is_ephemeral: true
        }
      })

      if (error) {
        console.error('Guest signup error:', error)
        throw new Error('❌ Mode éphémère indisponible\n\nVeuillez réessayer ou créer un compte permanent.')
      }
      
      if (data?.error) {
        console.error('Guest signup data error:', data.error)
        throw new Error('❌ Erreur de création\n\nImpossible de démarrer en mode éphémère.')
      }

      // Définir la session
      if (data?.data?.session) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.data.session.access_token,
          refresh_token: data.data.session.refresh_token
        })
        if (sessionError) {
          console.error('Session error:', sessionError)
          throw new Error('❌ Erreur de session\n\nImpossible de démarrer la session éphémère.')
        }
      } else {
        throw new Error('❌ Erreur de création\n\nAucune session reçue.')
      }

      // Stocker en local que c'est un mode éphémère
      localStorage.setItem('anu_ephemeral_mode', 'true')
      localStorage.setItem('anu_ephemeral_user', uniqueUsername)
    } catch (err: any) {
      // Si c'est déjà notre erreur formatée, la relancer
      if (err.message.startsWith('❌')) {
        throw err
      }
      // Sinon, formater l'erreur
      console.error('Unexpected guest error:', err)
      throw new Error('❌ Mode éphémère indisponible\n\nVérifiez votre connexion internet.')
    }
  }

  const signOut = async () => {
    // Si mode éphémère, supprimer toutes les données
    const isEphemeral = localStorage.getItem('anu_ephemeral_mode') === 'true'
    
    if (isEphemeral && user) {
      try {
        // Supprimer toutes les conversations de l'utilisateur
        await supabase.from('conversation_members').delete().eq('user_id', user.id)
        
        // Supprimer tous les messages
        await supabase.from('messages').delete().eq('sender_id', user.id)
        
        // Supprimer tous les contacts
        await supabase.from('contacts').delete().eq('user_id', user.id)
        
        // Supprimer le profil
        await supabase.from('profiles').delete().eq('id', user.id)
        
        // Nettoyer le localStorage
        localStorage.removeItem('anu_ephemeral_mode')
        localStorage.removeItem('anu_ephemeral_email')
      } catch (err) {
        console.error('Error cleaning ephemeral data:', err)
      }
    }
    
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signUp, signInAsGuest, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
