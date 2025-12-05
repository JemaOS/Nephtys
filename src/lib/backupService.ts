// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { supabase } from './supabase'

export interface MediaFile {
  messageId: string
  type: 'image' | 'video' | 'audio' | 'voice' | 'file'
  fileName: string
  mimeType: string
  data: string // base64 encoded
  size: number
}

export interface BackupData {
  version: string
  createdAt: string
  userId: string
  conversations: any[]
  messages: any[]
  contacts: any[]
  profile: any
  settings: BackupSettings
  mediaFiles?: MediaFile[] // Optional: actual media files encoded in base64
}

export interface BackupSettings {
  frequency: 'daily' | 'weekly' | 'monthly'
  includeImages: boolean
  includeVideos: boolean
  includeAudio: boolean
  includeFiles: boolean
  lastBackupDate: string | null
  lastBackupSize: number
}

export interface BackupMetadata {
  lastBackupDate: string | null
  lastBackupSize: number
  backupCount: number
}

const BACKUP_VERSION = '1.0.0'
const STORAGE_KEY = 'nephtys_backup_settings'
const BACKUP_METADATA_KEY = 'nephtys_backup_metadata'

// Simple encryption using Web Crypto API
async function deriveKey(password: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// Encrypt data with AES-GCM
export async function encryptData(data: string, password: string): Promise<string> {
  const encoder = new TextEncoder()
  const saltArray = crypto.getRandomValues(new Uint8Array(16))
  const ivArray = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, saltArray.buffer as ArrayBuffer)
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivArray },
    key,
    encoder.encode(data)
  )
  
  // Combine salt + iv + encrypted data
  const combined = new Uint8Array(saltArray.length + ivArray.length + encrypted.byteLength)
  combined.set(saltArray, 0)
  combined.set(ivArray, saltArray.length)
  combined.set(new Uint8Array(encrypted), saltArray.length + ivArray.length)
  
  // Convert to base64
  return btoa(String.fromCharCode(...combined))
}

// Decrypt data with AES-GCM
export async function decryptData(encryptedData: string, password: string): Promise<string | null> {
  try {
    // Decode from base64
    const combined = new Uint8Array(
      atob(encryptedData).split('').map(c => c.charCodeAt(0))
    )
    
    const saltArray = combined.slice(0, 16)
    const ivArray = combined.slice(16, 28)
    const dataArray = combined.slice(28)
    
    const key = await deriveKey(password, saltArray.buffer as ArrayBuffer)
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivArray },
      key,
      dataArray
    )
    
    return new TextDecoder().decode(decrypted)
  } catch (error) {
    console.error('Decryption failed:', error)
    return null
  }
}

// Get backup settings from localStorage
export function getBackupSettings(): BackupSettings {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      return JSON.parse(stored)
    } catch {
      return getDefaultSettings()
    }
  }
  return getDefaultSettings()
}

// Save backup settings to localStorage
export function saveBackupSettings(settings: BackupSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

// Get default settings
function getDefaultSettings(): BackupSettings {
  return {
    frequency: 'weekly',
    includeImages: true,
    includeVideos: false,
    includeAudio: true,
    includeFiles: true,
    lastBackupDate: null,
    lastBackupSize: 0
  }
}

// Get backup metadata
export function getBackupMetadata(): BackupMetadata {
  const stored = localStorage.getItem(BACKUP_METADATA_KEY)
  if (stored) {
    try {
      return JSON.parse(stored)
    } catch {
      return { lastBackupDate: null, lastBackupSize: 0, backupCount: 0 }
    }
  }
  return { lastBackupDate: null, lastBackupSize: 0, backupCount: 0 }
}

// Save backup metadata
export function saveBackupMetadata(metadata: BackupMetadata): void {
  localStorage.setItem(BACKUP_METADATA_KEY, JSON.stringify(metadata))
}

// Helper function to download a file and convert to base64
async function downloadFileAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    
    const blob = await response.blob()
    const mimeType = blob.type || 'application/octet-stream'
    
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const base64 = reader.result as string
        // Remove the data URL prefix (e.g., "data:image/png;base64,")
        const base64Data = base64.split(',')[1] || base64
        resolve({ data: base64Data, mimeType })
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch (error) {
    console.error('Error downloading file:', error)
    return null
  }
}

