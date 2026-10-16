// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { createContext, useContext, useEffect, useState, useMemo, useRef, useCallback, ReactNode } from 'react'
import { tStatic } from '@/i18n';
import { User } from '@supabase/supabase-js'
import { supabase, Profile } from '@/lib/supabase'
import { initializePresence, cleanupPresence } from '@/hooks/usePresence'
import { resolveMediaUrl } from '@/lib/mediaUrl'
import { deleteMyMessages, hideAllMessagesForUser } from '@/lib/conversationService'
import { setupRecoveryKeys, installKeysFromPhrase, hasLocalKeys, regenerateRecoveryKeys, verifyCurrentPhrase, checkPhraseMatchesAccount, resetRecoveryKeysWithoutPhrase } from '@/lib/recovery/recoveryService'
import { getMFAChallenge, verifyMFAChallenge } from '@/lib/twoFactorAuth'
import { clearLocalRatchetKeys } from '@/lib/ratchet/keyStore'
import { clearUserSessions } from '@/lib/ratchet/sessionStore'
import { offlineStorage } from '@/lib/offlineStorage'

// Timeout for auth operations (in milliseconds)
const AUTH_TIMEOUT = 5000;
const PROFILE_TIMEOUT = 3000;

// Nombre maximal de tentatives de code 2FA au login (côté client), avant de
// refuser toute vérification supplémentaire (l'utilisateur doit se reconnecter).
const MAX_MFA_ATTEMPTS = 5;

/**
 * État du gate 2FA au login. Tant qu'il est non-null, l'app n'est pas
 * accessible (App.tsx → MfaGate).
 * - `challenge`   : un code doit être saisi (facteur vérifié + challenge créé).
 * - `unavailable` : on ne peut PAS vérifier le niveau d'assurance 2FA
 *                   (erreur réseau, API MFA indisponible…). C'est un état
 *                   FAIL-CLOSED : l'app reste bloquée derrière un écran
 *                   « Réessayer / Annuler » — jamais d'accès silencieux.
 */
export type MfaPendingState =
  | { status: 'challenge'; factorId: string; challengeId: string }
  | { status: 'unavailable' };

/**
 * Résout le gate 2FA après `setSession` (fail-closed).
 *
 * 1. `getMFAChallenge()` renvoie un statut explicite.
 * 2. `ok` → aucun gate (session sûre).
 * 3. `challenge` → gate avec saisie du code. Couvre AUSSI le filet de sécurité
 *    « facteur 2FA vérifié MAIS session en aal1 » (détecté dans
 *    `getMFAChallenge` via `listFactors`, même si `nextLevel` est périmé) :
 *    on force le gate plutôt que d'afficher une app vide (RLS aal2 → 0 ligne).
 * 4. `unavailable` → on ne conclut JAMAIS « pas de 2FA » : on distingue via
 *    `listFactors()` :
 *      - Aucun facteur vérifié → l'utilisateur n'a pas de 2FA → on le laisse
 *        entrer (ne pas bloquer les comptes sans 2FA).
 *      - Facteurs vérifiés confirmés → on retente une fois d'obtenir un
 *        challenge (erreur transitoire). Si ça échoue encore, on maintient le
 *        gate « unavailable » (Réessayer / Annuler) au lieu de refuser
 *        brutalement la session : fail-closed ET utilisable.
 *      - `listFactors()` échoue aussi (indéterminable) → gate « unavailable ».
 */
async function resolveMfaGate(): Promise<MfaPendingState | null> {
  const mfa = await getMFAChallenge()

  if (mfa.status === 'challenge' && mfa.factorId && mfa.challengeId) {
    return { status: 'challenge', factorId: mfa.factorId, challengeId: mfa.challengeId }
  }
  if (mfa.status === 'ok') {
    // Vérifié : aucune vérification supplémentaire requise.
    return null
  }

  // status === 'unavailable' → on ne peut pas conclure « pas de 2FA ».
  try {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) {
      // Facteurs indéterminables → fail-closed (gate, pas d'accès).
      console.warn('[Auth] MFA listFactors failed while AAL unavailable:', error)
      return { status: 'unavailable' }
    }
    const hasVerified = (data?.totp || []).some((f: any) => f.status === 'verified')
    if (!hasVerified) {
      // Confirmé : pas de 2FA vérifié → autoriser (ne pas bloquer sans 2FA).
      return null
    }
    // 2FA confirmé mais AAL illisible : on retente une fois un challenge.
    const retry = await getMFAChallenge()
    if (retry.status === 'challenge' && retry.factorId && retry.challengeId) {
      return { status: 'challenge', factorId: retry.factorId, challengeId: retry.challengeId }
    }
    // 2FA confirmé et non vérifiable → gate « unavailable » (fail-closed).
    return { status: 'unavailable' }
  } catch (err) {
    console.warn('[Auth] MFA fail-closed resolution error:', err)
    return { status: 'unavailable' }
  }
}

