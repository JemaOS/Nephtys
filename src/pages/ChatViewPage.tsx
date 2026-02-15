// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/context/ThemeContext'
import { MainLayout } from '@/components/MainLayout'
import { supabase, Message, Conversation, Profile } from '@/lib/supabase'
import { useUserPresence } from '@/hooks/usePresence'
import { ArrowLeft, Send, Phone, Video, MoreVertical, Search, Smile, Mic, Plus, Reply, UserPlus, Archive, Trash2, Bell, BellOff, Lock, Star, Forward, Pin, Info, Share2, Copy } from 'lucide-react'
import { EmojiPicker } from '@/components/EmojiPicker'
import { MessageReactions } from '@/components/MessageReactions'
import { MessageReply } from '@/components/MessageReply'
import { MessageSearch } from '@/components/MessageSearch'
import { EphemeralMessageToggle } from '@/components/EphemeralMessageToggle'
import { MediaUploader } from '@/components/MediaUploader'
import { MediaMessage } from '@/components/MediaMessage'
import { MediaViewer } from '@/components/MediaViewer'
import { VoiceRecorder } from '@/components/VoiceRecorder'
import { VoiceMessage } from '@/components/VoiceMessage'
import { AudioFilePlayer } from '@/components/AudioFilePlayer'
import { ConversationInfo } from '@/components/ConversationInfo'
import { useMessageReactions } from '@/hooks/useMessageReactions'
import { useCall } from '@/context/CallContext'
import { useNotifications } from '@/hooks/useNotifications'
import { MessageContextMenu } from '@/components/MessageContextMenu'
import { MessageHoverActions } from '@/components/MessageHoverActions'
import { ChatBackgroundContextMenu } from '@/components/ChatBackgroundContextMenu'
import { SelectionModeToolbar } from '@/components/SelectionModeToolbar'
import { useIsMobile } from '@/hooks/use-mobile'
import { LinkPreview, LinkPreviewSkeleton } from '@/components/LinkPreview'
import { LinkPreviewData, getFirstPreviewUrl, fetchLinkPreview, debounce } from '@/lib/linkPreview'
import { PinMessageDialog } from '@/components/PinMessageDialog'
import { PinnedMessageBanner } from '@/components/PinnedMessageBanner'
import { DeleteMessageDialog } from '@/components/DeleteMessageDialog'
import { ForwardMessageModal } from '@/components/ForwardMessageModal'
import { QuickReactionBar } from '@/components/QuickReactionBar'
import { CallMessage } from '@/components/CallMessage'
import { MessageItem } from '@/components/MessageItem'
import { ChatHeader, CallLog, TimelineItem, MessageList } from './ChatViewPageComponents'
import { getCachedConversation, getCachedMessages, getCachedProfile, cacheConversation, cacheMessages, cacheProfile } from '@/lib/localCache'

// Utility function to detect emoji-only messages (1-3 emojis without other text)
// Uses a comprehensive regex pattern to match emojis including compound emojis
const isEmojiOnly = (text: string): { isEmoji: boolean; emojiCount: number } => {
  if (!text || text.trim() === '') return { isEmoji: false, emojiCount: 0 }
  
  const trimmed = text.trim()
  
  // Comprehensive emoji regex that matches:
  // - Basic emojis with optional variation selector
  // - Emojis with skin tone modifiers
  // - ZWJ sequences (family, profession emojis, etc.)
  // - Flag emojis (regional indicators)
  // - Keycap emojis
  const emojiPattern = /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F?|\p{Regional_Indicator}{2}|[\u0023\u002A\u0030-\u0039]\uFE0F?\u20E3)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F?))*(?:\p{Emoji_Modifier})?/gu
  
  // Find all emojis in the text
  const emojis = trimmed.match(emojiPattern)
  
  if (!emojis) return { isEmoji: false, emojiCount: 0 }
  
  // Check if the entire string is just emojis (with optional whitespace between)
  const emojiString = emojis.join('')
  const textWithoutWhitespace = trimmed.replace(/\s/g, '')
  
  // If the text without whitespace equals the joined emojis, it's emoji-only
  if (textWithoutWhitespace === emojiString && emojis.length >= 1 && emojis.length <= 3) {
    return { isEmoji: true, emojiCount: emojis.length }
  }
  
  return { isEmoji: false, emojiCount: 0 }
}

// Get emoji size class based on count
const getEmojiSizeClass = (count: number): string => {
  if (count === 1) return 'emoji-single' // Will be styled with CSS
  if (count === 2) return 'emoji-double'
  return 'emoji-triple'
}

// Cache helpers for instant display
const CACHE_PREFIX = 'anu_cache_'
const CACHE_EXPIRY = 5 * 60 * 1000 // 5 minutes

const getCache = <T,>(key: string): T | null => {
  try {
    const cached = localStorage.getItem(CACHE_PREFIX + key)
    if (cached) {
      const { data, timestamp } = JSON.parse(cached)
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        return data as T
      }
    }
  } catch (e) {
    // Ignore cache errors
  }
  return null
}

const setCache = <T,>(key: string, data: T) => {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
      data,
      timestamp: Date.now()
    }))
  } catch (e) {
    // Ignore cache errors (quota exceeded, etc.)
  }
}

// Extract call error handling to reduce complexity in handleStartVideoCall and handleStartAudioCall
const getCallErrorMessage = (error: any): string => {
  if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
    return '❌ Permissions refusées\n\nVeuillez autoriser l\'accès à votre caméra et microphone dans les paramètres de votre navigateur pour passer des appels vidéo.'
  }
  if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
    return '❌ Aucun appareil trouvé\n\nAucune caméra ou microphone n\'a été détecté sur votre appareil.'
  }
  if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
    return '❌ Appareil occupé\n\nVotre caméra ou microphone est déjà utilisé par une autre application.'
  }
  return '❌ Erreur\n\nImpossible de démarrer l\'appel vidéo. Vérifiez vos permissions et réessayez.'
}

// Helper to get audio call error message
const getAudioCallErrorMessage = (error: any): string => {
  if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
    return '❌ Permission refusée\n\nVeuillez autoriser l\'accès à votre microphone dans les paramètres de votre navigateur pour passer des appels audio.'
  }
  if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
    return '❌ Aucun microphone trouvé\n\nAucun microphone n\'a été détecté sur votre appareil.'
  }
  if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
    return '❌ Microphone occupé\n\nVotre microphone est déjà utilisé par une autre application.'
  }
  return '❌ Erreur\n\nImpossible de démarrer l\'appel audio. Vérifiez vos permissions et réessayez.'
}

// Helper to request media permissions and get stream
const requestMediaPermissions = async (video: boolean): Promise<MediaStream | null> => {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video })
  } catch {
    return null
  }
}

// Extract video call handler logic to reduce complexity
const startVideoCall = async (
  conversationId: string,
  conversationType: string | undefined,
  otherUser: Profile | null,
  startGroupCall: Function,
  startCall: Function
): Promise<void> => {
  if (!conversationId) return
  
  if (conversationType === 'group') {
    const stream = await requestMediaPermissions(true)
    if (stream) stream.getTracks().forEach(track => track.stop())
    await startGroupCall(conversationId, { audio: true, video: true })
    return
  }
  
  if (!otherUser) return
  
  const stream = await requestMediaPermissions(true)
  if (stream) stream.getTracks().forEach(track => track.stop())
  await startCall(otherUser.id, conversationId, { audio: true, video: true })
}

// Extract audio call handler logic to reduce complexity
const startAudioCall = async (
  conversationId: string,
  conversationType: string | undefined,
  otherUser: Profile | null,
  startGroupCall: Function,
  startCall: Function
): Promise<void> => {
  if (!conversationId) return
  
  if (conversationType === 'group') {
    const stream = await requestMediaPermissions(false)
    if (stream) stream.getTracks().forEach(track => track.stop())
    await startGroupCall(conversationId, { audio: true, video: false })
    return
  }
  
  if (!otherUser) return
  
  const stream = await requestMediaPermissions(false)
  if (stream) stream.getTracks().forEach(track => track.stop())
  await startCall(otherUser.id, conversationId, { audio: true, video: false })
}

