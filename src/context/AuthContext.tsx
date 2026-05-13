// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { createContext, useContext, useEffect, useState, useMemo, ReactNode } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase, Profile } from '@/lib/supabase'
import { initializePresence, cleanupPresence } from '@/hooks/usePresence'
import { resolveMediaUrl } from '@/lib/mediaUrl'
import { initKeyPairOnSignin, initKeyPairOnSignup } from '@/lib/mediaEncryption'

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
  /** Met à jour le profil local immédiatement (sans attendre Realtime) */
  updateLocalProfile: (patch: Partial<Profile>) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/**
 * Extrait l'erreur structurée renvoyée par l'edge function `auth-with-username`.
 * - Sur succès HTTP 2xx avec body `{ error: {...} }` → lit `data.error`.
 * - Sur erreur HTTP (4xx/5xx via FunctionsHttpError) → tente de parser
 *   le body via `error.context.json()` (compatible @supabase/functions-js récent).
 *   Renvoie un fallback synthétique si le parsing échoue.
 */
async function extractFunctionError(
  error: any,
  data: any
): Promise<{ code: string; message: string } | null> {
  if (data?.error?.code) {
    return { code: data.error.code, message: data.error.message ?? '' }
  }
  if (!error) return null

  // Cas FunctionsHttpError → contient context (Response)
  const ctx = error.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const parsed = await ctx.json()
      if (parsed?.error?.code) {
        return { code: parsed.error.code, message: parsed.error.message ?? '' }
      }
    } catch {
      // body non JSON → fallback ci-dessous
    }
  }
  // Fallback générique
  return { code: 'UNKNOWN', message: error.message ?? 'Erreur réseau' }
}

// Helper: Promise with timeout
function withTimeout<T>(promise: Promise<T> | PromiseLike<T>, ms: number, fallback?: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (fallback === undefined) {
        reject(new Error('Operation timed out'));
      } else {
        resolve(fallback);
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

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)


  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    
    globalThis.addEventListener('online', handleOnline);
    globalThis.addEventListener('offline', handleOffline);
    
    return () => {
      globalThis.removeEventListener('online', handleOnline);
      globalThis.removeEventListener('offline', handleOffline);
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
        // Session fetch failed - use cached data if available
        console.warn('[Auth] Session fetch timed out or failed, using cached data', error);
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
        // Signer l'avatar (bucket privé)
        if (data.avatar_url) {
          data.avatar_url = (await resolveMediaUrl(data.avatar_url)) ?? data.avatar_url;
        }
        setProfile(data);
        cacheProfile(data);

        // La clé E2EE est initialisée au moment du signin/signup (où on a
        // le password). Ici on ne peut plus rien faire sans le password.
      }
    } catch (error) {
      // Profile fetch failed - use cached profile if available
      console.warn('[Auth] Profile fetch timed out, using cached profile', error);
      // Keep using cached profile if available
    }
  }

  const signIn = async (username: string, password: string) => {
    try {
      // Utiliser l'edge function pour connexion par pseudo
      const { data, error } = await supabase.functions.invoke('auth-with-username', {
        body: { action: 'signin', username, password }
      })

      // Tenter de récupérer l'erreur structurée renvoyée par l'edge function,
      // que ce soit dans `data` (200) ou dans `error.context` (4xx/5xx).
      const fnError = await extractFunctionError(error, data)
      if (fnError) {
        if (fnError.code === 'RATE_LIMITED') {
          throw new Error(`❌ Trop de tentatives\n\n${fnError.message}`)
        }
        if (fnError.code === 'VALIDATION_ERROR') {
          throw new Error(`❌ Saisie invalide\n\n${fnError.message}`)
        }
        const errorMsg = fnError.message || ''
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
        // Restaurer (ou créer) la clé E2EE silencieusement avec le password
        const userId = data.data.session.user?.id
        if (userId) {
          initKeyPairOnSignin(userId, password)
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

      const fnError = await extractFunctionError(error, data)
      if (fnError) {
        if (fnError.code === 'RATE_LIMITED') {
          throw new Error(`❌ Trop d'inscriptions\n\n${fnError.message}`)
        }
        if (fnError.code === 'VALIDATION_ERROR') {
          throw new Error(`❌ Saisie invalide\n\n${fnError.message}`)
        }
        const errorMsg = fnError.message || ''
        if (errorMsg.includes('already exists') || errorMsg.includes('duplicate')) {
          throw new Error('❌ Pseudo déjà utilisé\n\nCe pseudo existe déjà. Choisissez-en un autre.')
        } else if (errorMsg.includes('password')) {
          throw new Error('❌ Mot de passe invalide\n\nLe mot de passe doit contenir au moins 8 caractères.')
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
        // Générer + chiffrer + publier la paire E2EE avec le password
        const userId = data.data.session.user?.id
        if (userId) {
          initKeyPairOnSignup(userId, password)
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

      const fnError = await extractFunctionError(error, data)
      if (fnError) {
        if (fnError.code === 'RATE_LIMITED') {
          throw new Error(`❌ Trop de créations\n\n${fnError.message}`)
        }
        if (fnError.code === 'VALIDATION_ERROR') {
          throw new Error(`❌ Saisie invalide\n\n${fnError.message}`)
        }
        console.error('Guest signup error:', fnError)
        throw new Error('❌ Mode éphémère indisponible\n\nVeuillez réessayer ou créer un compte permanent.')
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

  const updateLocalProfile = (patch: Partial<Profile>) => {
    setProfile(prev => {
      if (!prev) return prev
      const updated = { ...prev, ...patch }
      cacheProfile(updated)
      return updated
    })
  }

  const value = useMemo(() => ({
    user,
    profile,
    loading,
    isOffline,
    signIn,
    signUp,
    signInAsGuest,
    signOut,
    updateLocalProfile,
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
