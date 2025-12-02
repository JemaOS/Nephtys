import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://imkfbalgviqeotpjogff.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlta2ZiYWxndmlxZW90cGpvZ2ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0NjE2NjYsImV4cCI6MjA4MDAzNzY2Nn0.POv8NbJu6TefE1e-J-9L8m5QTSp41XXwsO2ck69GnYc'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Database types
export interface Profile {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  session_id: string
  public_key: string | null
  created_at: string
  updated_at: string
  // Online presence fields
  is_online?: boolean
  last_seen?: string | null
}

export interface Conversation {
  id: string
  type: 'direct' | 'group'
  name: string | null
  avatar_url: string | null
  description: string | null
  created_by: string
  created_at: string
  updated_at: string
  last_message_at: string | null
  is_encrypted: boolean
  encryption_protocol: string
  is_archived: boolean
  is_pinned: boolean
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  content: string
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'call'
  status: 'sent' | 'delivered' | 'read'
  reply_to_id: string | null
  file_url: string | null
  file_name: string | null
  file_size: number | null
  media_url: string | null
  media_type: 'image' | 'video' | 'file' | null
  media_width?: number | null // Image/video width in pixels
  media_height?: number | null // Image/video height in pixels
  media_thumbnail?: string | null // Base64 blur placeholder for images
  is_ephemeral: boolean
  ephemeral_duration: number | null
  ephemeral_expires_at: string | null
  encryption_metadata: any
  created_at: string
  updated_at: string
  deleted_at: string | null
  is_pinned: boolean
  pinned_at: string | null
  pinned_until: string | null
  is_starred: boolean
  edited_at: string | null
  is_edited: boolean
  link_preview: string | null // JSON string containing LinkPreviewData
}

export interface Contact {
  id: string
  user_id: string
  contact_user_id: string
  nickname: string | null
  is_favorite: boolean
  is_blocked: boolean
  added_at: string
}

export interface Status {
  id: string
  user_id: string
  type: 'text' | 'image' | 'video'
  content: string | null
  media_url: string | null
  background_color: string | null
  created_at: string
  expires_at: string
  views_count: number
  is_private: boolean
}

export interface Device {
  id: string
  user_id: string
  device_name: string
  device_type: 'mobile' | 'desktop' | 'tablet' | 'web'
  device_fingerprint: string
  public_key: string | null
  last_active_at: string
  created_at: string
  is_verified: boolean
}

export interface DeletedMessage {
  id: string
  message_id: string
  user_id: string
  deleted_at: string
}