// Create a full backup of user data
export async function createBackup(
  userId: string,
  settings: BackupSettings,
  onProgress?: (progress: number, status: string) => void
): Promise<{ data: BackupData; size: number }> {
  onProgress?.(0, 'Préparation de la sauvegarde...')

  // Get user profile
  onProgress?.(5, 'Récupération du profil...')
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  // Get user's conversations
  onProgress?.(10, 'Récupération des conversations...')
  const { data: memberData } = await supabase
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userId)

  const conversationIds = memberData?.map(m => m.conversation_id) || []

  // Get conversation details
  onProgress?.(15, 'Récupération des détails des conversations...')
  const { data: conversations } = await supabase
    .from('conversations')
    .select('*')
    .in('id', conversationIds)

  // Get all conversation members for these conversations
  const { data: allMembers } = await supabase
    .from('conversation_members')
    .select('*, profiles:user_id(id, username, display_name, avatar_url)')
    .in('conversation_id', conversationIds)

  // Attach members to conversations
  const conversationsWithMembers = conversations?.map(conv => ({
    ...conv,
    members: allMembers?.filter(m => m.conversation_id === conv.id) || []
  })) || []

  // Get messages
  onProgress?.(20, 'Récupération des messages...')
  let messagesQuery = supabase
    .from('messages')
    .select('*')
    .in('conversation_id', conversationIds)
    .order('created_at', { ascending: true })

  // Filter out videos if not included
  if (!settings.includeVideos) {
    messagesQuery = messagesQuery.not('type', 'eq', 'video')
  }

  const { data: messages } = await messagesQuery

  // Get contacts
  onProgress?.(25, 'Récupération des contacts...')
  const { data: contacts } = await supabase
    .from('contacts')
    .select('*, contact:contact_id(id, username, display_name, avatar_url)')
    .eq('user_id', userId)

  // Download media files based on settings
  onProgress?.(30, 'Téléchargement des fichiers médias...')
  const mediaFiles: MediaFile[] = []
  
  if (messages && messages.length > 0) {
    // Filter messages that have media URLs
    const messagesWithMedia = messages.filter(m => {
      const hasMedia = m.media_url || m.file_url
      if (!hasMedia) return false
      
      const type = m.type || m.media_type
      
      // Check if this type should be included based on settings
      if (type === 'image' && !settings.includeImages) return false
      if (type === 'video' && !settings.includeVideos) return false
      if ((type === 'audio' || type === 'voice') && !settings.includeAudio) return false
      if (type === 'file' && !settings.includeFiles) return false
      
      return true
    })
    
    const totalMedia = messagesWithMedia.length
    let downloadedCount = 0
    
    for (const msg of messagesWithMedia) {
      const url = msg.media_url || msg.file_url
      if (!url) continue
      
      const progress = 30 + Math.floor((downloadedCount / totalMedia) * 50)
      onProgress?.(progress, `Téléchargement des médias (${downloadedCount + 1}/${totalMedia})...`)
      
      const result = await downloadFileAsBase64(url)
      if (result) {
        mediaFiles.push({
          messageId: msg.id,
          type: msg.type || msg.media_type || 'file',
          fileName: msg.file_name || `media_${msg.id}`,
          mimeType: result.mimeType,
          data: result.data,
          size: msg.file_size || 0
        })
      }
      
      downloadedCount++
    }
  }

  onProgress?.(85, 'Finalisation de la sauvegarde...')

  const backupData: BackupData = {
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    userId,
    conversations: conversationsWithMembers,
    messages: messages || [],
    contacts: contacts || [],
    profile,
    settings,
    mediaFiles: mediaFiles.length > 0 ? mediaFiles : undefined
  }

  // Calculate size
  const jsonString = JSON.stringify(backupData)
  const size = new Blob([jsonString]).size

  onProgress?.(100, 'Sauvegarde terminée !')

  return { data: backupData, size }
}

