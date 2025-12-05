// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { supabase } from './supabase'

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
        console.log('[2FA] Removing unverified factor:', factor.id)
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
          return { success: false, error: 'Impossible de configurer la 2FA. Veuillez réessayer.' }
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
    const { data, error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code
    })
    
    if (error) {
      console.error('[2FA] Verification error:', error)
      if (error.message.includes('Invalid')) {
        return { success: false, error: 'Code invalide. Vérifiez votre application d\'authentification.' }
      }
      return { success: false, error: error.message }
    }
    
    return { success: true }
  } catch (err: any) {
    console.error('[2FA] Verification error:', err)
    return { success: false, error: err.message || 'Erreur de vérification' }
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
    return { success: false, error: err.message || 'Erreur lors de la désactivation' }
  }
}

// Get current MFA challenge (for login flow)
export async function getMFAChallenge(): Promise<{
  needsChallenge: boolean
  factorId?: string
  challengeId?: string
  error?: string
}> {
  try {
    // Check the current assurance level
    const { data: aalData, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    
    if (aalError) {
      console.error('[2FA] AAL error:', aalError)
      return { needsChallenge: false, error: aalError.message }
    }
    
    // If current level is aal1 but next level is aal2, user needs to verify 2FA
    if (aalData.currentLevel === 'aal1' && aalData.nextLevel === 'aal2') {
      // Get the first verified TOTP factor
      const { data: factorsData } = await supabase.auth.mfa.listFactors()
      const verifiedFactor = factorsData?.totp?.find((f: any) => f.status === 'verified')
      
      if (verifiedFactor) {
        // Create a challenge
        const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
          factorId: verifiedFactor.id
        })
        
        if (challengeError) {
          return { needsChallenge: false, error: challengeError.message }
        }
        
        return {
          needsChallenge: true,
          factorId: verifiedFactor.id,
          challengeId: challengeData.id
        }
      }
    }
    
    return { needsChallenge: false }
  } catch (err: any) {
    console.error('[2FA] Challenge error:', err)
    return { needsChallenge: false, error: err.message }
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
    return { success: false, error: err.message || 'Erreur de vérification' }
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