// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { supabase } from './supabase'
import { tStatic } from '@/i18n';

export interface TOTPFactor {
  id: string
  friendly_name: string
  factor_type: 'totp'
  status: 'verified' | 'unverified'
  created_at: string
  updated_at: string
}

export interface EnrollmentData {
  id: string
  type: 'totp'
  totp: {
    qr_code: string // Data URL for QR code
    secret: string // Base32 encoded secret
    uri: string // otpauth:// URI
  }
}

// Check if user has 2FA enabled
export async function check2FAStatus(): Promise<{
  enabled: boolean
  factors: TOTPFactor[]
}> {
  try {
    const { data, error } = await supabase.auth.mfa.listFactors()
    
    if (error) {
      console.error('[2FA] Error checking status:', error)
      return { enabled: false, factors: [] }
    }
    
    // Filter for verified TOTP factors
    const verifiedFactors = (data?.totp || []).filter(
      (f: any) => f.status === 'verified'
    ) as TOTPFactor[]
    
    return {
      enabled: verifiedFactors.length > 0,
      factors: verifiedFactors
    }
  } catch (err) {
    console.error('[2FA] Error:', err)
    return { enabled: false, factors: [] }
  }
}

// Start 2FA enrollment - generates QR code
export async function enroll2FA(friendlyName: string = 'Nephtys App'): Promise<{
  success: boolean
  data?: EnrollmentData
  error?: string
}> {
  try {
    // First, check for existing unverified factors and remove them
    const { data: factorsData } = await supabase.auth.mfa.listFactors()
    
    if (factorsData?.totp) {
      // Find any unverified factors with the same name
      const unverifiedFactors = factorsData.totp.filter(
        (f: any) => f.status === 'unverified'
      )
      
      // Unenroll all unverified factors to allow fresh enrollment
      for (const factor of unverifiedFactors) {
        try {
          await supabase.auth.mfa.unenroll({ factorId: factor.id })
        } catch (e) {
          console.warn('[2FA] Could not remove unverified factor:', e)
        }
      }
    }
    
    // Now enroll with a unique name to avoid conflicts
    const uniqueName = `${friendlyName}_${Date.now()}`
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: uniqueName
    })
    
    if (error) {
      console.error('[2FA] Enrollment error:', error)
      
      // If still getting duplicate error, try with timestamp
      if (error.message.includes('already exists')) {
        const retryName = `Nephtys_${Date.now()}`
        const { data: retryData, error: retryError } = await supabase.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: retryName
        })
        
        if (retryError) {
          return { success: false, error: tStatic('twoFaSetupFailed') }
        }
        
        return {
          success: true,
          data: retryData as EnrollmentData
        }
      }
      
      return { success: false, error: error.message }
    }
    
    return {
      success: true,
      data: data as EnrollmentData
    }
  } catch (err: any) {
    console.error('[2FA] Enrollment error:', err)
    return { success: false, error: err.message || 'Erreur lors de l\'inscription' }
  }
}

// Verify 2FA enrollment with TOTP code
export async function verify2FAEnrollment(
  factorId: string,
  code: string
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    // First, create a challenge
    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId
    })
    
    if (challengeError) {
      console.error('[2FA] Challenge error:', challengeError)
      return { success: false, error: challengeError.message }
    }
    
    // Then verify with the code
    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code
    })
    
    if (error) {
      console.error('[2FA] Verification error:', error)
      if (error.message.includes('Invalid')) {
        return { success: false, error: tStatic('twoFaInvalidCodeDesc') }
      }
      return { success: false, error: error.message }
    }
    
    return { success: true }
  } catch (err: any) {
    console.error('[2FA] Verification error:', err)
    return { success: false, error: err.message || tStatic('twoFaVerifyError') }
  }
}

// Unenroll (disable) 2FA
export async function unenroll2FA(factorId: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const { error } = await supabase.auth.mfa.unenroll({
      factorId
    })
    
    if (error) {
      console.error('[2FA] Unenroll error:', error)
      return { success: false, error: error.message }
    }
    
    return { success: true }
  } catch (err: any) {
    console.error('[2FA] Unenroll error:', err)
    return { success: false, error: err.message || tStatic('twoFaDisableError') }
  }
}

/**
 * Résultat d'un contrôle MFA au login. Le champ `status` est EXPLICITE pour
 * éviter tout fail-open :
 * - `'ok'`          : AAL récupéré ET aucune vérification supplémentaire
 *                     requise (pas de 2FA, ou déjà en aal2) → session sûre.
 * - `'challenge'`   : un second facteur est exigé ; `factorId`/`challengeId`
 *                     sont fournis pour vérifier le code.
 * - `'unavailable'` : impossible de conclure (erreur réseau, `supabase.auth.mfa`
 *                     indisponible, échec de création du challenge…). NE JAMAIS
 *                     interpréter comme « pas de 2FA » : c'est un état d'erreur
 *                     que l'appelant doit traiter en fail-closed.
 */