// Export backup as encrypted file
export async function exportBackupAsFile(
  backupData: BackupData,
  encryptionPassword: string,
  filename?: string
): Promise<void> {
  const jsonString = JSON.stringify(backupData)
  const encrypted = await encryptData(jsonString, encryptionPassword)
  
  const blob = new Blob([encrypted], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const downloadFilename = filename || `nephtys-backup-${new Date().toISOString().split('T')[0]}.neph`
  
  return new Promise((resolve) => {
    // Use a safer download method that doesn't cause navigation
    const a = document.createElement('a')
    a.style.display = 'none'
    a.href = url
    a.download = downloadFilename
    
    // Append to body
    document.body.appendChild(a)
    
    // Trigger download
    a.click()
    
    // Clean up after a delay to ensure download has started
    setTimeout(() => {
      if (document.body.contains(a)) {
        document.body.removeChild(a)
      }
      URL.revokeObjectURL(url)
      resolve()
    }, 500)
  })
}

// Import backup from file
export async function importBackupFromFile(
  file: File,
  encryptionPassword: string
): Promise<BackupData | null> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    
    reader.onload = async (e) => {
      try {
        const encryptedData = e.target?.result as string
        const decrypted = await decryptData(encryptedData, encryptionPassword)
        
        if (!decrypted) {
          reject(new Error('Mot de passe incorrect ou fichier corrompu'))
          return
        }
        
        const backupData = JSON.parse(decrypted) as BackupData
        
        // Validate backup structure
        if (!backupData.version || !backupData.userId || !backupData.createdAt) {
          reject(new Error('Format de sauvegarde invalide'))
          return
        }
        
        resolve(backupData)
      } catch (error) {
        reject(new Error('Erreur lors de la lecture du fichier'))
      }
    }
    
    reader.onerror = () => reject(new Error('Erreur lors de la lecture du fichier'))
    reader.readAsText(file)
  })
}

// Helper function to upload a base64 file to Supabase storage
async function uploadBase64File(
  base64Data: string,
  fileName: string,
  mimeType: string,
  userId: string
): Promise<string | null> {
  try {
    // Convert base64 to blob
    const byteCharacters = atob(base64Data)
    const byteNumbers = new Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i)
    }
    const byteArray = new Uint8Array(byteNumbers)
    const blob = new Blob([byteArray], { type: mimeType })
    
    // Generate unique file path
    const ext = fileName.split('.').pop() || 'bin'
    const uniqueName = `restored/${userId}/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`
    
    // Upload to Supabase storage
    const { error } = await supabase.storage
      .from('media')
      .upload(uniqueName, blob, {
        contentType: mimeType,
        upsert: false
      })
    
    if (error) {
      console.error('Upload error:', error)
      return null
    }
    
    // Get public URL
    const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(uniqueName)
    return publicUrl
  } catch (error) {
    console.error('Error uploading file:', error)
    return null
  }
}