// Local storage keys for offline support
const CACHED_USER_KEY = 'anu_cached_user';
const CACHED_PROFILE_KEY = 'anu_cached_profile';

interface AuthContextType {
  user: User | null
  profile: Profile | null
  loading: boolean
  isOffline: boolean
  signIn: (username: string, password: string, captchaToken?: string) => Promise<void>
  signUp: (username: string, password: string, captchaToken?: string) => Promise<void>
  signInAsGuest: (username: string, captchaToken?: string) => Promise<void>
  signOut: () => Promise<void>
  /** Purge les données locales de CET appareil (clés E2EE + ratchet, stockage
   *  hors-ligne, caches localStorage) PUIS déconnecte. Différent de `signOut`,
   *  qui ne purge RIEN (modèle local-first). */
  signOutAndWipeLocal: () => Promise<void>
  /** Met à jour le profil local immédiatement (sans attendre Realtime) */
  updateLocalProfile: (patch: Partial<Profile>) => void
  /** Phrase de récupération fraîchement générée (signup), à sauvegarder. */
  pendingPhrase: string | null
  /** Vrai si l'appareil n'a pas les clés locales → phrase requise. */
  recoveryRequired: boolean
  /** Confirme que l'utilisateur a sauvegardé la phrase. */
  confirmPhraseSaved: () => void
  /** Lève l'exigence de récupération (ex. après une liaison d'appareil réussie). */
  clearRecoveryRequired: () => void
  /** Restaure les clés depuis la phrase de récupération. */
  completeRecovery: (phrase: string) => Promise<void>
  /** Régénère les clés (nouvelle phrase) — exige la preuve de l'ancienne. */
  regenerateRecovery: (currentPhrase: string) => Promise<void>
  /** « J'ai perdu ma phrase » : purge l'historique LOCAL (messages, médias,
   *  caches) puis génère un nouveau jeu de clés. Perte DÉFINITIVE des messages
   *  et médias ; les contacts et conversations restent, mais vides. */
  startFreshWithoutRecovery: () => Promise<void>
  /** Gate 2FA en attente au login (challenge à saisir, ou vérification
   *  indisponible), sinon null. Tant que non-null, l'app n'est pas accessible. */
  mfaPending: MfaPendingState | null
  /** Vérifie le code 2FA au login et lève le gate MFA en cas de succès. */
  verifyMfaAtLogin: (code: string) => Promise<{ success: boolean; error?: string }>
  /** Relance la résolution du gate 2FA (bouton « Réessayer » quand la
   *  vérification est indisponible). */
  retryMfaCheck: () => Promise<void>
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
  if (data?.error && (data.error.code || data.error.message)) {
    return { code: data.error.code ?? '', message: data.error.message ?? '' }
  }
  if (!error) return null

  // Cas FunctionsHttpError → contient context (Response)
  const ctx = error.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const parsed = await ctx.json()
      if (parsed?.error && (parsed.error.code || parsed.error.message)) {
        return { code: parsed.error.code ?? '', message: parsed.error.message ?? '' }
      }
    } catch {
      // body non JSON → fallback ci-dessous
    }
  }
  // Fallback générique
  return { code: 'UNKNOWN', message: error.message ?? 'Erreur réseau' }
}

/**
 * Erreur signalant qu'un CAPTCHA est exigé (seuil d'échecs dépassé).
 * `captchaRequired` permet à l'UI d'afficher le widget et de relancer la
 * tentative avec le token.
 */