export type MfaChallengeStatus = 'ok' | 'challenge' | 'unavailable'

export interface MfaChallengeResult {
  status: MfaChallengeStatus
  /**
   * Conservé pour compatibilité : vrai uniquement quand `status === 'challenge'`.
   * N'est JAMAIS `true` sur `'unavailable'` (l'appelant doit se fier à `status`).
   */
  needsChallenge: boolean
  factorId?: string
  challengeId?: string
  error?: string
}

// Get current MFA challenge (for login flow)
export async function getMFAChallenge(): Promise<MfaChallengeResult> {
  try {
    // Check the current assurance level
    const { data: aalData, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

    // Échec de lecture de l'AAL : on ne peut pas affirmer « pas de 2FA ».
    if (aalError || !aalData) {
      console.error('[2FA] AAL error:', aalError)
      return { status: 'unavailable', needsChallenge: false, error: aalError?.message ?? 'AAL indéterminé' }
    }

    // Déjà en aal2 : aucune vérification supplémentaire requise, session sûre.
    if (aalData.currentLevel === 'aal2') {
      return { status: 'ok', needsChallenge: false }
    }

    // currentLevel === 'aal1' (ou indéterminé, ex. claim absent).
    //
    // FILE T DE SÉCURITÉ « facteur 2FA vérifié + session aal1 » :
    // `nextLevel` est calculé par supabase-js à partir des facteurs présents
    // DANS LA SESSION (`user.factors`), qui peuvent être absents ou périmés
    // (jeton rafraîchi, cache) alors qu'un facteur VÉRIFIÉ existe côté serveur.
    // Dans ce cas `nextLevel` vaut à tort 'aal1' et la session reste en aal1 :
    // les policies RLS `aal2_ok` renvoient alors 0 ligne / une erreur RLS (app
    // vide) SANS jamais exiger le code. On liste donc les facteurs FRAÎCHEMENT
    // via l'API MFA, indépendamment de `nextLevel` :
    //   • facteur VÉRIFIÉ présent ET session aal1 → on FORCE un challenge
    //     (le gate MFA s'affiche ; l'app reste bloquée jusqu'au code TOTP).
    //   • AUCUN facteur vérifié → pas de 2FA → on laisse entrer (on ne bloque
    //     JAMAIS un compte sans 2FA).
    const serverRequires = aalData.nextLevel === 'aal2'
    const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors()

    if (factorsError) {
      // Facteurs indéterminables. Si le serveur a déjà conclu qu'un second
      // facteur est requis (`nextLevel === 'aal2'`), on reste fail-closed ;
      // sinon on ne bloque pas un compte sans 2FA.
      console.error('[2FA] listFactors error:', factorsError)
      return serverRequires
        ? { status: 'unavailable', needsChallenge: false, error: factorsError.message }
        : { status: 'ok', needsChallenge: false }
    }

    const verifiedFactor = factorsData?.totp?.find((f: any) => f.status === 'verified')

    if (!verifiedFactor) {
      // Aucun facteur vérifié listable → pas de 2FA.
      // Incohérence si `nextLevel` exigeait aal2 (aal2 réclamé mais aucun
      // facteur vérifié) : prudence, on refuse de conclure « pas de 2FA ».
      return serverRequires
        ? { status: 'unavailable', needsChallenge: false, error: 'No verified factor available' }
        : { status: 'ok', needsChallenge: false }
    }

    // Facteur vérifié MAIS session en aal1 → second facteur obligatoire.
    // Create a challenge
    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: verifiedFactor.id
    })

    if (challengeError || !challengeData) {
      return { status: 'unavailable', needsChallenge: false, error: challengeError?.message }
    }

    return {
      status: 'challenge',
      needsChallenge: true,
      factorId: verifiedFactor.id,
      challengeId: challengeData.id
    }
  } catch (err: any) {
    // Exception (ex. `supabase.auth.mfa` indisponible) → état d'erreur explicite.
    console.error('[2FA] Challenge error:', err)
    return { status: 'unavailable', needsChallenge: false, error: err?.message ?? 'MFA unavailable' }
  }
}

// Verify MFA challenge during login
export async function verifyMFAChallenge(
  factorId: string,
  challengeId: string,
  code: string
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code
    })
    
    if (error) {
      console.error('[2FA] MFA verify error:', error)
      if (error.message.includes('Invalid')) {
        return { success: false, error: 'Code invalide' }
      }
      return { success: false, error: error.message }
    }
    
    return { success: true }
  } catch (err: any) {
    console.error('[2FA] MFA verify error:', err)
    return { success: false, error: err.message || tStatic('twoFaVerifyError') }
  }
}

// Generate a new challenge for an existing factor
export async function createNewChallenge(factorId: string): Promise<{
  success: boolean
  challengeId?: string
  error?: string
}> {
  try {
    const { data, error } = await supabase.auth.mfa.challenge({
      factorId
    })
    
    if (error) {
      return { success: false, error: error.message }
    }
    
    return { success: true, challengeId: data.id }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}