// Restore backup to database
export async function restoreBackup(
  backupData: BackupData,
  userId: string,
  onProgress?: (progress: number, status: string) => void
): Promise<{ success: boolean; error?: string }> {
  try {
    onProgress?.(0, 'Vérification de la sauvegarde...')

    // Verify backup belongs to user or is being restored to same user
    if (backupData.userId !== userId) {
      // For now, we only allow restoring to the same user
      // In the future, we could support migration
      return { success: false, error: 'Cette sauvegarde appartient à un autre utilisateur' }
    }

    onProgress?.(5, 'Restauration du profil...')
    
    // Update profile
    if (backupData.profile) {
      await supabase
        .from('profiles')
        .update({
          display_name: backupData.profile.display_name,
          bio: backupData.profile.bio,
          avatar_url: backupData.profile.avatar_url
        })
        .eq('id', userId)
    }

    onProgress?.(10, 'Restauration des contacts...')
    
    // Restore contacts (upsert to avoid duplicates)
    if (backupData.contacts && backupData.contacts.length > 0) {
      for (const contact of backupData.contacts) {
        await supabase
          .from('contacts')
          .upsert({
            user_id: userId,
            contact_id: contact.contact_id,
            nickname: contact.nickname,
            is_blocked: contact.is_blocked,
            is_favorite: contact.is_favorite
          }, {
            onConflict: 'user_id,contact_id'
          })
      }
    }

    onProgress?.(15, 'Restauration des conversations...')
    
    // Note: Conversations and messages are more complex to restore
    // because they involve multiple users. For now, we'll skip
    // restoring conversations that don't exist anymore.
    // The messages will be restored only if the conversation exists.

    // Check which conversations still exist
    const conversationIds = backupData.conversations.map(c => c.id)
    const { data: existingConversations } = await supabase
      .from('conversations')
      .select('id')
      .in('id', conversationIds)

    const existingConvIds = new Set(existingConversations?.map(c => c.id) || [])

    // Upload media files if present
    const mediaUrlMap = new Map<string, string>() // messageId -> new URL
    
    if (backupData.mediaFiles && backupData.mediaFiles.length > 0) {
      onProgress?.(20, 'Restauration des fichiers médias...')
      
      const totalMedia = backupData.mediaFiles.length
      let uploadedCount = 0
      
      for (const mediaFile of backupData.mediaFiles) {
        const progress = 20 + Math.floor((uploadedCount / totalMedia) * 40)
        onProgress?.(progress, `Upload des médias (${uploadedCount + 1}/${totalMedia})...`)
        
        const newUrl = await uploadBase64File(
          mediaFile.data,
          mediaFile.fileName,
          mediaFile.mimeType,
          userId
        )
        
        if (newUrl) {
          mediaUrlMap.set(mediaFile.messageId, newUrl)
        }
        
        uploadedCount++
      }
    }

    onProgress?.(65, 'Restauration des messages...')
    
    // Restore messages for existing conversations
    // We use upsert to avoid duplicates
    const messagesToRestore = backupData.messages.filter(m => existingConvIds.has(m.conversation_id))
    
    if (messagesToRestore.length > 0) {
      // Batch insert messages (100 at a time)
      const batchSize = 100
      for (let i = 0; i < messagesToRestore.length; i += batchSize) {
        const batch = messagesToRestore.slice(i, i + batchSize)
        await supabase
          .from('messages')
          .upsert(batch.map(m => {
            // Use restored media URL if available
            const restoredUrl = mediaUrlMap.get(m.id)
            return {
              id: m.id,
              conversation_id: m.conversation_id,
              sender_id: m.sender_id,
              content: m.content,
              type: m.type,
              media_url: restoredUrl || m.media_url,
              media_type: m.media_type,
              file_name: m.file_name,
              file_size: m.file_size,
              file_url: restoredUrl || m.file_url,
              reply_to_id: m.reply_to_id,
              is_edited: m.is_edited,
              is_deleted: m.is_deleted,
              created_at: m.created_at
            }
          }), {
            onConflict: 'id'
          })
        
        const progress = 65 + Math.floor((i / messagesToRestore.length) * 30)
        onProgress?.(progress, `Restauration des messages (${i + batch.length}/${messagesToRestore.length})...`)
      }
    }

    onProgress?.(95, 'Finalisation...')

    // Save backup settings
    if (backupData.settings) {
      saveBackupSettings(backupData.settings)
    }

    onProgress?.(100, 'Restauration terminée !')

    return { success: true }
  } catch (error: any) {
    console.error('Restore error:', error)
    return { success: false, error: error.message || 'Erreur lors de la restauration' }
  }
}

// Calculate estimated backup size
export async function estimateBackupSize(
  userId: string,
  settings: BackupSettings
): Promise<number> {
  const { data: memberData } = await supabase
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', userId)

  const conversationIds = memberData?.map(m => m.conversation_id) || []

  if (conversationIds.length === 0) return 0

  // Get all messages with media to calculate size based on settings
  const { data: messages } = await supabase
    .from('messages')
    .select('type, media_type, file_size')
    .in('conversation_id', conversationIds)
    .not('file_size', 'is', null)

  // Calculate media size based on settings
  let mediaSize = 0
  if (messages) {
    for (const msg of messages) {
      const type = msg.type || msg.media_type
      const size = msg.file_size || 0
      
      // Check if this type should be included based on settings
      if (type === 'image' && settings.includeImages) {
        mediaSize += size
      } else if (type === 'video' && settings.includeVideos) {
        mediaSize += size
      } else if ((type === 'audio' || type === 'voice') && settings.includeAudio) {
        mediaSize += size
      } else if (type === 'file' && settings.includeFiles) {
        mediaSize += size
      }
    }
  }
  
  // Estimate text content size more accurately
  // Average message is about 100 bytes (including metadata in JSON)
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .in('conversation_id', conversationIds)

  const textSize = (count || 0) * 100 // ~100 bytes per message (more realistic)
  
  // Add overhead for JSON structure, conversations, contacts, profile (~50KB)
  const overhead = 50 * 1024

  return mediaSize + textSize + overhead
}

// Check if backup is needed based on frequency
export function isBackupNeeded(settings: BackupSettings): boolean {
  if (!settings.lastBackupDate) return true

  const lastBackup = new Date(settings.lastBackupDate)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - lastBackup.getTime()) / (1000 * 60 * 60 * 24))

  switch (settings.frequency) {
    case 'daily':
      return diffDays >= 1
    case 'weekly':
      return diffDays >= 7
    case 'monthly':
      return diffDays >= 30
    default:
      return false
  }
}