export function ChatViewPage() {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  
  // Initialize state from IndexedDB cache for instant display (like WhatsApp)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [callLogs, setCallLogs] = useState<CallLog[]>([])
  const [filteredMessages, setFilteredMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true) // Start with loading true, will set false after cache check
  const [sending, setSending] = useState(false)
  const [otherUser, setOtherUser] = useState<Profile | null>(null)
  const [initialDataLoaded, setInitialDataLoaded] = useState(false)
  // Map of group member profiles (user_id -> Profile) for group conversations
  const [groupMemberProfiles, setGroupMemberProfiles] = useState<Map<string, Profile>>(new Map())
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null)
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [ephemeralDuration, setEphemeralDuration] = useState<number | null>(null)
  const [showMediaUploader, setShowMediaUploader] = useState(false)
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false)
  const [showConversationMenu, setShowConversationMenu] = useState(false)
  const [showConversationInfo, setShowConversationInfo] = useState(false)
  const [showAddMemberModal, setShowAddMemberModal] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    message: Message | null;
  }>({ isOpen: false, position: { x: 0, y: 0 }, message: null })
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set())
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [showSelectionMenu, setShowSelectionMenu] = useState(false)
  const [backgroundContextMenu, setBackgroundContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
  }>({ isOpen: false, position: { x: 0, y: 0 } })
  const [linkPreview, setLinkPreview] = useState<LinkPreviewData | null>(null)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [dismissedPreviewUrl, setDismissedPreviewUrl] = useState<string | null>(null)
  const [showPinDialog, setShowPinDialog] = useState(false)
  const [messageToPin, setMessageToPin] = useState<Message | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [messageToDelete, setMessageToDelete] = useState<Message | null>(null)
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false)
  const [deletedForMeIds, setDeletedForMeIds] = useState<Set<string>>(new Set())
  const [showForwardModal, setShowForwardModal] = useState(false)
  const [messageToForward, setMessageToForward] = useState<Message | null>(null)
  const [quickReactionBar, setQuickReactionBar] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    message: Message | null;
  }>({ isOpen: false, position: { x: 0, y: 0 }, message: null })
  const [gifStickerViewer, setGifStickerViewer] = useState<{
    isOpen: boolean;
    url: string;
    type: 'gif' | 'sticker';
    senderName: string;
    senderAvatar?: string;
    timestamp: string;
    isOwn: boolean;
    messageId: string;
  } | null>(null)
  
  // State for media viewer with navigation support
  const [mediaViewerState, setMediaViewerState] = useState<{
    isOpen: boolean;
    currentIndex: number;
  }>({ isOpen: false, currentIndex: 0 })
  const [pinnedMessage, setPinnedMessage] = useState<{
    id: string;
    content: string;
    sender_name: string;
    pinned_at: string;
    pinned_until: string;
  } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const longPressMessageRef = useRef<Message | null>(null)
  
  const { reactions, addReaction, removeReaction } = useMessageReactions(conversationId || '')
  const { startCall, startGroupCall } = useCall()
  const { permission, requestPermission, sendNotification, subscribeToConversation, unsubscribeFromConversation } = useNotifications()
  const { wallpaper } = useTheme()
  const isMobile = useIsMobile()

  // Load data from IndexedDB first (instant), then sync with Supabase in background
  useEffect(() => {
    if (!conversationId || initialDataLoaded) return

    const loadFromCache = async () => {
      try {
        // Try to load from IndexedDB first for instant display
        const [cachedConv, cachedMsgs, cachedUser] = await Promise.all([
          getCachedConversation(conversationId),
          getCachedMessages(conversationId),
          user ? getCachedProfile(user.id) : Promise.resolve(null)
        ])

        // Apply cached data immediately for instant display
        if (cachedConv) {
          console.log('[ChatViewPage] Loaded conversation from IndexedDB cache')
          setConversation(cachedConv)
          
          // Also load other user for direct conversations
          if (cachedConv.type === 'direct') {
            const memberIds = await import('@/lib/supabase').then(async (supabase) => {
              const { data } = await supabase.supabase
                .from('conversation_members')
                .select('user_id')
                .eq('conversation_id', conversationId)
                .neq('user_id', user?.id)
              return data?.map(m => m.user_id) || []
            })
            if (memberIds.length > 0) {
              const otherProfile = await getCachedProfile(memberIds[0])
              if (otherProfile) {
                setOtherUser(otherProfile)
              }
            }
          }
        }

        if (cachedMsgs && cachedMsgs.length > 0) {
          console.log('[ChatViewPage] Loaded', cachedMsgs.length, 'messages from IndexedDB cache')
          setMessages(cachedMsgs)
          setLoading(false) // Show content immediately from cache
        } else {
          // No cache - will show skeleton until data loads
          setLoading(true)
        }

        setInitialDataLoaded(true)

        // Now sync with Supabase in background
        loadConversation()
        loadMessages()
      } catch (error) {
        console.error('[ChatViewPage] Error loading from cache:', error)
        setInitialDataLoaded(true)
        loadConversation()
        loadMessages()
      }
    }

    loadFromCache()
  }, [conversationId, user?.id])
  
  // Get real-time presence status for the other user
  const { statusText: otherUserStatusText, isOnline: otherUserIsOnline } = useUserPresence(otherUser?.id)
  
  const displayedMessages = filteredMessages.length > 0 ? filteredMessages : messages

  // Helper function to get sender info for a message (works for both direct and group conversations)
  const getSenderInfo = useCallback((senderId: string): { name: string; avatar?: string } => {
    // If it's the current user
    if (senderId === user?.id) {
      return {
        name: profile?.display_name || profile?.username || 'Vous',
        avatar: profile?.avatar_url
      }
    }
    
    // For group conversations, look up in groupMemberProfiles
    if (conversation?.type === 'group') {
      const memberProfile = groupMemberProfiles.get(senderId)
      if (memberProfile) {
        return {
          name: memberProfile.display_name || memberProfile.username || 'Utilisateur',
          avatar: memberProfile.avatar_url
        }
      }
    }
    
    // For direct conversations, use otherUser
    if (otherUser) {
      return {
        name: otherUser.display_name || otherUser.username || 'Utilisateur',
        avatar: otherUser.avatar_url
      }
    }
    
    // Fallback
    return { name: 'Utilisateur', avatar: undefined }
  }, [user?.id, profile, conversation?.type, groupMemberProfiles, otherUser])

  // Collect all media from messages for navigation in MediaViewer
  const allMediaItems = useMemo(() => {
    return messages
      .filter(m => {
        // Include image and video messages
        if (m.media_url && m.media_type && (m.media_type === 'image' || m.media_type === 'video') && m.type !== 'audio') {
          return true
        }
        // Include GIF messages
        if (m.type === 'text' && m.content && m.content.match(/^(?:\[Transféré\]\s*)?([\s\S]*?)\[GIF\]\(https?:\/\/[^\)]+\)$/)) {
          return true
        }
        // Include Sticker messages
        if (m.type === 'text' && m.content && m.content.match(/^(?:\[Transféré\]\s*)?([\s\S]*?)\[STICKER\]\(https?:\/\/[^\)]+\)$/)) {
          return true
        }
        return false
      })
      .map(m => {
        // Determine the media URL and type
        let mediaUrl = m.media_url || m.file_url || ''
        let mediaType: 'image' | 'video' | 'audio' | 'gif' | 'sticker' = 'image'
        
        if ((m.media_url || m.file_url) && (m.media_type || m.type)) {
          mediaUrl = m.media_url || m.file_url || ''
          mediaType = (m.media_type || m.type) as 'image' | 'video'
        } else if (m.content) {
          const gifMatch = m.content.match(/^(?:\[Transféré\]\s*)?([\s\S]*?)\[GIF\]\((https?:\/\/[^\)]+)\)$/)
          const stickerMatch = m.content.match(/^(?:\[Transféré\]\s*)?([\s\S]*?)\[STICKER\]\((https?:\/\/[^\)]+)\)$/)
          if (gifMatch) {
            mediaUrl = gifMatch[2]
            mediaType = 'gif'
          } else if (stickerMatch) {
            mediaUrl = stickerMatch[2]
            mediaType = 'sticker'
          }
        }
        
        const senderInfo = getSenderInfo(m.sender_id)
        
        return {
          url: mediaUrl,
          type: mediaType,
          senderName: senderInfo.name,
          senderAvatar: senderInfo.avatar,
          timestamp: m.created_at,
          isOwn: m.sender_id === user?.id,
          messageId: m.id,
        }
      })
  }, [messages, user?.id, getSenderInfo])

  // Handler for media navigation
  const handleMediaNavigate = useCallback((index: number) => {
    if (index >= 0 && index < allMediaItems.length) {
      setMediaViewerState({ isOpen: true, currentIndex: index })
    }
  }, [allMediaItems.length])

  // Get current media index for a message
  const getMediaIndexForMessage = useCallback((messageId: string) => {
    return allMediaItems.findIndex(m => m.messageId === messageId)
  }, [allMediaItems])

  const getWallpaperStyle = () => {
    switch (wallpaper) {
      case 'dark':
        return { backgroundColor: '#000000' }
      case 'light':
        return { backgroundColor: '#e5ddd5' }
      case 'gradient':
        return { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }
      case 'custom':
        return { backgroundColor: '#1a1a2e' }
      default:
        return {} // Use CSS variable from bg-primary instead of hardcoded color
    }
  }

  // Load call logs for this conversation
  const loadCallLogs = async () => {
    if (!conversationId) return
    
    console.log('[ChatViewPage] Loading call logs for conversation:', conversationId)
    
    const { data, error } = await supabase
      .from('call_logs')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('started_at', { ascending: true })
    
    console.log('[ChatViewPage] Call logs query result:', { data, error, count: data?.length })
    console.log('[ChatViewPage] Call logs raw data:', JSON.stringify(data, null, 2))
    
    if (error) {
      console.error('[ChatViewPage] Error loading call logs:', error)
    }
    
    if (!error && data) {
      setCallLogs(data)
      console.log('[ChatViewPage] Call logs set:', data.length, 'logs')
      
      // Debug: Log each call log
      data.forEach((log, index) => {
        console.log(`[ChatViewPage] Call log ${index}:`, {
          id: log.id,
          caller_id: log.caller_id,
          callee_id: log.callee_id,
          status: log.status,
          type: log.type,
          isGroupCall: log.caller_id === log.callee_id
        })
      })
    }
  }

  // Merge messages and call logs into a unified timeline
  const timelineItems = useMemo((): TimelineItem[] => {
    const items: TimelineItem[] = []
    
    // Add messages to timeline
    for (const message of displayedMessages) {
      items.push({
        type: 'message',
        timestamp: message.created_at,
        data: message
      })
    }
    
    // Add call logs to timeline
    for (const call of callLogs) {
      items.push({
        type: 'call',
        timestamp: call.started_at,
        data: call
      })
    }
    
    // Sort by timestamp
    items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    
    return items
  }, [displayedMessages, callLogs])

  useEffect(() => {
    if (!conversationId || !user) return
    loadConversation()
    loadMessages()
    loadCallLogs()
    loadEphemeralSetting()
    if (permission === 'default') requestPermission()
    subscribeToConversation(conversationId)
    
    // Loading timeout - prevent infinite loading (max 10 seconds)
    const loadingTimeout = setTimeout(() => {
      setLoading(false)
    }, 10000)
    
    // Subscribe to call logs changes in real-time
    const callLogsChannel = supabase
      .channel(`call_logs:${conversationId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'call_logs',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        console.log('[ChatViewPage] Call log change detected:', payload.eventType, payload)
        console.log('[ChatViewPage] Call log payload.new:', payload.new)
        // Reload call logs when any change occurs
        loadCallLogs()
      })
      .subscribe((status) => {
        console.log('[ChatViewPage] Call logs channel subscription status:', status)
        if (status === 'SUBSCRIBED') {
          console.log('[ChatViewPage] Successfully subscribed to call_logs changes for conversation:', conversationId)
        }
      })
    
    const messagesChannel = supabase
      .channel(`messages:${conversationId}`, {
        config: {
          broadcast: { self: true },
          presence: { key: user?.id || 'anonymous' }
        }
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        console.log('[ChatViewPage] Realtime INSERT received:', payload.new?.id)
        const newMsg = payload.new as Message
        
        // Check for temp message to replace
        const tempIndex = messages.findIndex(m =>
          m.id.startsWith('temp-') &&
          m.media_url === newMsg.media_url &&
          m.sender_id === newMsg.sender_id
        )

        // Use helper to update messages
        setMessages(prev => getUpdatedMessages(prev, newMsg, tempIndex))
        
        // Handle notification if not own message
        if (newMsg.sender_id !== user.id) {
          handleNewMessageNotification(newMsg, newMsg.sender_id)
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        console.log('[ChatViewPage] Realtime UPDATE received:', payload.new?.id)
        const updatedMsg = payload.new as Message
        setMessages(prev => updateMessageInList(prev, updatedMsg))
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        console.log('[ChatViewPage] Realtime DELETE received:', payload.old?.id)
        const deletedId = (payload.old as any)?.id
        if (deletedId) {
          setMessages(prev => removeMessageFromList(prev, deletedId))
        }
      })
      .subscribe((status) => {
        console.log('[ChatViewPage] Messages channel subscription status:', status)
      })

    // Subscribe to profile changes for real-time avatar updates
    const profilesChannel = supabase
      .channel(`profiles-chat:${conversationId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles'
      }, (payload) => {
        console.log('Profile updated in ChatViewPage:', payload)
        // Si c'est le profil de l'autre utilisateur, le mettre à jour
        if (otherUser && payload.new.id === otherUser.id) {
          setOtherUser(payload.new as Profile)
        }
        // Recharger aussi la conversation pour les groupes
        loadConversation()
      })
      .subscribe()

    // Handle visibility change - refresh data when app comes back to foreground
    // This is critical for PWA on mobile where the app may be suspended
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[ChatViewPage] App became visible, refreshing data...')
        // Reload messages when app becomes visible again
        loadMessages()
        loadConversation()
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    // Handle Supabase reconnection event (triggered by useSupabaseReconnect hook)
    const handleSupabaseReconnect = () => {
      console.log('[ChatViewPage] Supabase reconnected, reloading messages...')
      loadMessages()
      loadConversation()
    }
    
    window.addEventListener('supabase-reconnected', handleSupabaseReconnect)
    
    // Handle call log created event (triggered by CallContext when a call log is created)
    const handleCallLogCreated = (event: CustomEvent) => {
      console.log('[ChatViewPage] Call log created event received:', event.detail)
      if (event.detail.conversationId === conversationId) {
        console.log('[ChatViewPage] Reloading call logs for this conversation')
        loadCallLogs()
      }
    }
    
    window.addEventListener('call-log-created', handleCallLogCreated as EventListener)

    return () => {
      clearTimeout(loadingTimeout)
      supabase.removeChannel(callLogsChannel)
      supabase.removeChannel(messagesChannel)
      supabase.removeChannel(profilesChannel)
      unsubscribeFromConversation(conversationId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('supabase-reconnected', handleSupabaseReconnect)
      window.removeEventListener('call-log-created', handleCallLogCreated as EventListener)
    }
  }, [conversationId, user?.id, permission, otherUser?.id])

  // Track previous message count to detect new messages
  const prevMessageCountRef = useRef(0)
  const hasScrolledInitially = useRef(false)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  
  // Reset initial scroll flag when conversation changes - MUST run before scroll effect
  useLayoutEffect(() => {
    hasScrolledInitially.current = false
    prevMessageCountRef.current = 0
  }, [conversationId])

  // Scroll to bottom INSTANTLY when conversation loads (initial load)
  // Like WhatsApp/Telegram: scroll instantly, no animation, no delay
  useLayoutEffect(() => {
    // Only run when messages are loaded and we haven't scrolled yet for this conversation
    if (loading || !conversationId) return
    if (messages.length === 0) return
    if (hasScrolledInitially.current) return
    
    hasScrolledInitially.current = true
    
    // Timeout to ensure all content (including images) has been laid out
    // Increased to 150ms to handle image loading better
    const timeoutId = setTimeout(() => {
      if (messagesContainerRef.current) {
        // Scroll to the absolute bottom of the container
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
      }
    }, 150)

    // Secondary scroll attempt to catch late rendering (e.g. images)
    const timeoutId2 = setTimeout(() => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
      }
    }, 300)
    
    prevMessageCountRef.current = messages.length
    
    return () => {
      clearTimeout(timeoutId)
      clearTimeout(timeoutId2)
    }
  }, [loading, messages.length, conversationId])
  
  // Handle new messages with smooth scroll (after initial load)
  useEffect(() => {
    if (!loading && messages.length > 0 && hasScrolledInitially.current) {
      if (messages.length > prevMessageCountRef.current) {
        // New message added - scroll smoothly
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        prevMessageCountRef.current = messages.length
      }
    }
  }, [loading, messages.length])
  
  const scrollToBottom = (behavior: 'smooth' | 'instant' = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  // Fermer l'emoji picker si on clique en dehors
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false)
      }
    }

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showEmojiPicker])

  // Debounced function to fetch link preview
  const debouncedFetchPreview = useCallback(
    debounce(async (url: string) => {
      setIsLoadingPreview(true)
      const preview = await fetchLinkPreview(url)
      setLinkPreview(preview)
      setIsLoadingPreview(false)
    }, 500),
    []
  )

  // Effect to detect URLs in input and fetch preview
  useEffect(() => {
    const url = getFirstPreviewUrl(newMessage)
    
    if (url && url !== dismissedPreviewUrl) {
      // Only fetch if URL changed
      if (!linkPreview || linkPreview.url !== url) {
        debouncedFetchPreview(url)
      }
    } else if (!url) {
      setLinkPreview(null)
      setIsLoadingPreview(false)
    }
  }, [newMessage, dismissedPreviewUrl])

  // Reset dismissed URL when message is cleared
  useEffect(() => {
    if (!newMessage.trim()) {
      setDismissedPreviewUrl(null)
    }
  }, [newMessage])

  const handleDismissPreview = () => {
    if (linkPreview) {
      setDismissedPreviewUrl(linkPreview.url)
    }
    setLinkPreview(null)
    setIsLoadingPreview(false)
  }

  const handleEmojiSelect = (emoji: string) => {
    setNewMessage(prev => prev + emoji)
    setShowEmojiPicker(false)
  }

  // Extract group member loading to helper function
  const loadGroupMembers = async (convId: string): Promise<Map<string, Profile>> => {
    const { data: members } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', convId)
    
    if (members && members.length > 0) {
      const memberIds = members.map(m => m.user_id)
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', memberIds)
      
      if (profiles) {
        const profileMap = new Map<string, Profile>()
        profiles.forEach(p => profileMap.set(p.id, p))
        return profileMap
      }
    }
    return new Map()
  }

  // Extract direct conversation user loading to helper function
  const loadDirectConversationUser = async (convId: string, userId: string): Promise<Profile | null> => {
    const { data: allMembers } = await supabase.from('conversation_members').select('user_id').eq('conversation_id', convId)
    
    // Check if this is a "Saved Messages" conversation (only one member = self)
    if (allMembers && allMembers.length === 1 && allMembers[0].user_id === userId) {
      const { data: selfProfile } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
      return selfProfile
    }
    
    // Normal direct conversation - find the other user
    const { data: members } = await supabase.from('conversation_members').select('user_id').eq('conversation_id', convId).neq('user_id', userId)
    if (members && members.length > 0) {
      const { data: otherUserData } = await supabase.from('profiles').select('*').eq('id', members[0].user_id).maybeSingle()
      return otherUserData
    }
    return null
  }

  const loadConversation = async () => {
    const { data, error } = await supabase.from('conversations').select('*').eq('id', conversationId!).maybeSingle()
    if (!error && data) {
      setConversation(data)
      // Cache to both localStorage and IndexedDB
      setCache(`conv_${conversationId}`, data)
      await cacheConversation(data)
      
      if (data.type === 'group') {
        const profileMap = await loadGroupMembers(conversationId!)
        setGroupMemberProfiles(profileMap)
        // Cache group member profiles
        profileMap.forEach(p => cacheProfile(p))
      } else if (data.type === 'direct') {
        const otherUserData = await loadDirectConversationUser(conversationId!, user!.id)
        if (otherUserData) {
          setOtherUser(otherUserData)
          setCache(`user_${conversationId}`, otherUserData)
          await cacheProfile(otherUserData)
        }
      }
    }
  }

  // Fonction pour rafraîchir la conversation (appelée après upload de photo)
  const refreshConversation = () => {
    loadConversation()
  }

  const loadMessages = async () => {
    // Don't set loading to true if we already have cached messages (instant display)
    const hasCachedMessages = messages.length > 0
    if (!hasCachedMessages) {
      setLoading(true)
    }
    
    const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', conversationId!).is('deleted_at', null).order('created_at', { ascending: true }).limit(100)
    if (!error && data) {
      setMessages(data)
      // Cache to both localStorage and IndexedDB
      setCache(`msgs_${conversationId}`, data)
      await cacheMessages(data, conversationId!)
      setFilteredMessages([])
      if (user) {
        const unreadMessages = data.filter(msg => msg.sender_id !== user.id && msg.status !== 'read')
        if (unreadMessages.length > 0) {
          await supabase.from('messages').update({ status: 'read' }).in('id', unreadMessages.map(msg => msg.id))
        }
      }
    }
    setLoading(false)
  }

  const updateMessageStatus = async (messageId: string, status: 'delivered' | 'read') => {
    await supabase.from('messages').update({ status }).eq('id', messageId)
  }

  // Helper to add or replace a message in the list (extracted to reduce complexity)
  const getUpdatedMessages = (currentMessages: Message[], newMsg: Message, tempIndex: number): Message[] => {
    if (tempIndex !== -1) {
      console.log('[ChatViewPage] Replacing temp message with real one:', newMsg.id)
      const newMessages = [...currentMessages]
      newMessages[tempIndex] = newMsg
      return newMessages
    }
    console.log('[ChatViewPage] Adding new message:', newMsg.id)
    return [...currentMessages, newMsg]
  }

  // Helper to update a message in the list
  const updateMessageInList = (currentMessages: Message[], updatedMsg: Message): Message[] => {
    return currentMessages.map(m => m.id === updatedMsg.id ? updatedMsg : m)
  }

  // Helper to remove a message from the list
  const removeMessageFromList = (currentMessages: Message[], deletedId: string): Message[] => {
    return currentMessages.filter(m => m.id !== deletedId)
  }

  // Helper to handle notifications for new messages (extracted to reduce complexity)
  const handleNewMessageNotification = async (newMsg: Message, senderId: string) => {
    await updateMessageStatus(newMsg.id, 'delivered')
    if (document.hidden && permission === 'granted') {
      const senderName = otherUser?.display_name || otherUser?.username || 'Quelqu\'un'
      const preview = newMsg.type === 'text' ? newMsg.content : '📎 Fichier'
      sendNotification(senderName, preview, { conversationId, messageId: newMsg.id, url: `/chat/${conversationId}` })
    }
  }

  // Load ephemeral setting from localStorage (since DB doesn't have this column)
  const loadEphemeralSetting = () => {
    if (!conversationId) return
    
    const storedSetting = localStorage.getItem(`ephemeral_${conversationId}`)
    if (storedSetting) {
      setEphemeralDuration(JSON.parse(storedSetting))
    } else {
      setEphemeralDuration(null)
    }
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !user || sending) return
    setSending(true)
    try {
      const messageData: any = {
        conversation_id: conversationId!, sender_id: user.id, content: newMessage.trim(),
        type: 'text', status: 'sent', reply_to_id: replyToMessage?.id || null,
      }
      
      // Add link preview data if available
      if (linkPreview) {
        messageData.link_preview = JSON.stringify({
          url: linkPreview.url,
          title: linkPreview.title,
          description: linkPreview.description,
          image: linkPreview.image,
          siteName: linkPreview.siteName,
          domain: linkPreview.domain,
        })
      }
      
      if (ephemeralDuration) {
        const expiresAt = new Date()
        expiresAt.setSeconds(expiresAt.getSeconds() + ephemeralDuration)
        messageData.is_ephemeral = true
        messageData.ephemeral_duration = ephemeralDuration
        messageData.ephemeral_expires_at = expiresAt.toISOString()
      }
      const { error } = await supabase.from('messages').insert(messageData).select()
      if (!error) {
        setNewMessage('')
        setReplyToMessage(null)
        setLinkPreview(null)
        setDismissedPreviewUrl(null)
        await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId!)
      }
    } finally { setSending(false) }
  }

  const handleMediaUploadComplete = async (
    url: string,
    type: 'image' | 'video' | 'file',
    fileName: string,
    fileSize: number,
    width?: number,
    height?: number,
    thumbnail?: string
  ) => {
    if (!user) return
    setSending(true)
    
    // Optimistic update
    const tempId = `temp-${Date.now()}`
    const optimisticMessage = {
      id: tempId,
      conversation_id: conversationId!,
      sender_id: user.id,
      content: newMessage.trim() || '',
      type,
      status: 'sent',
      created_at: new Date().toISOString(),
      media_url: url,
      media_type: type,
      file_name: fileName,
      file_size: fileSize,
      media_width: width,
      media_height: height,
      media_thumbnail: thumbnail,
      reply_to_id: replyToMessage?.id || null,
      is_starred: false,
      is_pinned: false,
    } as unknown as Message

    setMessages(prev => [...prev, optimisticMessage])
    setNewMessage('')
    setReplyToMessage(null)
    setShowMediaUploader(false)

    try {
      const messageData: any = {
        conversation_id: conversationId!, sender_id: user.id, content: optimisticMessage.content,
        type, status: 'sent', reply_to_id: optimisticMessage.reply_to_id,
        media_url: url, media_type: type, file_name: fileName, file_size: fileSize,
        file_url: url, // Fallback for older schema
      }
      
      // Add image dimensions if available
      if (width && height) {
        messageData.media_width = width
        messageData.media_height = height
      }
      if (thumbnail) {
        messageData.media_thumbnail = thumbnail
      }
      
      const { data, error } = await supabase.from('messages').insert(messageData).select().single()
      
      if (!error && data) {
        // Replace optimistic message with real one
        setMessages(prev => prev.map(m => m.id === tempId ? data : m))
        await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId!)
      } else {
        // Remove optimistic message on error
        setMessages(prev => prev.filter(m => m.id !== tempId))
        console.error('Error sending message:', error)
        alert('Erreur lors de l\'envoi du message')
      }
    } catch (err) {
      console.error('Error sending message:', err)
      setMessages(prev => prev.filter(m => m.id !== tempId))
      alert('Erreur lors de l\'envoi du message')
    } finally { setSending(false) }
  }

  const handleMultipleUploadComplete = async (files: any[]) => {
    if (!user) return
    setSending(true)
    
    const tempMessages: Message[] = []
    const now = Date.now()
    
    // Create optimistic messages
    files.forEach((file, index) => {
        const tempId = `temp-${now}-${index}`
        const optimisticMessage = {
          id: tempId,
          conversation_id: conversationId!,
          sender_id: user.id,
          content: '',
          type: file.type,
          status: 'sent',
          created_at: new Date().toISOString(),
          media_url: file.url,
          media_type: file.type,
          file_name: file.fileName,
          file_size: file.fileSize,
          media_width: file.width,
          media_height: file.height,
          media_thumbnail: file.thumbnail,
          reply_to_id: replyToMessage?.id || null,
          is_starred: false,
          is_pinned: false
        } as unknown as Message
        tempMessages.push(optimisticMessage)
    })
    
    // Update state immediately
    setMessages(prev => [...prev, ...tempMessages])
    setNewMessage('')
    setReplyToMessage(null)
    setShowMediaUploader(false)

    try {
      // Send each file as a separate message
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const tempId = tempMessages[i].id
        
        const messageData: any = {
          conversation_id: conversationId!,
          sender_id: user.id,
          content: '',
          type: file.type,
          status: 'sent',
          reply_to_id: replyToMessage?.id || null,
          media_url: file.url,
          media_type: file.type,
          file_name: file.fileName,
          file_size: file.fileSize,
          file_url: file.url, // Fallback for older schema
        }
        
        // Add image dimensions if available
        if (file.width && file.height) {
          messageData.media_width = file.width
          messageData.media_height = file.height
        }
        if (file.thumbnail) {
          messageData.media_thumbnail = file.thumbnail
        }
        
        const { data, error } = await supabase.from('messages').insert(messageData).select().single()
        
        if (!error && data) {
             setMessages(prev => prev.map(m => m.id === tempId ? data : m))
        } else {
            // Remove failed message
            setMessages(prev => prev.filter(m => m.id !== tempId))
        }
      }
      
      await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId!)
    } finally {
      setSending(false)
    }
  }

  const handleVoiceRecordingComplete = async (audioBlob: Blob, duration: number) => {
    if (!user) return
    setSending(true)
    
    // Close voice recorder immediately for better UX
    setShowVoiceRecorder(false)
    
    try {
      // Determine the correct file extension based on the blob's MIME type
      let fileExtension = 'webm'
      const mimeType = audioBlob.type
      if (mimeType.includes('ogg')) {
        fileExtension = 'ogg'
      } else if (mimeType.includes('mp4') || mimeType.includes('aac')) {
        fileExtension = 'm4a'
      } else if (mimeType.includes('webm')) {
        fileExtension = 'webm'
      }
      
      const fileName = `${user.id}/${Date.now()}.${fileExtension}`
      const { error: uploadError } = await supabase.storage.from('media').upload(fileName, audioBlob, {
        cacheControl: '3600',
        upsert: false,
        contentType: mimeType // Explicitly set the content type
      })
      if (uploadError) throw uploadError
      const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(fileName)
      
      const now = new Date().toISOString()
      const tempId = `temp-${Date.now()}`
      
      const messageData: any = {
        conversation_id: conversationId!, sender_id: user.id, content: '', type: 'audio', status: 'sent',
        reply_to_id: replyToMessage?.id || null, media_url: publicUrl, media_type: 'audio',
        file_name: `voice-${Date.now()}.${fileExtension}`, file_size: audioBlob.size,
        file_url: publicUrl, // Fallback for older schema
      }
      
      // Optimistic update - add message to local state immediately
      const optimisticMessage = {
        id: tempId,
        conversation_id: conversationId!,
        sender_id: user.id,
        content: '',
        type: 'audio',
        status: 'sent',
        created_at: now,
        media_url: publicUrl,
        media_type: 'audio',
        file_name: messageData.file_name,
        file_size: audioBlob.size,
        reply_to_id: replyToMessage?.id || null,
      } as unknown as Message
      
      setMessages(prev => [...prev, optimisticMessage])
      setReplyToMessage(null)
      
      // Insert into database
      const { data: insertedMessage, error } = await supabase.from('messages').insert(messageData).select().single()
      
      if (!error && insertedMessage) {
        // Replace optimistic message with real one
        setMessages(prev => prev.map(m => m.id === tempId ? insertedMessage : m))
        await supabase.from('conversations').update({ last_message_at: now }).eq('id', conversationId!)
      } else if (error) {
        // Remove optimistic message on error
        setMessages(prev => prev.filter(m => m.id !== tempId))
        alert('Erreur lors de l\'envoi du message vocal')
      }
    } catch (err) {
      alert('Erreur lors de l\'envoi du message vocal')
    } finally { setSending(false) }
  }

  const handleStartVideoCall = async () => {
    if (!conversationId) return
    
    // For group conversations, use group call
    if (conversation?.type === 'group') {
      try {
        // Request permissions before starting the call
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
        
        // Stop test stream
        stream.getTracks().forEach(track => track.stop())
        
        // Start group video call
        await startGroupCall(conversationId, { audio: true, video: true })
      } catch (error: any) {
        console.error('Error starting group video call:', error)
        alert(getCallErrorMessage(error))
      }
      return
    }
    
    if (!otherUser) return
    
    try {
      // Demander les permissions avant de démarrer l'appel
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      
      // Arrêter le stream de test
      stream.getTracks().forEach(track => track.stop())
      
      // Démarrer l'appel
      await startCall(otherUser.id, conversationId, { audio: true, video: true })
    } catch (error: any) {
      console.error('Error starting video call:', error)
      alert(getCallErrorMessage(error))
    }
  }

  const handleStartAudioCall = async () => {
    if (!conversationId) return
    
    // For group conversations, use group call
    if (conversation?.type === 'group') {
      try {
        // Request permissions before starting the call
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        
        // Stop test stream
        stream.getTracks().forEach(track => track.stop())
        
        // Start group audio call
        await startGroupCall(conversationId, { audio: true, video: false })
      } catch (error: any) {
        console.error('Error starting group audio call:', error)
        alert(getAudioCallErrorMessage(error))
      }
      return
    }
    
    if (!otherUser) return
    
    try {
      // Demander les permissions avant de démarrer l'appel
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      
      // Arrêter le stream de test
      stream.getTracks().forEach(track => track.stop())
      
      // Démarrer l'appel
      await startCall(otherUser.id, conversationId, { audio: true, video: false })
    } catch (error: any) {
      console.error('Error starting audio call:', error)
      alert(getAudioCallErrorMessage(error))
    }
  }

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  }

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent, message: Message) => {
    e.preventDefault()
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      message,
    })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu({ isOpen: false, position: { x: 0, y: 0 }, message: null })
  }, [])

  // Background context menu handlers (desktop only)
  const handleBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    // Only on desktop
    if (isMobile) return
    
    // Check if click is on the background, not on a message
    const target = e.target as HTMLElement
    const isOnMessage = target.closest('[data-message-id]')
    
    if (!isOnMessage) {
      e.preventDefault()
      // Close any open message context menu first
      setContextMenu({ isOpen: false, position: { x: 0, y: 0 }, message: null })
      setBackgroundContextMenu({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
      })
    }
  }, [isMobile])

  const closeBackgroundContextMenu = useCallback(() => {
    setBackgroundContextMenu({ isOpen: false, position: { x: 0, y: 0 } })
  }, [])

  const enterSelectionMode = useCallback(() => {
    setIsSelectionMode(true)
    setSelectedMessages(new Set())
  }, [])

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false)
    setSelectedMessages(new Set())
  }, [])

  const handleSelectMessage = useCallback((messageId: string) => {
    setSelectedMessages(prev => {
      const newSet = new Set(prev)
      if (newSet.has(messageId)) {
        newSet.delete(messageId)
      } else {
        newSet.add(messageId)
      }
      return newSet
    })
  }, [])

  // Open delete dialog instead of direct deletion
  const handleDeleteMessage = (messageId: string) => {
    const message = messages.find(m => m.id === messageId)
    if (message) {
      setMessageToDelete(message)
      setShowDeleteDialog(true)
    }
  }

  // Delete for everyone - removes from database and storage
  const handleDeleteForEveryone = async () => {
    if (!messageToDelete) return

    try {
      // If message has media, delete from storage first
      if (messageToDelete.media_url) {
        // Extract the file path from the URL
        const url = new URL(messageToDelete.media_url)
        const pathParts = url.pathname.split('/storage/v1/object/public/media/')
        if (pathParts.length > 1) {
          const filePath = pathParts[1]
          const { error: storageError } = await supabase.storage
            .from('media')
            .remove([filePath])
          
          if (storageError) {
            console.error('Error deleting file from storage:', storageError)
          }
        }
      }

      // Soft delete the message (set deleted_at)
      const { error } = await supabase
        .from('messages')
        .update({
          deleted_at: new Date().toISOString(),
          content: '', // Clear content
          media_url: null, // Clear media URL
          file_name: null,
          file_size: null,
        })
        .eq('id', messageToDelete.id)

      if (!error) {
        // Remove from local state
        setMessages(prev => prev.filter(m => m.id !== messageToDelete.id))
      }
    } catch (error) {
      console.error('Error deleting message for everyone:', error)
    }

    setMessageToDelete(null)
    setShowDeleteDialog(false)
  }

  // Delete for me - only hides locally
  const handleDeleteForMe = async () => {
    if (!messageToDelete || !user) return

    try {
      // Try to insert into deleted_messages table
      // If the table doesn't exist, we'll use local state
      const { error } = await supabase
        .from('deleted_messages')
        .insert({
          message_id: messageToDelete.id,
          user_id: user.id,
          deleted_at: new Date().toISOString(),
        })

      if (error) {
        // If table doesn't exist or other error, use local state
        console.log('Using local state for delete for me:', error.message)
      }

      // Always update local state to hide the message
      setDeletedForMeIds(prev => new Set([...prev, messageToDelete.id]))
      setMessages(prev => prev.filter(m => m.id !== messageToDelete.id))
    } catch (error) {
      console.error('Error deleting message for me:', error)
      // Still hide locally even if database fails
      setDeletedForMeIds(prev => new Set([...prev, messageToDelete.id]))
      setMessages(prev => prev.filter(m => m.id !== messageToDelete.id))
    }

    setMessageToDelete(null)
    setShowDeleteDialog(false)
  }

  const handleForwardMessage = (message: Message) => {
    setMessageToForward(message)
    setShowForwardModal(true)
  }

  // Helper to build forward message data
  const buildForwardMessageData = (targetConversationId: string, messageToForward: Message, senderId: string): any => {
    const messageData: any = {
      conversation_id: targetConversationId,
      sender_id: senderId,
      content: messageToForward.content ? `[Transféré] ${messageToForward.content}` : '[Message transféré]',
      type: messageToForward.type,
      status: 'sent',
    }

    // Add media fields if present
    if (messageToForward.media_url) {
      messageData.media_url = messageToForward.media_url
    }
    if (messageToForward.media_type) {
      messageData.media_type = messageToForward.media_type
    }
    if (messageToForward.file_name) {
      messageData.file_name = messageToForward.file_name
    }
    if (messageToForward.file_size) {
      messageData.file_size = messageToForward.file_size
    }

    return messageData
  }

  // Helper to update conversation last message time
  const updateConversationLastMessage = async (conversationId: string): Promise<void> => {
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId)
  }

  // Extract forward message loop to reduce complexity
  const forwardMessageToConversations = async (
    conversationIds: string[],
    messageToForward: Message | null,
    userId: string
  ): Promise<{ successCount: number; errorCount: number }> => {
    let successCount = 0
    let errorCount = 0

    for (const targetConversationId of conversationIds) {
      const messageData = buildForwardMessageData(targetConversationId, messageToForward!, userId)

      const { error: insertError } = await supabase.from('messages').insert(messageData)
      
      if (insertError) {
        console.error('Error inserting forwarded message:', insertError)
        errorCount++
      } else {
        successCount++
        await updateConversationLastMessage(targetConversationId)
      }
    }

    return { successCount, errorCount }
  }

  const handleForwardToConversations = async (conversationIds: string[]) => {
    if (!messageToForward || !user) return

    try {
      const { successCount, errorCount } = await forwardMessageToConversations(
        conversationIds,
        messageToForward,
        user.id
      )

      // Show feedback to user
      if (successCount > 0 && errorCount === 0) {
        console.log(`Message transféré à ${successCount} conversation(s)`)
      } else if (errorCount > 0) {
        alert(`Erreur: ${errorCount} transfert(s) échoué(s) sur ${conversationIds.length}`)
      }
    } catch (error) {
      console.error('Error forwarding message:', error)
      alert('Erreur lors du transfert du message')
    }

    setMessageToForward(null)
    setShowForwardModal(false)
  }

  const handlePinMessage = async (messageId: string) => {
    const message = messages.find(m => m.id === messageId)
    if (message) {
      setMessageToPin(message)
      setShowPinDialog(true)
    }
  }

  const handleConfirmPin = async (durationSeconds: number) => {
    if (!messageToPin || !conversationId) return

    const pinnedAt = new Date()
    const pinnedUntil = new Date(pinnedAt.getTime() + durationSeconds * 1000)

    // Update the message as pinned
    const { error } = await supabase
      .from('messages')
      .update({
        is_pinned: true,
        pinned_at: pinnedAt.toISOString(),
        pinned_until: pinnedUntil.toISOString(),
      })
      .eq('id', messageToPin.id)

    if (!error) {
      // Update local state
      setMessages(prev => prev.map(m =>
        m.id === messageToPin.id
          ? { ...m, is_pinned: true, pinned_at: pinnedAt.toISOString(), pinned_until: pinnedUntil.toISOString() }
          : m
      ))

      // Set the pinned message for the banner
      const senderName = messageToPin.sender_id === user?.id
        ? 'Vous'
        : otherUser?.display_name || otherUser?.username || 'Utilisateur'

      setPinnedMessage({
        id: messageToPin.id,
        content: messageToPin.content || '',
        sender_name: senderName,
        pinned_at: pinnedAt.toISOString(),
        pinned_until: pinnedUntil.toISOString(),
      })
    }

    setMessageToPin(null)
    setShowPinDialog(false)
  }

  const handleUnpinMessage = async () => {
    if (!pinnedMessage) return

    const { error } = await supabase
      .from('messages')
      .update({
        is_pinned: false,
        pinned_at: null,
        pinned_until: null,
      })
      .eq('id', pinnedMessage.id)

    if (!error) {
      // Update local state
      setMessages(prev => prev.map(m =>
        m.id === pinnedMessage.id
          ? { ...m, is_pinned: false, pinned_at: null, pinned_until: null }
          : m
      ))
      setPinnedMessage(null)
    }
  }

  const scrollToPinnedMessage = () => {
    if (!pinnedMessage) return
    const messageElement = document.querySelector(`[data-message-id="${pinnedMessage.id}"]`)
    if (messageElement) {
      messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // Add a highlight effect
      messageElement.classList.add('bg-[#787add]/20')
      setTimeout(() => {
        messageElement.classList.remove('bg-[#787add]/20')
      }, 2000)
    }
  }

  // Scroll to original message when clicking on reply quote
  const scrollToMessage = useCallback((messageId: string) => {
    const messageElement = document.getElementById(`message-${messageId}`)
    if (messageElement) {
      messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // Add a highlight effect
      messageElement.classList.add('highlight-message')
      setTimeout(() => {
        messageElement.classList.remove('highlight-message')
      }, 2000)
    }
  }, [])

  // Load pinned message on mount
  useEffect(() => {
    const loadPinnedMessage = async () => {
      if (!conversationId) return

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('is_pinned', true)
        .gt('pinned_until', new Date().toISOString())
        .order('pinned_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!error && data) {
        const senderName = data.sender_id === user?.id
          ? 'Vous'
          : otherUser?.display_name || otherUser?.username || 'Utilisateur'

        setPinnedMessage({
          id: data.id,
          content: data.content || '',
          sender_name: senderName,
          pinned_at: data.pinned_at,
          pinned_until: data.pinned_until,
        })
      }
    }

    loadPinnedMessage()
  }, [conversationId, user?.id, otherUser])

  const handleStarMessage = async (messageId: string) => {
    // Find the message to toggle its starred status
    const message = messages.find(m => m.id === messageId)
    if (!message) return
    
    const newStarredStatus = !message.is_starred
    
    // Update in database
    const { error } = await supabase
      .from('messages')
      .update({ is_starred: newStarredStatus })
      .eq('id', messageId)
    
    if (!error) {
      // Update local state
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, is_starred: newStarredStatus } : m
      ))
    }
  }

  const handleReportMessage = (messageId: string) => {
    // TODO: Implement report functionality
    alert('Message signalé')
  }

  // Bulk action handlers for selection mode
  const handleBulkCopy = useCallback(async () => {
    const selectedMsgs = messages.filter(m => selectedMessages.has(m.id))
    const textContent = selectedMsgs
      .filter(m => m.type === 'text' && m.content)
      .map(m => m.content)
      .join('\n')
    
    if (textContent) {
      await navigator.clipboard.writeText(textContent)
      alert('Messages copiés!')
    } else {
      alert('Aucun texte à copier')
    }
    exitSelectionMode()
  }, [messages, selectedMessages, exitSelectionMode])

  const handleBulkStar = useCallback(async () => {
    const ids = Array.from(selectedMessages)
    
    // Update all selected messages to starred
    const { error } = await supabase
      .from('messages')
      .update({ is_starred: true })
      .in('id', ids)
    
    if (!error) {
      // Update local state
      setMessages(prev => prev.map(m =>
        selectedMessages.has(m.id) ? { ...m, is_starred: true } : m
      ))
    }
    
    exitSelectionMode()
  }, [selectedMessages, exitSelectionMode])

  const handleBulkDelete = useCallback(() => {
    // Show the bulk delete dialog instead of confirm
    setShowBulkDeleteDialog(true)
  }, [])

  const handleBulkDeleteForEveryone = useCallback(async () => {
    const ids = Array.from(selectedMessages)
    
    // Optimistic update - remove from UI immediately for instant feedback
    setMessages(prev => prev.filter(m => !selectedMessages.has(m.id)))
    setShowBulkDeleteDialog(false)
    exitSelectionMode()
    
    // Collect all media file paths to delete in batch
    const selectedMsgs = messages.filter(m => selectedMessages.has(m.id))
    const mediaFilePaths: string[] = []
    
    for (const msg of selectedMsgs) {
      if (msg.media_url) {
        try {
          const url = new URL(msg.media_url)
          const pathParts = url.pathname.split('/storage/v1/object/public/media/')
          if (pathParts.length > 1) {
            mediaFilePaths.push(pathParts[1])
          }
        } catch (error) {
          console.error('Error parsing media URL:', error)
        }
      }
    }
    
    // Delete all media files in a single batch request (much faster)
    if (mediaFilePaths.length > 0) {
      supabase.storage.from('media').remove(mediaFilePaths).catch(error => {
        console.error('Error deleting files from storage:', error)
      })
    }
    
    // Soft delete all selected messages in a single batch request
    supabase
      .from('messages')
      .update({
        deleted_at: new Date().toISOString(),
        content: '',
        media_url: null,
        file_name: null,
        file_size: null,
      })
      .in('id', ids)
      .then(({ error }) => {
        if (error) {
          console.error('Error deleting messages:', error)
        }
      })
  }, [selectedMessages, messages, exitSelectionMode])

  const handleBulkDeleteForMe = useCallback(async () => {
    const ids = Array.from(selectedMessages)
    
    // Optimistic update - remove from UI immediately for instant feedback
    setDeletedForMeIds(prev => new Set([...prev, ...ids]))
    setMessages(prev => prev.filter(m => !selectedMessages.has(m.id)))
    setShowBulkDeleteDialog(false)
    exitSelectionMode()
    
    // Try to insert all records into deleted_messages table in a single batch
    if (user) {
      const deletedRecords = ids.map(id => ({
        message_id: id,
        user_id: user.id,
        deleted_at: new Date().toISOString(),
      }))
      
      supabase
        .from('deleted_messages')
        .insert(deletedRecords)
        .then(({ error }) => {
          if (error) {
            console.log('Using local state for delete for me:', error.message)
          }
        })
    }
  }, [selectedMessages, user, exitSelectionMode])

  const handleBulkForward = useCallback(() => {
    // Get the first selected message to forward
    const selectedMsgs = messages.filter(m => selectedMessages.has(m.id))
    if (selectedMsgs.length > 0) {
      setMessageToForward(selectedMsgs[0])
      setShowForwardModal(true)
    }
    exitSelectionMode()
  }, [messages, selectedMessages, exitSelectionMode])

  const handleBulkDownload = useCallback(async () => {
    const selectedMsgs = messages.filter(m => selectedMessages.has(m.id))
    const mediaMessages = selectedMsgs.filter(m => m.media_url)
    
    if (mediaMessages.length === 0) {
      alert('Aucun média à télécharger')
      return
    }
    
    // Download each media file
    for (const msg of mediaMessages) {
      if (msg.media_url) {
        try {
          const response = await fetch(msg.media_url)
          const blob = await response.blob()
          const url = window.URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = msg.file_name || `download-${Date.now()}`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          window.URL.revokeObjectURL(url)
        } catch (error) {
          console.error('Error downloading:', error)
        }
      }
    }
    
    exitSelectionMode()
  }, [messages, selectedMessages, exitSelectionMode])

  // For "Saved Messages" (conversation with self), show special name
  const isSavedMessages = conversation?.type === 'direct' && conversation?.name === 'Messages enregistrés'
  const displayName = conversation?.type === 'group'
    ? conversation.name
    : isSavedMessages
      ? 'Moi'
      : otherUser?.display_name || otherUser?.username || 'Utilisateur'

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col bg-bg-primary h-full overflow-hidden">
        {/* Header JemaOS - FIXED at top, never scrolls - Selection mode header on mobile */}
        <ChatHeader
          isSelectionMode={isSelectionMode}
          isMobile={isMobile}
          selectedMessages={selectedMessages}
          exitSelectionMode={exitSelectionMode}
          handleBulkDelete={handleBulkDelete}
          handleBulkStar={handleBulkStar}
          handleBulkCopy={handleBulkCopy}
          handleBulkForward={handleBulkForward}
          handleBulkDownload={handleBulkDownload}
          showSelectionMenu={showSelectionMenu}
          setShowSelectionMenu={setShowSelectionMenu}
          messages={messages}
          handlePinMessage={handlePinMessage}
          navigate={navigate}
          setShowConversationInfo={setShowConversationInfo}
          conversation={conversation}
          otherUser={otherUser}
          displayName={displayName}
          otherUserStatusText={otherUserStatusText}
          otherUserIsOnline={otherUserIsOnline}
          isSearching={isSearching}
          setIsSearching={setIsSearching}
          handleStartAudioCall={handleStartAudioCall}
          handleStartVideoCall={handleStartVideoCall}
          showConversationMenu={showConversationMenu}
          setShowConversationMenu={setShowConversationMenu}
          setShowAddMemberModal={setShowAddMemberModal}
          user={user}
          conversationId={conversationId!}
          setReplyToMessage={setReplyToMessage}
          setMessageToForward={setMessageToForward}
          setShowForwardModal={setShowForwardModal}
          supabase={supabase}
        />

        {isSearching && <MessageSearch messages={messages} onSearchResults={setFilteredMessages} onClose={() => { setIsSearching(false); setFilteredMessages([]) }} />}

        {/* Pinned Message Banner */}
        {pinnedMessage && (
          <PinnedMessageBanner
            pinnedMessage={pinnedMessage}
            onUnpin={handleUnpinMessage}
            onClick={scrollToPinnedMessage}
          />
        )}

        {/* Messages avec fond personnalisable */}
        <MessageList
          loading={loading}
          messages={messages}
          timelineItems={timelineItems}
          user={user}
          reactions={reactions}
          selectedMessages={selectedMessages}
          hoveredMessageId={hoveredMessageId}
          setHoveredMessageId={setHoveredMessageId}
          handleTouchStart={(msg) => {
            if (!isMobile) return
            longPressMessageRef.current = msg
            longPressTimerRef.current = setTimeout(() => {
              setIsSelectionMode(true)
              setSelectedMessages(new Set([msg.id]))
              const messageElement = document.querySelector(`[data-message-id="${msg.id}"]`)
              if (messageElement) {
                const rect = messageElement.getBoundingClientRect()
                setQuickReactionBar({
                  isOpen: true,
                  position: { x: rect.left + rect.width / 2, y: rect.top - 10 },
                  message: msg,
                })
              }
              longPressMessageRef.current = null
            }, 500)
          }}
          handleTouchEnd={() => {
            if (longPressTimerRef.current) {
              clearTimeout(longPressTimerRef.current)
              longPressTimerRef.current = null
            }
            longPressMessageRef.current = null
          }}
          handleTouchMove={() => {
            if (longPressTimerRef.current) {
              clearTimeout(longPressTimerRef.current)
              longPressTimerRef.current = null
            }
            longPressMessageRef.current = null
          }}
          handleSelectMessage={handleSelectMessage}
          isSelectionMode={isSelectionMode}
          isMobile={isMobile}
          setReplyToMessage={setReplyToMessage}
          handleForwardMessage={handleForwardMessage}
          setQuickReactionBar={setQuickReactionBar}
          handleContextMenu={handleContextMenu}
          setContextMenu={setContextMenu}
          getSenderInfo={getSenderInfo}
          setGifStickerViewer={setGifStickerViewer}
          handlePinMessage={handlePinMessage}
          addReaction={addReaction}
          removeReaction={removeReaction}
          handleStarMessage={handleStarMessage}
          allMediaItems={allMediaItems}
          getMediaIndexForMessage={getMediaIndexForMessage}
          handleMediaNavigate={handleMediaNavigate}
          scrollToMessage={scrollToMessage}
          handleStartVideoCall={handleStartVideoCall}
          handleStartAudioCall={handleStartAudioCall}
          messagesEndRef={messagesEndRef}
          messagesContainerRef={messagesContainerRef}
          getWallpaperStyle={getWallpaperStyle}
          handleBackgroundContextMenu={handleBackgroundContextMenu}
          linkPreview={linkPreview}
          replyToMessage={replyToMessage}
          isLoadingPreview={isLoadingPreview}
          otherUser={otherUser}
        />

        {/* Input Bar JemaOS - Fixed at bottom on mobile, above nav bar - Hidden in selection mode */}
        {!isSelectionMode && (
        <div className="fixed md:relative bottom-[calc(3.5rem+env(safe-area-inset-bottom))] md:bottom-0 left-0 right-0 bg-bg-surface px-2 sm:px-3 md:px-4 py-2 md:py-3 border-t border-bg-hover md:border-t-0 z-40">
          {/* Voice Recorder - replaces input bar when recording */}
          {showVoiceRecorder ? (
            <VoiceRecorder onRecordingComplete={handleVoiceRecordingComplete} onCancel={() => setShowVoiceRecorder(false)} />
          ) : (
            <>
              {/* Link Preview above input */}
              {isLoadingPreview && <LinkPreviewSkeleton />}
              {linkPreview && !isLoadingPreview && (
                <LinkPreview
                  preview={linkPreview}
                  onDismiss={handleDismissPreview}
                />
              )}
              
              {replyToMessage && (
                <MessageReply
                  replyToMessage={{
                    id: replyToMessage.id,
                    content: replyToMessage.content,
                    sender_id: replyToMessage.sender_id,
                    senderName: replyToMessage.sender_id === user?.id ? 'Vous' : otherUser?.display_name || otherUser?.username || 'Utilisateur',
                    mediaUrl: replyToMessage.media_url || replyToMessage.file_url,
                    mediaType: replyToMessage.media_type || replyToMessage.type,
                    fileName: replyToMessage.file_name
                  }}
                  onCancel={() => setReplyToMessage(null)}
                  isPreview={true}
                />
              )}
              <form onSubmit={handleSendMessage} className="flex items-center gap-1 md:gap-2">
                <div className="relative hidden md:block" ref={emojiPickerRef}>
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-text-secondary"
                  >
                    <Smile size={24} />
                  </button>
                  {showEmojiPicker && (
                    <div className="absolute bottom-full left-0 mb-2 bg-bg-surface backdrop-blur-xl rounded-2xl p-3 shadow-2xl border border-bg-hover z-50 min-w-[280px]">
                      <div className="text-xs text-text-secondary mb-2 px-1">Emojis</div>
                      <div className="grid grid-cols-6 gap-1">
                        {['👍', '❤️', '😂', '😮', '😢', '🙏', '😊', '🔥', '👏', '🎉', '💯', '✨', '😍', '🤔', '😎', '🥳', '😭', '💪', '👌', '✅', '❌', '⭐', '💙', '💚', '💛', '💜', '🧡', '🖤', '🤍', '💖'].map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => handleEmojiSelect(emoji)}
                            className="w-10 h-10 flex items-center justify-center text-2xl hover:bg-bg-hover rounded-lg transition-all hover:scale-110 active:scale-95"
                            type="button"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => setShowMediaUploader(true)} className="w-9 h-9 md:w-10 md:h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-text-secondary">
                  <Plus size={20} className="md:hidden" />
                  <Plus size={24} className="hidden md:block" />
                </button>
                <div className="flex-1 relative">
                  <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Taper un message" className="w-full h-10 md:h-11 px-3 md:px-4 rounded-2xl bg-bg-hover text-text-primary text-sm border-none outline-none placeholder:text-text-secondary" />
                </div>
                {newMessage.trim() ? (
                  <button type="submit" disabled={sending} className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-accent hover:bg-[#5a5ec9] flex items-center justify-center transition-colors disabled:opacity-50">
                    <Send size={18} className="md:hidden text-white" />
                    <Send size={20} className="hidden md:block text-white" />
                  </button>
                ) : (
                  <button type="button" onClick={() => setShowVoiceRecorder(true)} className="w-10 h-10 md:w-11 md:h-11 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-text-secondary">
                    <Mic size={22} className="md:hidden" />
                    <Mic size={24} className="hidden md:block" />
                  </button>
                )}
              </form>
            </>
          )}
        </div>
        )}

        {/* Selection Mode Toolbar - Desktop only (mobile has header actions) */}
        {isSelectionMode && !isMobile && (
          <SelectionModeToolbar
            selectedCount={selectedMessages.size}
            onCopy={handleBulkCopy}
            onStar={handleBulkStar}
            onDelete={handleBulkDelete}
            onForward={handleBulkForward}
            onDownload={handleBulkDownload}
            onClose={exitSelectionMode}
          />
        )}
      </div>

      {/* Background Context Menu - Desktop only */}
      {!isMobile && (
        <ChatBackgroundContextMenu
          isOpen={backgroundContextMenu.isOpen}
          position={backgroundContextMenu.position}
          onClose={closeBackgroundContextMenu}
          onSelectMessages={enterSelectionMode}
          onCloseDiscussion={() => navigate('/chats')}
        />
      )}

      {showMediaUploader && (
        <MediaUploader
          onMediaSelect={(file, type) => console.log('Media selected:', file.name, type)}
          onUploadComplete={handleMediaUploadComplete}
          onMultipleUploadComplete={handleMultipleUploadComplete}
          onCancel={() => setShowMediaUploader(false)}
          onEmojiSelect={(emoji) => {
            setNewMessage(prev => prev + emoji)
            setShowMediaUploader(false)
          }}
          onGifStickerSend={async (url, type, caption) => {
            if (!user) return
            setSending(true)
            
            const prefix = type === 'gif' ? 'GIF' : 'STICKER'
            const content = caption ? `${caption}\n[${prefix}](${url})` : `[${prefix}](${url})`
            
            // Optimistic update
            const tempId = `temp-${Date.now()}`
            const optimisticMessage = {
              id: tempId,
              conversation_id: conversationId!,
              sender_id: user.id,
              content: content,
              type: 'text',
              status: 'sent',
              created_at: new Date().toISOString(),
              reply_to_id: replyToMessage?.id || null,
              is_starred: false,
              is_pinned: false,
            } as unknown as Message

            setMessages(prev => [...prev, optimisticMessage])
            setReplyToMessage(null)
            setShowMediaUploader(false)

            try {
              const messageData: any = {
                conversation_id: conversationId!,
                sender_id: user.id,
                content: content,
                type: 'text',
                status: 'sent',
                reply_to_id: optimisticMessage.reply_to_id,
              }
              
              const { data, error } = await supabase.from('messages').insert(messageData).select().single()
              
              if (!error && data) {
                setMessages(prev => prev.map(m => m.id === tempId ? data : m))
                await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId!)
              } else {
                setMessages(prev => prev.filter(m => m.id !== tempId))
              }
            } finally {
              setSending(false)
            }
          }}
        />
      )}
      {showConversationInfo && (
        <ConversationInfo
          conversationId={conversationId!}
          conversationType={conversation?.type || 'direct'}
          conversationName={displayName}
          conversationDescription={conversation?.description}
          conversationAvatar={conversation?.avatar_url}
          otherUser={otherUser}
          currentUserId={user?.id || ''}
          isAdmin={conversation?.type === 'group' ? true : false}
          onClose={() => {
            setShowConversationInfo(false)
            setShowAddMemberModal(false)
            refreshConversation()
            // Reload ephemeral setting in case it was changed
            loadEphemeralSetting()
          }}
          onStartVideoCall={handleStartVideoCall}
          onStartAudioCall={handleStartAudioCall}
          initialTab={showAddMemberModal ? 'members' : 'overview'}
          openAddMemberModal={showAddMemberModal}
        />
      )}

      {/* Context Menu */}
      {contextMenu.isOpen && contextMenu.message && (
        <MessageContextMenu
          isOpen={true}
          position={contextMenu.position}
          messageId={contextMenu.message.id}
          messageContent={contextMenu.message.content || ''}
          messageType={contextMenu.message.type as 'text' | 'image' | 'video' | 'file' | 'audio'}
          isOwn={contextMenu.message.sender_id === user?.id}
          isGroupChat={conversation?.type === 'group'}
          senderName={contextMenu.message.sender_id === user?.id ? profile?.display_name || profile?.username : otherUser?.display_name || otherUser?.username}
          mediaUrl={contextMenu.message.media_url || undefined}
          onClose={closeContextMenu}
          onReply={() => setReplyToMessage(contextMenu.message)}
          onReplyPrivately={() => {
            // TODO: Implement reply privately for group chats
            alert('Répondre en privé')
          }}
          onSendMessage={() => {
            // TODO: Navigate to direct message with user
            alert('Envoyer un message')
          }}
          onCopy={() => {
            // Copy handled in component
          }}
          onForward={() => handleForwardMessage(contextMenu.message!)}
          onPin={() => handlePinMessage(contextMenu.message!.id)}
          onStar={() => handleStarMessage(contextMenu.message!.id)}
          onSelect={() => {
            // Enter selection mode and select the message
            setIsSelectionMode(true)
            setSelectedMessages(new Set([contextMenu.message!.id]))
          }}
          onSaveAs={() => {
            // Save handled in component
          }}
          onReport={() => handleReportMessage(contextMenu.message!.id)}
          onDelete={() => handleDeleteMessage(contextMenu.message!.id)}
          onReaction={(emoji) => addReaction(contextMenu.message!.id, emoji)}
        />
      )}

      {/* Pin Message Dialog */}
      <PinMessageDialog
        isOpen={showPinDialog}
        onClose={() => {
          setShowPinDialog(false)
          setMessageToPin(null)
        }}
        onPin={handleConfirmPin}
      />

      {/* Delete Message Dialog */}
      <DeleteMessageDialog
        isOpen={showDeleteDialog}
        onClose={() => {
          setShowDeleteDialog(false)
          setMessageToDelete(null)
        }}
        onDeleteForEveryone={handleDeleteForEveryone}
        onDeleteForMe={handleDeleteForMe}
        isOwn={messageToDelete?.sender_id === user?.id}
        hasMedia={!!messageToDelete?.media_url}
      />

      {/* Bulk Delete Dialog */}
      <DeleteMessageDialog
        isOpen={showBulkDeleteDialog}
        onClose={() => {
          setShowBulkDeleteDialog(false)
        }}
        onDeleteForEveryone={handleBulkDeleteForEveryone}
        onDeleteForMe={handleBulkDeleteForMe}
        isOwn={Array.from(selectedMessages).every(id => {
          const msg = messages.find(m => m.id === id)
          return msg?.sender_id === user?.id
        })}
        hasMedia={Array.from(selectedMessages).some(id => {
          const msg = messages.find(m => m.id === id)
          return !!msg?.media_url
        })}
        messageCount={selectedMessages.size}
      />

      {/* Forward Message Modal */}
      <ForwardMessageModal
        isOpen={showForwardModal}
        messageContent={messageToForward?.content || ''}
        messageType={(messageToForward?.type as 'text' | 'image' | 'video' | 'file' | 'audio') || 'text'}
        mediaUrl={messageToForward?.media_url || undefined}
        onClose={() => {
          setShowForwardModal(false)
          setMessageToForward(null)
        }}
        onForward={handleForwardToConversations}
      />

      {/* Quick Reaction Bar */}
      <QuickReactionBar
        isOpen={quickReactionBar.isOpen}
        position={quickReactionBar.position}
        onReaction={(emoji) => {
          if (quickReactionBar.message) {
            addReaction(quickReactionBar.message.id, emoji)
          }
          // On mobile, exit selection mode after adding a reaction (like WhatsApp)
          if (isMobile && isSelectionMode) {
            exitSelectionMode()
          }
          // Close the reaction bar
          setQuickReactionBar({ isOpen: false, position: { x: 0, y: 0 }, message: null })
        }}
        onMoreOptions={() => {
          if (quickReactionBar.message) {
            setContextMenu({
              isOpen: true,
              position: quickReactionBar.position,
              message: quickReactionBar.message,
            })
          }
          // Close the reaction bar when opening more options
          setQuickReactionBar({ isOpen: false, position: { x: 0, y: 0 }, message: null })
        }}
        onClose={() => {
          // Just close the reaction bar, don't exit selection mode
          // This allows users to select multiple messages after long press
          setQuickReactionBar({ isOpen: false, position: { x: 0, y: 0 }, message: null })
        }}
      />

      {/* GIF/Sticker Fullscreen Viewer */}
      {gifStickerViewer && (
        <MediaViewer
          isOpen={gifStickerViewer.isOpen}
          mediaUrl={gifStickerViewer.url}
          mediaType={gifStickerViewer.type}
          senderName={gifStickerViewer.senderName}
          senderAvatar={gifStickerViewer.senderAvatar}
          timestamp={gifStickerViewer.timestamp}
          isOwn={gifStickerViewer.isOwn}
          isStarred={messages.find(m => m.id === gifStickerViewer.messageId)?.is_starred || false}
          onClose={() => setGifStickerViewer(null)}
          onReaction={(emoji) => addReaction(gifStickerViewer.messageId, emoji)}
          onForward={() => {
            const message = messages.find(m => m.id === gifStickerViewer.messageId)
            if (message) handleForwardMessage(message)
          }}
          onStar={() => handleStarMessage(gifStickerViewer.messageId)}
          onPin={() => handlePinMessage(gifStickerViewer.messageId)}
          allMedia={allMediaItems}
          currentIndex={getMediaIndexForMessage(gifStickerViewer.messageId)}
          onNavigate={(index) => {
            const media = allMediaItems[index]
            if (media) {
              setGifStickerViewer({
                isOpen: true,
                url: media.url,
                type: media.type as 'gif' | 'sticker',
                senderName: media.senderName,
                senderAvatar: media.senderAvatar,
                timestamp: media.timestamp,
                isOwn: media.isOwn,
                messageId: media.messageId,
              })
            }
          }}
        />
      )}

    </MainLayout>
  )
}
