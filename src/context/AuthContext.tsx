// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { createContext, useContext, useEffect, useState, useMemo, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase, Profile } from '@/lib/supabase'
import { initializePresence, cleanupPresence } from '@/hooks/usePresence'

// Timeout for auth operations (in milliseconds)
const AUTH_TIMEOUT = 5000;
const PROFILE_TIMEOUT = 3000;

// Local storage keys for offline support
const CACHED_USER_KEY = 'anu_cached_user';
const CACHED_PROFILE_KEY = 'anu_cached_profile';

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  isOffline: boolean
  signIn: (username: string, password: string) => Promise<void>
  signUp: (username: string, password: string) => Promise<void>
  signInAsGuest: (username: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Helper: Promise with timeout
function withTimeout<T>(promise: Promise<T> | PromiseLike<T>, ms: number, fallback?: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (fallback !== undefined) {
        resolve(fallback);
      } else {
        reject(new Error('Operation timed out'));
      }
    }, ms);

    Promise.resolve(promise)
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

// Helper: Get cached user from localStorage
function getCachedUser(): User | null {
  try {
    const cached = localStorage.getItem(CACHED_USER_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

// Helper: Get cached profile from localStorage
function getCachedProfile(): Profile | null {
  try {
    const cached = localStorage.getItem(CACHED_PROFILE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

// Helper: Cache user to localStorage
function cacheUser(user: User | null): void {
  try {
    if (user) {
      localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(CACHED_USER_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

// Helper: Cache profile to localStorage
function cacheProfile(profile: Profile | null): void {
  try {
    if (profile) {
      localStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(profile));
    } else {
      localStorage.removeItem(CACHED_PROFILE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

// Helper: Generate secure random string
const generateSecureRandomString = (length: number = 12): string => {
  const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  for (let i = 0; i < length; i++) {
    result += charset[values[i] % charset.length];
  }
  return result;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    // Get initial session with timeout and offline fallback
    const initAuth = async () => {
      // First, try to load cached data for immediate display
      const cachedUser = getCachedUser();
      const cachedProfile = getCachedProfile();
      
      if (cachedUser) {
        setUser(cachedUser);
        if (cachedProfile) {
          setProfile(cachedProfile);
        }
        // Don't block on loading if we have cached data
        setLoading(false);
      }

      // Then try to get fresh session from network
      try {
        const sessionPromise = supabase.auth.getSession();
        const { data: { session } } = await withTimeout(
          sessionPromise,
          AUTH_TIMEOUT,
          { data: { session: null } } as any
        );
        
        if (session?.user) {
          setUser(session.user);
          cacheUser(session.user);
          // Load profile in background, don't block
          loadProfile(session.user.id);
          // Initialize presence tracking
          initializePresence(session.user.id);
        } else if (!cachedUser) {
          // No session and no cache - check for ephemeral recovery
          const ephemeralUser = localStorage.getItem('anu_ephemeral_user');
          const ephemeralPassword = localStorage.getItem('anu_ephemeral_password');
          
          if (ephemeralUser && ephemeralPassword) {
            console.log('[Auth] Attempting to recover ephemeral session...');
            try {
              await signIn(ephemeralUser, ephemeralPassword);
              // signIn sets the user state, so we don't need to do it here
            } catch (err) {
              console.warn('[Auth] Ephemeral recovery failed:', err);
              setUser(null);
              setProfile(null);
            }
          } else {
            // No session, no cache, no ephemeral credentials
            setUser(null);
            setProfile(null);
          }
        }
      } catch (error) {
        console.warn('[Auth] Session fetch timed out or failed, using cached data');
        // Keep using cached data if available
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const newUser = session?.user ?? null;
      setUser(newUser);
      cacheUser(newUser);
      
      if (session?.user) {
        loadProfile(session.user.id);
        // Initialize presence tracking when user logs in
        initializePresence(session.user.id);
      } else {
        setProfile(null);
        cacheProfile(null);
        // Cleanup presence when user logs out
        cleanupPresence();
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
    try {
      const profilePromise = supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      const { data, error } = await withTimeout(
        Promise.resolve(profilePromise),
        PROFILE_TIMEOUT,
        { data: null, error: null } as any
      );

      if (!error && data) {
        setProfile(data);
        cacheProfile(data);
      }
    } catch (error) {
      console.warn('[Auth] Profile fetch timed out, using cached profile');
      // Keep using cached profile if available
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
      // Check if we can reuse an existing ephemeral account
      const storedUser = localStorage.getItem('anu_ephemeral_user');
      const storedPassword = localStorage.getItem('anu_ephemeral_password');
      const sanitizedInput = username.toLowerCase().replaceAll(/[^a-z0-9]/g, '') || 'user';
      
      // If we have stored credentials and the username prefix matches, try to reuse
      if (storedUser && storedPassword && storedUser.startsWith(sanitizedInput)) {
        console.log('[Auth] Found existing ephemeral credentials, attempting reuse...');
        try {
          await signIn(storedUser, storedPassword);
          console.log('[Auth] Successfully reused ephemeral account');
          return; // Success!
        } catch (err) {
          console.warn('[Auth] Failed to reuse ephemeral account, creating new one:', err);
          // Fall through to create new account
        }
      }

      // Créer un compte temporaire avec un email valide
      const timestamp = Date.now()
      const randomPassword = generateSecureRandomString(16) + '!A1'
      
      const uniqueUsername = `${sanitizedInput}${timestamp.toString(36)}`
      
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
      // CRITICAL: Store password to allow session recovery if token becomes invalid
      localStorage.setItem('anu_ephemeral_password', randomPassword)
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
        localStorage.removeItem('anu_ephemeral_user')
        localStorage.removeItem('anu_ephemeral_password')
      } catch (err) {
        console.error('Error cleaning ephemeral data:', err)
      }
    }
    
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  const value = useMemo(() => ({
    user,
    profile,
    loading,
    isOffline,
    signIn,
    signUp,
    signInAsGuest,
    signOut
  }), [user, profile, loading, isOffline]);

  return (
    <AuthContext.Provider value={value}>
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