function makeCaptchaError(code: string): Error {
  const err = new Error('Vérification anti-robot requise. Validez le CAPTCHA et réessayez.') as Error & {
    captchaRequired: boolean
    captchaCode: string
  }
  err.captchaRequired = true
  err.captchaCode = code
  return err
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

// Compteur de tentatives de code 2FA au login, persisté en sessionStorage pour
// ne pas être réinitialisable par un simple rechargement (F5). Un attaquant qui
// atteint la limite doit se reconnecter (ce qui repart d'un nouveau compteur).
const MFA_ATTEMPTS_KEY = 'anu_mfa_attempts';

function readMfaAttempts(): number {
  try {
    const raw = sessionStorage.getItem(MFA_ATTEMPTS_KEY);
    const n = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeMfaAttempts(count: number): void {
  try {
    if (count > 0) sessionStorage.setItem(MFA_ATTEMPTS_KEY, String(count));
    else sessionStorage.removeItem(MFA_ATTEMPTS_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)

  // Récupération « zéro serveur » : phrase neuve à sauvegarder (signup) ou
  // phrase requise (nouvel appareil sans clés locales).
  const [pendingPhrase, setPendingPhrase] = useState<string | null>(null)
  const [recoveryRequired, setRecoveryRequired] = useState(false)

  // 2FA au login : tant que ce facteur est en attente, l'app n'est pas
  // considérée comme pleinement accessible (voir App.tsx → MfaGate).
  const [mfaPending, setMfaPending] = useState<MfaPendingState | null>(null)
  // Compteur de tentatives persisté (sessionStorage) : survit au F5.
  const mfaAttemptsRef = useRef(readMfaAttempts())
  // Miroirs non-réactifs : évitent les résolutions concurrentes (initAuth +
  // événements Supabase) et la régénération en boucle de challenges.
  const mfaPendingRef = useRef<MfaPendingState | null>(null)
  const mfaResolvingRef = useRef(false)
  // Passe à true une fois la restauration initiale terminée : évite que
  // `onAuthStateChange` (INITIAL_SESSION) ne double la résolution du gate.
  const authInitDoneRef = useRef(false)
  // Vrai pendant le flux de connexion explicite (signIn), qui gère le gate
  // lui-même : `onAuthStateChange` ne doit pas résoudre en parallèle.
  const mfaLoginFlowRef = useRef(false)

  // Garde le miroir synchrone en phase avec l'état React (tous les setters).
  useEffect(() => {
    mfaPendingRef.current = mfaPending
  }, [mfaPending])


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

  // Applique un état de gate 2FA (état React + miroir synchrone).
  const applyMfaPending = useCallback((gate: MfaPendingState | null) => {
    mfaPendingRef.current = gate
    setMfaPending(gate)
  }, [])

  /**
   * Réévalue le gate 2FA à partir de l'état SERVEUR (niveau d'assurance +
   * facteurs listés), JAMAIS d'un état mémoire qui ne survit pas au
   * rechargement. Utilisé à la restauration de session (initAuth) et sur les
   * événements d'auth, afin qu'un simple F5 ne contourne pas le second facteur.
   *
   * @param failClosed  `true`  → un état « vérification indisponible » bloque
   *                    l'accès (restauration / connexion : fail-closed).
   *                    `false` → sur un simple rafraîchissement de jeton, ne pas
   *                    bloquer un utilisateur déjà admis sur une erreur
   *                    transitoire ; un challenge définitif est toujours
   *                    appliqué.
   */
  const evaluateMfaGate = useCallback(async (failClosed = true): Promise<MfaPendingState | null> => {
    // Résolution déjà en cours, ou challenge déjà en attente : on ne régénère
    // pas de challenge (évite les appels concurrents et les boucles).
    if (mfaResolvingRef.current) return mfaPendingRef.current
    if (mfaPendingRef.current) return mfaPendingRef.current

    mfaResolvingRef.current = true
    try {
      const gate = await resolveMfaGate()
      if (gate && gate.status === 'unavailable' && !failClosed) {
        // Événement de fond (TOKEN_REFRESHED) : erreur transitoire, on ne
        // bloque pas une session déjà admise.
        return mfaPendingRef.current
      }
      applyMfaPending(gate)
      return gate
    } catch (err) {
      // resolveMfaGate ne lève pas, mais on reste fail-closed par sécurité.
      console.warn('[Auth] MFA gate resolution failed:', err)
      if (failClosed) {
        const gate: MfaPendingState = { status: 'unavailable' }
        applyMfaPending(gate)
        return gate
      }
      return mfaPendingRef.current
    } finally {
      mfaResolvingRef.current = false
    }
  }, [applyMfaPending])

  /**
   * Expose un utilisateur APRÈS résolution du gate 2FA : `setUser` + cache +
   * profil + présence + exigence de récupération. Aucun appelant ne doit
   * exposer l'utilisateur avant que le second facteur soit évalué, sinon des
   * routes protégées seraient montées en aal1.
   */
  const applyUser = useCallback((u: User) => {
    setUser(u)
    cacheUser(u)
    loadProfile(u.id)
    initializePresence(u.id)
    // « Zéro serveur » : si l'appareil n'a pas les clés locales (nouvel
    // appareil / IndexedDB vidé), exiger la phrase de récupération.
    void hasLocalKeys(u.id)
      .then(ok => { if (!ok) setRecoveryRequired(true) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    // Get initial session with timeout and offline fallback
    const initAuth = async () => {
      // Cache local pour affichage immédiat / hors-ligne.
      const cachedUser = getCachedUser();
      const cachedProfile = getCachedProfile();

      // Then try to get fresh session from network
      try {
        const sessionPromise = supabase.auth.getSession();
        const { data: { session } } = await withTimeout(
          sessionPromise,
          AUTH_TIMEOUT,
          { data: { session: null } } as any
        );

        if (session?.user) {
          // Anti-bypass F5 : on résout le gate 2FA AVANT d'exposer
          // l'utilisateur, afin qu'aucune route protégée ne puisse être montée
          // sans que le second facteur soit exigé. Seule la session Supabase
          // persistée fait foi (aucun état mémoire ne survit au rechargement).
          //
          // La résolution (création de challenge) peut nécessiter le réseau :
          // on la borne pour ne pas bloquer indéfiniment l'écran de chargement.
          // Au-delà du délai, on reste fail-closed (« indisponible », avec
          // bouton Réessayer) ; la résolution se poursuit et corrigera l'état
          // dès qu'elle aboutit (challenge réel, ou accès si aucun 2FA).
          const MFA_TIMEOUT = Symbol('mfa-timeout');
          const outcome = await Promise.race([
            evaluateMfaGate(true),
            new Promise<typeof MFA_TIMEOUT>((resolve) =>
              setTimeout(() => resolve(MFA_TIMEOUT), AUTH_TIMEOUT)
            ),
          ]).catch(() => MFA_TIMEOUT);
          if (outcome === MFA_TIMEOUT && mfaResolvingRef.current && mfaPendingRef.current === null) {
            // Résolution encore en vol : fail-closed temporaire (elle corrigera
            // l'état dès qu'elle aboutit).
            applyMfaPending({ status: 'unavailable' });
          }
          applyUser(session.user);
        } else if (cachedUser) {
          // Pas de session fraîche (hors-ligne / jeton expiré) : on affiche le
          // cache local. Aucun jeton valide n'est présent → pas de gate MFA.
          setUser(cachedUser);
          if (cachedProfile) setProfile(cachedProfile);
        } else {
          // Plus de mot de passe invité au repos : la reconnexion invité
          // repose désormais sur la session Supabase persistée (getSession
          // ci-dessus). On purge toute ancienne clé héritée pour ne laisser
          // aucun secret en clair sur l'appareil.
          try { localStorage.removeItem('anu_ephemeral_password'); } catch { /* ignore */ }
          setUser(null);
          setProfile(null);
        }
      } catch (error) {
        // Session fetch failed - use cached data if available
        console.warn('[Auth] Session fetch timed out or failed, using cached data', error);
        if (cachedUser) {
          setUser(cachedUser);
          if (cachedProfile) setProfile(cachedProfile);
        }
      } finally {
        setLoading(false);
        authInitDoneRef.current = true;
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const newUser = session?.user ?? null;

      if (!newUser) {
        setUser(null);
        cacheUser(null);
        setProfile(null);
        cacheProfile(null);
        // Cleanup presence when user logs out
        cleanupPresence();
        applyMfaPending(null);
        mfaAttemptsRef.current = 0;
        writeMfaAttempts(0);
        return;
      }

      // Anti-bypass : on n'expose JAMAIS l'utilisateur avant que le gate 2FA ne
      // soit résolu (setUser AVANT la résolution montait les routes en aal1).
      // Le flux de connexion explicite (signIn) gère l'exposition lui-même
      // après SA propre résolution du gate : on ne double pas ici.
      if (mfaLoginFlowRef.current) return;

      void (async () => {
        if (
          authInitDoneRef.current &&
          (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')
        ) {
          // Filet de sécurité « facteur 2FA vérifié + session aal1 » (voir
          // getMFAChallenge) : TOKEN_REFRESHED rejoue la détection APRÈS chaque
          // rafraîchissement de jeton — un jeton repassé en aal1 refait surgir le
          // gate au lieu d'afficher une app vide. TOKEN_REFRESHED = événement de
          // fond → pas de blocage sur erreur transitoire (failClosed = false) ;
          // un challenge définitif est toujours appliqué.
          await evaluateMfaGate(event !== 'TOKEN_REFRESHED');
        }
        applyUser(newUser);
      })();
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

  const signIn = async (username: string, password: string, captchaToken?: string) => {
    try {
      // Utiliser l'edge function pour connexion par pseudo
      const { data, error } = await supabase.functions.invoke('auth-with-username', {
        body: { action: 'signin', username, password, ...(captchaToken ? { captchaToken } : {}) }
      })

      // Tenter de récupérer l'erreur structurée renvoyée par l'edge function,
      // que ce soit dans `data` (200) ou dans `error.context` (4xx/5xx).
      const fnError = await extractFunctionError(error, data)
      if (fnError) {
        if (fnError.code === 'CAPTCHA_REQUIRED' || fnError.code === 'CAPTCHA_INVALID') {
          throw makeCaptchaError(fnError.code)
        }
        if (fnError.code === 'RATE_LIMITED') {
          throw new Error(`${tStatic('tooManyAttempts')}\n\n${fnError.message}`)
        }
        if (fnError.code === 'VALIDATION_ERROR') {
          throw new Error(`${tStatic('invalidInput')}\n\n${fnError.message}`)
        }
        const errorMsg = fnError.message || ''
        if (errorMsg.includes('Invalid login') || errorMsg.includes('Invalid credentials')) {
          throw new Error(tStatic('invalidCredentials'))
        } else if (errorMsg.includes('User not found')) {
          throw new Error(tStatic('accountNotFound'))
        } else {
          throw new Error(tStatic('authConnectionError'))
        }
      }

      // Définir la session manuellement
      if (data?.data?.session) {
        // Le flux de connexion gère explicitement le gate 2FA ci-dessous : on
        // empêche `onAuthStateChange` de le résoudre en parallèle (sinon double
        // création de challenge).
        mfaLoginFlowRef.current = true
        try {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: data.data.session.access_token,
            refresh_token: data.data.session.refresh_token
          })
          if (sessionError) {
            console.error('Session error:', sessionError)
            throw new Error('❌ Erreur de session\n\nImpossible de vous connecter.')
          }
          // 2FA (fail-closed) : si un second facteur est requis (aal1 → aal2),
          // on bloque l'accès à l'app derrière MfaGate tant que le code n'est
          // pas vérifié. Une évaluation impossible ne laisse jamais passer la
          // session en silence (voir resolveMfaGate) : un compte avec 2FA est
          // maintenu derrière « vérification indisponible », un compte sans
          // 2FA passe normalement.
          mfaAttemptsRef.current = 0
          writeMfaAttempts(0)
          const gate = await evaluateMfaGate(true)
          if (gate) {
            return
          }
        } finally {
          mfaLoginFlowRef.current = false
        }
        // Pas de gate 2FA → on poursuit la restauration des clés E2EE ci-dessous.
        // Restaurer (ou créer) la clé E2EE AVEC le password. On ATTEND la
        // restauration (multi-appareil) : sinon les conversations se chargent
        // avant que les clés (ratchet) soient en IndexedDB → « clés locales
        // absentes » → 🔒. Les fonctions ne lèvent jamais (try/catch interne).
        const sessionUser = data.data.session.user
        const userId = sessionUser?.id
        if (sessionUser) {
          // Gate résolu : on expose enfin l'utilisateur (voir applyUser).
          applyUser(sessionUser)
          if (userId && (await hasLocalKeys(userId))) {
            // Best-effort : publier la signature Ed25519 de la clé X25519 déjà
            // installée (authentifie les clés existantes sans rotation).
            void import('@/lib/e2eeX25519')
              .then(m => m.publishX25519Signature(userId))
              .catch(() => {})
          }
        }
      } else {
        throw new Error(tStatic('authNoSession'))
      }
    } catch (err: any) {
      // Si c'est déjà notre erreur formatée (ou un CAPTCHA requis), la relancer
      if (err?.captchaRequired || err.message.startsWith('❌')) {
        throw err
      }
      // Sinon, formater l'erreur
      console.error('Unexpected signin error:', err)
      throw new Error(tStatic('authCheckConnection'))
    }
  }

  const signUp = async (username: string, password: string, captchaToken?: string) => {
    try {
      // Utiliser l'edge function pour inscription par pseudo
      const { data, error } = await supabase.functions.invoke('auth-with-username', {
        body: { action: 'signup', username, password, ...(captchaToken ? { captchaToken } : {}) }
      })

      const fnError = await extractFunctionError(error, data)
      if (fnError) {
        if (fnError.code === 'CAPTCHA_REQUIRED' || fnError.code === 'CAPTCHA_INVALID') {
          throw makeCaptchaError(fnError.code)
        }
        if (fnError.code === 'RATE_LIMITED') {
          throw new Error(`❌ Trop d'inscriptions\n\n${fnError.message}`)
        }
        if (fnError.code === 'VALIDATION_ERROR') {
          throw new Error(`${tStatic('invalidInput')}\n\n${fnError.message}`)
        }
        const errorMsg = fnError.message || ''
        if (errorMsg.includes('already exists') || errorMsg.includes('duplicate')) {
          throw new Error(tStatic('usernameTaken'))
        } else if (errorMsg.includes('password')) {
          throw new Error(tStatic('invalidPasswordSignup'))
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
          throw new Error(tStatic('sessionErrorSignup'))
        }
        // « Zéro serveur » : on génère une phrase, on dérive les clés LOCALEMENT
        // et on ne publie que le matériel public. La phrase est affichée à
        // l'utilisateur (sauvegarde obligatoire) via le gate.
        const userId = data.data.session.user?.id
        if (userId) {
          const phrase = await setupRecoveryKeys(userId)
          setPendingPhrase(phrase)
        }
      } else {
        throw new Error('❌ Erreur d\'inscription\n\nAucune session reçue.')
      }
    } catch (err: any) {
      // Si c'est déjà notre erreur formatée (ou un CAPTCHA requis), la relancer
      if (err?.captchaRequired || err.message.startsWith('❌')) {
        throw err
      }
      // Sinon, formater l'erreur
      console.error('Unexpected signup error:', err)
      throw new Error('❌ Erreur d\'inscription\n\nVérifiez votre connexion internet et réessayez.')
    }
  }

  const signInAsGuest = async (username: string, captchaToken?: string) => {
    try {
      // Check if we can reuse an existing ephemeral account
      const storedUser = localStorage.getItem('anu_ephemeral_user');
      const sanitizedInput = username.toLowerCase().replaceAll(/[^a-z0-9]/g, '') || 'user';

      // Réutilisation SANS secret au repos : on ne stocke plus le mot de passe
      // invité (auparavant en clair dans localStorage — vulnérabilité). Si une
      // session Supabase valide existe déjà pour cet invité, on la réutilise
      // telle quelle (aucun re-login par mot de passe nécessaire).
      if (storedUser && storedUser.startsWith(sanitizedInput)) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            return; // Session valide réutilisée, aucun mot de passe requis.
          }
        } catch {
          // Pas de session réutilisable → créer un nouveau compte invité.
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
          is_ephemeral: true,
          ...(captchaToken ? { captchaToken } : {})
        }
      })

      const fnError = await extractFunctionError(error, data)
      if (fnError) {
        if (fnError.code === 'CAPTCHA_REQUIRED' || fnError.code === 'CAPTCHA_INVALID') {
          throw makeCaptchaError(fnError.code)
        }
        if (fnError.code === 'RATE_LIMITED') {
          throw new Error(`❌ Trop de créations\n\n${fnError.message}`)
        }
        if (fnError.code === 'VALIDATION_ERROR') {
          throw new Error(`${tStatic('invalidInput')}\n\n${fnError.message}`)
        }
        console.error('Guest signup error:', fnError)
        throw new Error(tStatic('guestModeUnavailable'))
      }

      // Définir la session
      if (data?.data?.session) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.data.session.access_token,
          refresh_token: data.data.session.refresh_token
        })
        if (sessionError) {
          console.error('Session error:', sessionError)
          throw new Error(tStatic('guestSessionError'))
        }
        // Compte éphémère : générer + publier les clés E2EE (sinon le compte
        // ne peut ni déchiffrer les messages reçus ni être chiffré pour lui).
        // Compte éphémère : clés dérivées d'une phrase jetable (aucune privée
        // envoyée au serveur).
        const guestUserId = data.data.session.user?.id
        if (guestUserId) {
          await setupRecoveryKeys(guestUserId)
        }
      } else {
        throw new Error(tStatic('creationErrorNoSession'))
      }

      // Stocker en local que c'est un mode éphémère.
      // NOTE : le mot de passe invité n'est VOLONTAIREMENT PAS persisté (aucun
      // secret au repos). La reconnexion invité repose sur la session Supabase
      // persistée par supabase-js ; on purge toute ancienne clé héritée.
      localStorage.setItem('anu_ephemeral_mode', 'true')
      localStorage.setItem('anu_ephemeral_user', uniqueUsername)
      localStorage.removeItem('anu_ephemeral_password')
    } catch (err: any) {
      // Si c'est déjà notre erreur formatée (ou un CAPTCHA requis), la relancer
      if (err?.captchaRequired || err.message.startsWith('❌')) {
        throw err
      }
      // Sinon, formater l'erreur
      console.error('Unexpected guest error:', err)
      throw new Error(tStatic('guestModeCheckConnection'))
    }
  }

  const signOut = async () => {
    setPendingPhrase(null)
    setRecoveryRequired(false)
    applyMfaPending(null)
    mfaAttemptsRef.current = 0
    writeMfaAttempts(0)
    // Si mode éphémère, supprimer toutes les données
    const isEphemeral = localStorage.getItem('anu_ephemeral_mode') === 'true'
    
    if (isEphemeral && user) {
      try {
        // Supprimer nos messages d'abord (identifiés via sealed — Phase 1c),
        // AVANT de retirer nos appartenances (sinon plus de conversations).
        await deleteMyMessages(user.id)

        // Supprimer toutes les conversations de l'utilisateur
        await supabase.from('conversation_members').delete().eq('user_id', user.id)
        
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
    
    // Modèle « local-first » (comme WhatsApp) : on NE purge PAS les clés E2EE
    // (X25519/ratchet) ni l'historique local à la déconnexion. Se reconnecter
    // sur le MÊME appareil ne doit donc PAS redemander la phrase de récupération.
    // La phrase n'est requise que sur un AUTRE appareil (ou après effacement
    // manuel des données du navigateur).
    try {
      // Ancien cache de texte déchiffré (versions précédentes) — sans effet sur
      // les clés ni sur l'historique.
      localStorage.removeItem('nephtys_plaintext_cache_v1')
    } catch { /* best effort */ }

    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  /**
   * « Effacer les données de cet appareil » : purge explicitement demandée par
   * l'utilisateur, PUIS déconnexion. À ne pas confondre avec `signOut` qui, en
   * mode local-first, conserve volontairement les clés et l'historique.
   *
   * Purge : clés E2EE X25519, matériel ratchet (clés + sessions), stockage
   * hors-ligne (IndexedDB + cache conversations) et caches localStorage
   * (messages propres, cache clair, caches `anu_cache_*`). On NE touche PAS la
   * config réseau (relais/Tor/décentralisé) : ce sont des préférences de
   * l'appareil, pas des données personnelles, et les conserver évite de
   * reconfigurer le transport à la reconnexion.
   */
  const signOutAndWipeLocal = async (): Promise<void> => {
    const uid = user?.id
    setPendingPhrase(null)
    setRecoveryRequired(false)
    applyMfaPending(null)
    mfaAttemptsRef.current = 0
    writeMfaAttempts(0)

    if (uid) {
      // 1. Clés E2EE locales (X25519).
      try {
        const { clearLocalX25519 } = await import('@/lib/e2eeX25519')
        await clearLocalX25519(uid)
      } catch { /* best effort */ }
      // 2. Matériel ratchet (IndexedDB + sessions par conversation).
      try { await clearLocalRatchetKeys(uid) } catch { /* best effort */ }
      try { await clearUserSessions(uid) } catch { /* best effort */ }
    }

    // 3. Stockage hors-ligne (messages, conversations, médias, file d'attente).
    try { await offlineStorage.clearAll() } catch { /* best effort */ }

    // 4. Caches localStorage locaux à cet appareil.
    try {
      localStorage.removeItem('nephtys_own_messages_v1')
      localStorage.removeItem('nephtys_plaintext_cache_v1')
      // Invité : aucune donnée d'identification locale (dont l'ancien mot de
      // passe en clair) ne doit survivre à un effacement de l'appareil.
      localStorage.removeItem('anu_ephemeral_mode')
      localStorage.removeItem('anu_ephemeral_user')
      localStorage.removeItem('anu_ephemeral_password')
      const toRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith('anu_cache_')) toRemove.push(key)
      }
      for (const key of toRemove) localStorage.removeItem(key)
    } catch { /* best effort */ }

    // 5. Déconnexion.
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  const confirmPhraseSaved = () => setPendingPhrase(null)

  const clearRecoveryRequired = useCallback(() => setRecoveryRequired(false), [])

  const completeRecovery = async (phrase: string) => {
    const uid = user?.id
    if (!uid) throw new Error('Non connecté')
    // Vérifie la phrase contre les clés PUBLIQUES déjà publiées du compte AVANT
    // toute (ré)installation : un simple porteur de session ne doit pas pouvoir
    // substituer les clés avec une phrase arbitraire.
    const check = await checkPhraseMatchesAccount(uid, phrase)
    if (check.published && !check.matches) {
      throw new Error(tStatic('recoveryPhraseMismatch'))
    }
    await installKeysFromPhrase(uid, phrase)
    setRecoveryRequired(false)
  }

  const regenerateRecovery = async (currentPhrase: string) => {
    const uid = user?.id
    if (!uid) throw new Error('Non connecté')
    // Preuve de possession de l'ancienne phrase AVANT toute modification.
    const verified = await verifyCurrentPhrase(uid, currentPhrase)
    if (!verified) {
      throw new Error(tStatic('recoveryPhraseIncorrect'))
    }
    const phrase = await regenerateRecoveryKeys(uid, currentPhrase)
    setPendingPhrase(phrase)
  }

  /**
   * « J'ai perdu ma phrase » : repart de zéro sur cet appareil sans pouvoir
   * restaurer l'ancien historique. On purge d'abord les données LOCALES
   * (messages, médias, file d'attente, caches) afin de ne laisser aucun
   * contenu indéchiffrable, puis on génère + publie un NOUVEAU jeu de clés.
   * La nouvelle phrase est affichée pour sauvegarde obligatoire.
   *
   * ⚠️ Action irréversible : l'historique chiffré avec l'ancienne phrase est
   * définitivement perdu. Les contacts et la liste des conversations restent
   * côté serveur, mais apparaissent vides (sans aucun message ni média).
   */
  const startFreshWithoutRecovery = async (): Promise<void> => {
    const uid = user?.id
    if (!uid) throw new Error('Non connecté')

    // 1. Stockage hors-ligne (messages, médias, conversations, file d'attente).
    try { await offlineStorage.clearAll() } catch { /* best effort */ }

    // 2. Caches localStorage propres à cet appareil.
    try {
      localStorage.removeItem('nephtys_own_messages_v1')
      localStorage.removeItem('nephtys_plaintext_cache_v1')
      const toRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith('anu_cache_')) toRemove.push(key)
      }
      for (const key of toRemove) localStorage.removeItem(key)
    } catch { /* best effort */ }

    // 3. Masque TOUT l'historique côté serveur pour cet utilisateur (« supprimer
    //    pour moi » sur chaque message) : les contacts et conversations restent,
    //    mais plus aucun ancien message (chiffré avec l'ancienne phrase) n'est
    //    affiché. Les autres participants gardent les leurs.
    await hideAllMessagesForUser(uid)

    // 4. Ancien matériel de clés (local + serveur) PUIS nouveau jeu de clés.
    //    Publie les nouvelles clés publiques : l'ancien historique devient
    //    illisible (perte volontaire et confirmée par l'utilisateur).
    const phrase = await resetRecoveryKeysWithoutPhrase(uid)

    // 5. La nouvelle phrase DOIT être sauvegardée (comme à l'inscription).
    setRecoveryRequired(false)
    setPendingPhrase(phrase)
  }

  const verifyMfaAtLogin = async (code: string): Promise<{ success: boolean; error?: string }> => {
    const pending = mfaPending
    if (!pending || pending.status !== 'challenge') {
      return { success: false, error: tStatic('mfaGateNoChallenge') }
    }
    if (mfaAttemptsRef.current >= MAX_MFA_ATTEMPTS) {
      return { success: false, error: tStatic('mfaTooManyAttempts') }
    }
    const result = await verifyMFAChallenge(pending.factorId, pending.challengeId, code)
    if (result.success) {
      mfaAttemptsRef.current = 0
      writeMfaAttempts(0)
      applyMfaPending(null)
      // Événement de connexion géré par signIn (mfaLoginFlowRef) : on expose
      // maintenant la session, le second facteur étant résolu.
      try {
        const { data } = await supabase.auth.getSession()
        if (data.session?.user) applyUser(data.session.user)
      } catch {
        // best effort : le refresh d'état exposera l'utilisateur
      }
      return { success: true }
    }
    // Compteur persisté (sessionStorage) : un rechargement (F5) ne le
    // réinitialise pas, ce qui empêche le contournement par rechargement.
    mfaAttemptsRef.current += 1
    writeMfaAttempts(mfaAttemptsRef.current)
    return { success: false, error: result.error ?? tStatic('twoFaInvalidCode') }
  }

  /**
   * Relance la résolution du gate 2FA. Utilisé par l'écran « vérification
   * indisponible » : si la cause était transitoire, on retombe soit sur un
   * challenge à saisir, soit (si confirmé sans 2FA) sur l'accès à l'app.
   */
  const retryMfaCheck = async (): Promise<void> => {
    const gate = await resolveMfaGate()
    if (gate === null) {
      mfaAttemptsRef.current = 0
      writeMfaAttempts(0)
    }
    applyMfaPending(gate)
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
    signOutAndWipeLocal,
    updateLocalProfile,
    pendingPhrase,
    recoveryRequired,
    confirmPhraseSaved,
    clearRecoveryRequired,
    completeRecovery,
    regenerateRecovery,
    startFreshWithoutRecovery,
    mfaPending,
    verifyMfaAtLogin,
    retryMfaCheck,
  }), [user, profile, loading, isOffline, pendingPhrase, recoveryRequired, mfaPending]);

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
