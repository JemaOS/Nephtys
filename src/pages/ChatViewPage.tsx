// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/context/ThemeContext'
import { MainLayout } from '@/components/MainLayout'
import { supabase, Message, Conversation, Profile, sendBroadcastMessage } from '@/lib/supabase'
import { offlineStorage } from '@/lib/offlineStorage'
import { useUserPresence } from '@/hooks/usePresence'
import { Send, Mic, Plus } from 'lucide-react'
import { EmojiPicker } from '@/components/EmojiPicker'
import { MessageReply } from '@/components/MessageReply'
import { MessageSearch } from '@/components/MessageSearch'
import { MediaUploader } from '@/components/MediaUploader'
import { MediaViewer } from '@/components/MediaViewer'
import { VoiceRecorder } from '@/components/VoiceRecorder'
import { ConversationInfo } from '@/components/ConversationInfo'
import { useMessageReactions } from '@/hooks/useMessageReactions'
import { useCall } from '@/context/CallContext'
import { useNotifications } from '@/hooks/useNotifications'
import { MessageContextMenu } from '@/components/MessageContextMenu'
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
import { ChatHeader, CallLog, TimelineItem, MessageList } from './ChatViewPageComponents'

const isEmojiOnly = (text: string): { isEmoji: boolean; emojiCount: number } => {
  if (!text || text.trim() === '') return { isEmoji: false, emojiCount: 0 }
  
  const trimmed = text.trim()
  
  // Comprehensive emoji regex that matches:
  // - Basic emojis with optional variation selector (VS16)
  // - Emojis with skin tone modifiers
  // - ZWJ sequences (family, profession emojis, etc.)
  // - Flag emojis (regional indicators)
  // - Keycap emojis (#️⃣, 0️⃣-9️⃣, *️⃣)
  // - Letters and symbols (🅰️, 🅱️, 🆎, 🅾️, 🆘)
  // - Zodiac symbols (♈♉♊♋♌♍♎♏♐♑♒♓⛎)
  // - Misc symbols with emoji property
  const emojiPattern = new RegExp(
    String.raw`(?:` +
      // Emoji Presentation or Emoji with optional VS16
      String.raw`(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})` +
      '|' +
      // Regional indicators (flags)
      String.raw`(?:\p{Regional_Indicator}{2})` +
      '|' +
      // Keycap digits (#*0-9)
      String.raw`(?:[\u0023\u002A\u0030-\u0039]\uFE0F?\u20E3)` +
      '|' +
      // Digits with variation selector
      String.raw`(?:[\u0030-\u0039]\uFE0F\u20E3)` +
      '|' +
      // Zodiac - moved outside character class to avoid surrogate pair issues
      String.raw`(?:[♈-♓⛎])` +
    String.raw`)` +
    // Optional ZWJ sequences and modifiers
    String.raw`(?:` +
      String.raw`\u200D(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})` +
      '|' +
      String.raw`\p{Emoji_Modifier}` +
    String.raw`)*` +
    '/gu'
  )
  
  // Find all emojis in the text
  const emojis = trimmed.match(emojiPattern)
  
  if (!emojis) return { isEmoji: false, emojiCount: 0 }
  
  // Check if the entire string is just emojis (with optional whitespace between)
  const emojiString = emojis.join('')
  const textWithoutWhitespace = trimmed.replaceAll('\\s', '')
  
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
const CACHE_EXPIRY = 24 * 60 * 60 * 1000 // 24 hours

const getCache = <T,>(key: string): T | null => {
  try {
    const cached = localStorage.getItem(CACHE_PREFIX + key)
    if (cached) {
      const { data, timestamp } = JSON.parse(cached)
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        return data as T
      }
    }
  } catch {
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
  } catch {
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
type StartCallFunction = (userId: string, conversationId: string, media: { audio: boolean; video: boolean }) => Promise<void>;
type StartGroupCallFunction = (conversationId: string, media: { audio: boolean; video: boolean }) => Promise<void>;

const startVideoCall = async (
  conversationId: string,
  conversationType: string | undefined,
  otherUser: Profile | null,
  startGroupCall: StartGroupCallFunction,
  startCall: StartCallFunction
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
  startGroupCall: StartGroupCallFunction,
  startCall: StartCallFunction
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
  const location = useLocation()
  const { user, profile } = useAuth()
  
  // Initialize state from cache for instant display
  const [conversation, setConversation] = useState<Conversation | null>(() => {
    // 1. Try location state (fastest, passed from ChatsPage)
    if (location.state?.conversation) {
      return location.state.conversation
    }
    
    // 2. Try individual cache
    if (conversationId) {
      const cached = getCache<Conversation>(`conv_${conversationId}`)
      if (cached) return cached
      
      // 3. Try to find in offlineStorage list (if loaded)
      const allConvs = offlineStorage.getConversationsSync()
      if (allConvs) {
        const found = allConvs.find((c: any) => c.id === conversationId)
        if (found) return found
      }
    }
    return null
  })
  const [messages, setMessages] = useState<Message[]>(() =>
    conversationId ? getCache<Message[]>(`msgs_${conversationId}`) || [] : []
  )
  const [callLogs, setCallLogs] = useState<CallLog[]>([])
  const [filteredMessages, setFilteredMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(() => {
    // If we have cached messages, don't show loading spinner
    const cachedMsgs = conversationId ? getCache<Message[]>(`msgs_${conversationId}`) : null
    return !cachedMsgs || cachedMsgs.length === 0
  })
  const [sending, setSending] = useState(false)
  const [otherUser, setOtherUser] = useState<Profile | null>(() => {
    if (location.state?.conversation?.otherUserProfile) {
      return location.state.conversation.otherUserProfile
    }
    return conversationId ? getCache<Profile>(`user_${conversationId}`) : null
  })
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // Using useState for setDeletedForMeIds - value not needed, only setter
  const setDeletedForMeIds = useState<Set<string>>(new Set())[1]
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
  const [, setMediaViewerState] = useState<{
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
  // Message queue for pending messages (optimistic UI + broadcast)
  const messageQueueRef = useRef<Message[]>([])
  const isProcessingQueue = useRef(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  // Ref to track sending state to prevent race conditions
  const sendingRef = useRef(false)
  
  // Sync ref with state for immediate access
  useEffect(() => {
    sendingRef.current = sending
  }, [sending])
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const longPressMessageRef = useRef<Message | null>(null)
  
  // State for infinite scroll and prefetching
  const [hasMoreMessages, setHasMoreMessages] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const oldestMessageRef = useRef<string | null>(null)
  const scrollPositionRef = useRef(0)
  
  const { reactions, addReaction, removeReaction } = useMessageReactions(conversationId || '')
  const { startCall, startGroupCall } = useCall()
  const { permission, requestPermission, sendNotification, subscribeToConversation, unsubscribeFromConversation } = useNotifications()
  const { wallpaper } = useTheme()
  const isMobile = useIsMobile()
  
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
    // Ensure messages is always an array
    const msgs = Array.isArray(messages) ? messages : []
    return msgs
      .filter(m => {
        // Include image and video messages
        if (m.media_url && m.media_type && (m.media_type === 'image' || m.media_type === 'video') && m.type !== 'audio') {
          return true
        }
        // Include GIF messages
        if (m.type === 'text' && m.content?.match(/\[GIF\]\(https?:\/\/[^)]+\)$/)) {
          return true
        }
        // Include Sticker messages
        if (m.type === 'text' && m.content?.match(/\[STICKER\]\(https?:\/\/[^)]+\)$/)) {
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
          // Avoid catastrophic backtracking by checking suffix first
          const gifSuffixMatch = m.content.match(/\[GIF\]\((https?:\/\/[^)]+)\)$/);
          const stickerSuffixMatch = m.content.match(/\[STICKER\]\((https?:\/\/[^)]+)\)$/);
          
          if (gifSuffixMatch) {
            mediaUrl = gifSuffixMatch[1]
            mediaType = 'gif'
          } else if (stickerSuffixMatch) {
            mediaUrl = stickerSuffixMatch[1]
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
    // Only hide if we are showing messages (not loading) and haven't scrolled yet
    const shouldHide = !loading && messages.length > 0 && !isInitialScrollDone
    
    const style: React.CSSProperties = {
      opacity: shouldHide ? 0 : 1,
    }

    switch (wallpaper) {
      case 'dark':
        style.backgroundColor = '#000000'
        break
      case 'light':
        style.backgroundColor = '#e5ddd5'
        break
      case 'gradient':
        style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
        break
      case 'custom':
        style.backgroundColor = '#1a1a2e'
        break
      default:
        // Use CSS variable from bg-primary instead of hardcoded color
        break
    }
    return style
  }

  // Load call logs for this conversation
  const loadCallLogs = async () => {
    if (!conversationId) return
    
    const { data, error } = await supabase
      .from('call_logs')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('started_at', { ascending: true })
    
    if (error) {
      console.error('[ChatViewPage] Error loading call logs:', error)
    }
    
    if (!error && data) {
      setCallLogs(data)
    }
  }

  // Merge messages and call logs into a unified timeline
  const timelineItems = useMemo((): TimelineItem[] => {
    const items: TimelineItem[] = []
    
    // Ensure displayedMessages and callLogs are always arrays
    const msgs = Array.isArray(displayedMessages) ? displayedMessages : []
    const logs = Array.isArray(callLogs) ? callLogs : []
    
    // Add messages to timeline
    for (const message of msgs) {
      items.push({
        type: 'message',
        timestamp: message.created_at,
        data: message
      })
    }
    
    // Add call logs to timeline
    for (const call of logs) {
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

  const updateMessageStatus = async (messageId: string, status: 'delivered' | 'read') => {
    await supabase.from('messages').update({ status }).eq('id', messageId)
  }

  // Helper to update a message in the list
  const updateMessageInList = (currentMessages: Message[], updatedMsg: Message): Message[] => {
    return currentMessages.map(m => m.id === updatedMsg.id ? updatedMsg : m)
  }

  // Helper to remove a message from the list
  const removeMessageFromList = (currentMessages: Message[], deletedId: string): Message[] => {
    return currentMessages.filter(m => m.id !== deletedId)
  }

  const otherUserRef = useRef<Profile | null>(null)
  
  useEffect(() => {
    otherUserRef.current = otherUser
  }, [otherUser])

  // Helper to handle notifications for new messages (extracted to reduce complexity)
  const handleNewMessageNotification = useCallback(async (newMsg: Message, senderId: string) => {
    await updateMessageStatus(newMsg.id, 'delivered')
    if (document.hidden && permission === 'granted') {
      const currentOtherUser = otherUserRef.current
      const senderName = currentOtherUser?.display_name || currentOtherUser?.username || 'Quelqu\'un'
      const preview = newMsg.type === 'text' ? newMsg.content : '📎 Fichier'
      sendNotification(senderName, preview, { conversationId, messageId: newMsg.id, url: `/chat/${conversationId}` })
    }
  }, [permission, conversationId, sendNotification])

  // Helper to handle new message insertion with deduplication and optimistic update replacement
  const handleNewMessage = useCallback((payload: any) => {
    const newMsg = payload.new as Message
    
    setMessages(prev => {
      // 1. Check if message already exists (by ID) to prevent duplicates
      if (prev.some(m => m.id === newMsg.id)) {
        return prev
      }

      // 2. Check for temp message to replace
      const tempIndex = prev.findIndex(m =>
        m.id.startsWith('temp-') &&
        m.sender_id === newMsg.sender_id &&
        (
          // Match by media_url if present (for images/videos/files)
          (m.media_url && newMsg.media_url && m.media_url === newMsg.media_url) ||
          // OR match by content if it's a text message (for stickers/GIFs)
          (m.type === 'text' && m.content === newMsg.content) ||
          // Fallback for audio/files where media_url might be used
          (m.type !== 'text' && m.media_url === newMsg.media_url)
        )
      )

      if (tempIndex !== -1) {
        const newMessages = [...prev]
        newMessages[tempIndex] = newMsg
        return newMessages
      }

      return [...prev, newMsg]
    })
    
    // Handle notification if not own message
    if (user && newMsg.sender_id !== user.id) {
      handleNewMessageNotification(newMsg, newMsg.sender_id)
    }
  }, [user, handleNewMessageNotification])

  // CRITICAL STABILITY FIX: Prevent multiple simultaneous data loads
  const isLoadingDataRef = useRef(false)
  const lastLoadTimeRef = useRef(0)
  const initialLoadDoneRef = useRef(false)
  
  // Debounced load function to prevent request spam - WHATSAPP STYLE
  const debouncedLoadData = useCallback(() => {
    const now = Date.now()
    // Only allow reload every 10 seconds minimum (WhatsApp style)
    if (now - lastLoadTimeRef.current < 10000) {
      console.log('[ChatViewPage] Skipping reload, too soon')
      return
    }
    if (isLoadingDataRef.current) {
      console.log('[ChatViewPage] Skipping reload, already in progress')
      return
    }
    
    // Silent reload - no console spam
    isLoadingDataRef.current = true
    lastLoadTimeRef.current = now
    
    // Load sequentially, not in parallel to reduce connection pressure
    loadMessages().then(() => {
      loadConversation().then(() => {
        loadCallLogs().finally(() => {
          isLoadingDataRef.current = false
        })
      })
    })
  }, [])

  useEffect(() => {
    if (!conversationId || !user) return
    
    // WHATSAPP-LEVEL STABILITY: Only load once on mount
    // Real-time updates come through the channel, not polling
    if (!initialLoadDoneRef.current) {
      initialLoadDoneRef.current = true
      lastLoadTimeRef.current = Date.now()
      
      // Initial load complete
      // Load sequentially to avoid connection pressure
      loadMessages().then(() => {
        loadConversation().then(() => {
          loadCallLogs()
        })
      })
    }
    
    loadEphemeralSetting()
    if (permission === 'default') requestPermission()
    subscribeToConversation(conversationId)
    
    // Loading timeout - prevent infinite loading (max 10 seconds)
    const loadingTimeout = setTimeout(() => {
      setLoading(false)
    }, 10000)
    
    // WHATSAPP-LEVEL STABILITY: Single consolidated channel
    // Reduces WebSocket connections and prevents connection thrashing
    const mainChannel = supabase
      .channel(`main:${conversationId}`, {
        config: {
          broadcast: { self: false },
          presence: { key: user?.id || 'anonymous' }
        }
      })
      // Messages INSERT
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, handleNewMessage)
      // Messages UPDATE
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        const updatedMsg = payload.new as Message
        
        // Check if message was soft-deleted (has deleted_at)
        if (updatedMsg.deleted_at) {
          setMessages(prev => removeMessageFromList(prev, updatedMsg.id))
        } else {
          setMessages(prev => updateMessageInList(prev, updatedMsg))
        }
      })
      // Messages DELETE
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        const deletedId = (payload.old as any)?.id
        if (deletedId) {
          setMessages(prev => removeMessageFromList(prev, deletedId))
        }
      })
      // Call logs changes
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'call_logs',
        filter: `conversation_id=eq.${conversationId}`
      }, () => {
        loadCallLogs()
      })
      // Profile updates
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles'
      }, (payload) => {
        if (otherUser && payload.new.id === otherUser.id) {
          setOtherUser(payload.new as Profile)
        }
        // Don't reload conversation on every profile update - too expensive
        // loadConversation()
      })
      // Member left
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'conversation_members',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        if (payload.old && payload.old.user_id === user?.id) {
          navigate('/chats')
        }
      })
      // Broadcast for instant message delivery
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        if (payload?.message) {
          handleNewMessage({ new: payload.message })
        }
      })
      .subscribe()

    // Handle visibility change - WHATSAPP STYLE: NO reload on visibility change
    // The realtime channel handles updates, no need to poll
    const handleVisibilityChange = () => {
      // Only log, don't reload - realtime channel handles updates
      if (document.visibilityState === 'visible') {
        // Tab visible, realtime channel active
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    // Handle Supabase reconnection event - minimal reload
    let reconnectTimeout: NodeJS.Timeout | null = null
    const handleSupabaseReconnect = () => {
      // Clear any pending timeout
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
      }
      // Wait 3 seconds then reload (max once every 10 seconds)
      reconnectTimeout = setTimeout(() => {
        debouncedLoadData()
      }, 3000)
    }
    
    globalThis.addEventListener('supabase-reconnected', handleSupabaseReconnect)
    
    // Handle call log created event
    const handleCallLogCreated = (event: CustomEvent) => {
      if (event.detail.conversationId === conversationId) {
        loadCallLogs()
      }
    }
    
    globalThis.addEventListener('call-log-created', handleCallLogCreated as EventListener)

    return () => {
      clearTimeout(loadingTimeout)
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      try {
        supabase.removeChannel(mainChannel)
      } catch {
        // Ignore channel removal errors
      }
      unsubscribeFromConversation(conversationId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      globalThis.removeEventListener('supabase-reconnected', handleSupabaseReconnect)
      globalThis.removeEventListener('call-log-created', handleCallLogCreated as EventListener)
    }
  }, [conversationId, user?.id, permission, handleNewMessage, debouncedLoadData])

  // Track previous message count to detect new messages
  const prevMessageCountRef = useRef(0)
  const hasScrolledInitially = useRef(false)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesContentRef = useRef<HTMLDivElement>(null)
  const [isInitialScrollDone, setIsInitialScrollDone] = useState(false)
  const scrollAttemptsRef = useRef(0)
  
  // Reset initial scroll flag when conversation changes - MUST run before scroll effect
  useLayoutEffect(() => {
    hasScrolledInitially.current = false
    prevMessageCountRef.current = 0
    scrollAttemptsRef.current = 0
    setIsInitialScrollDone(false)
  }, [conversationId])

  // WHATSAPP-STYLE: Scroll to bottom with multiple attempts for perfect positioning
  useLayoutEffect(() => {
    // Only run when messages are loaded and we haven't scrolled yet for this conversation
    if (loading || !conversationId) return
    
    // If no messages, we are done
    if (messages.length === 0) {
      setIsInitialScrollDone(true)
      hasScrolledInitially.current = true
      return
    }
    
    if (hasScrolledInitially.current) return
    
    const scrollContainer = messagesContainerRef.current
    if (!scrollContainer) return
    
    // WHATSAPP STRATEGY: Multiple scroll attempts with increasing delays
    // This ensures the scroll happens after React renders and DOM settles
    const scrollToBottom = () => {
      scrollAttemptsRef.current++
      
      // Force scroll to bottom - use scrollTo for better compatibility
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: 'instant'
      })
      
      // Verify scroll worked with a larger threshold for mobile
      const scrollBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight
      const isAtBottom = scrollBottom < 100
      
      if (isAtBottom || scrollAttemptsRef.current >= 10) {
        // Success or max attempts reached
        setIsInitialScrollDone(true)
        hasScrolledInitially.current = true
        prevMessageCountRef.current = messages.length
      } else {
        // Retry with exponential backoff - longer delays for images to load
        setTimeout(scrollToBottom, scrollAttemptsRef.current * 100)
      }
    }
    
    // Initial attempt after a short delay to let React render
    const initialTimeout = setTimeout(() => {
      scrollToBottom()
    }, 100)
    
    // Additional safety: force scroll after progressively longer delays
    const safetyTimeouts: NodeJS.Timeout[] = []
    
    // Progressive safety timeouts (100ms, 300ms, 600ms, 1000ms, 1500ms)
    const delays = [100, 300, 600, 1000, 1500]
    delays.forEach(delay => {
      const timeout = setTimeout(() => {
        if (!hasScrolledInitially.current) {
          scrollContainer.scrollTo({
            top: scrollContainer.scrollHeight,
            behavior: 'instant'
          })
        }
      }, delay)
      safetyTimeouts.push(timeout)
    })
    
    // Final attempt - mark as done regardless
    const finalTimeout = setTimeout(() => {
      if (!hasScrolledInitially.current) {
        scrollContainer.scrollTo({
          top: scrollContainer.scrollHeight,
          behavior: 'instant'
        })
        setIsInitialScrollDone(true)
        hasScrolledInitially.current = true
        prevMessageCountRef.current = messages.length
      }
    }, 2000)
    
    return () => {
      clearTimeout(initialTimeout)
      safetyTimeouts.forEach(t => clearTimeout(t))
      clearTimeout(finalTimeout)
    }
  }, [loading, messages.length, conversationId])

  // ResizeObserver to handle dynamic content changes (images loading, etc.)
  useEffect(() => {
    const scrollContainer = messagesContainerRef.current
    const contentContainer = messagesContentRef.current
    
    if (!scrollContainer || !contentContainer) return

    // Function to handle resize
    const handleResize = () => {
      if (!hasScrolledInitially.current) return

      // Check if we were near the bottom before the resize
      // We use a generous threshold (e.g., 150px) to account for minor shifts
      const isNearBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 150
      
      if (isNearBottom) {
        // Maintain scroll at bottom
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }

    const observer = new ResizeObserver(handleResize)
    
    // Observe both the container (for window resize) and the content (for dynamic loading)
    observer.observe(scrollContainer)
    observer.observe(contentContainer)
    
    return () => observer.disconnect()
  }, [hasScrolledInitially.current])
  
  // Handle new messages with smooth scroll (after initial load)
  useEffect(() => {
    if (!loading && messages.length > 0 && hasScrolledInitially.current) {
      if (messages.length > prevMessageCountRef.current) {
        // New message added - scroll smoothly
        const behavior = getScrollBehavior()
        messagesEndRef.current?.scrollIntoView({ behavior })
        prevMessageCountRef.current = messages.length
      }
    }
  }, [loading, messages.length])

  // Note: scrollToBottom is implemented via messagesEndRef.scrollIntoView
  // Extract ternary for scroll behavior
  const getScrollBehavior = (): ScrollBehavior => {
    if (messages.length > prevMessageCountRef.current) {
      return 'smooth'
    }
    return 'instant'
  }

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
      if (linkPreview?.url !== url) {
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

  // Process message queue for broadcast delivery
  const processMessageQueue = useCallback(async () => {
    if (isProcessingQueue.current || messageQueueRef.current.length === 0 || !conversationId) return
    
    isProcessingQueue.current = true
    const queue = [...messageQueueRef.current]
    messageQueueRef.current = []
    
    for (const msg of queue) {
      try {
        // Send via broadcast for instant delivery to other clients
        await sendBroadcastMessage(conversationId, msg)
      } catch (e) {
        console.warn('[ChatViewPage] Broadcast failed, relying on postgres_changes:', e)
      }
    }
    
    isProcessingQueue.current = false
  }, [conversationId])

  const handleEmojiSelect = (emoji: string) => {
    setNewMessage(prev => prev + emoji)
  }

  // Extract group member loading to helper function
  const loadGroupMembers = async (convId: string): Promise<Map<string, Profile>> => {
    // OPTIMIZATION: Try to get member IDs from cache first
    // This avoids the network roundtrip to fetch member list
    let memberIds: string[] = getCache<string[]>(`members_${convId}`) || []
    
    if (memberIds.length === 0) {
      const { data: members } = await supabase
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', convId)
      
      if (members && members.length > 0) {
        memberIds = members.map(m => m.user_id)
        setCache(`members_${convId}`, memberIds)
      }
    } else {
      // Stale-while-revalidate: Refresh member list in background
      supabase
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', convId)
        .then(({ data: members }) => {
          if (members && members.length > 0) {
            const newIds = members.map(m => m.user_id)
            // Extract sort operations as required by SonarQube
            const sortedNewIds = [...newIds].sort((a, b) => a.localeCompare(b))
            const sortedMemberIds = [...memberIds].sort((a, b) => a.localeCompare(b))
            if (JSON.stringify(sortedNewIds) !== JSON.stringify(sortedMemberIds)) {
              setCache(`members_${convId}`, newIds)
            }
          }
        })
    }
    
    if (memberIds.length > 0) {
      // OPTIMIZATION: Try to get profiles from cache first (instant)
      // This prevents the "double delay" where messages load but names are missing
      const cachedProfilesMap = await offlineStorage.getProfilesFromDB(memberIds)
      const cachedProfiles = Array.from(cachedProfilesMap.values()) as unknown as Profile[]
      
      // Create initial map from cache
      const profileMap = new Map<string, Profile>()
      cachedProfiles.forEach(p => profileMap.set(p.id, p))
      
      // Identify missing profiles
      const missingIds = memberIds.filter(id => !cachedProfilesMap.has(id))
      
      if (missingIds.length > 0) {
        // Fetch only missing profiles
        const { data: profiles } = await supabase
          .from('profiles')
          .select('*')
          .in('id', missingIds)
        
        if (profiles) {
          // Cache the newly fetched profiles for next time
          offlineStorage.cacheProfiles(profiles)
          
          // Add new profiles to map
          profiles.forEach(p => profileMap.set(p.id, p))
        }
      }
      
      return profileMap
    }
    return new Map()
  }

  // Helper to find other user ID
  const findOtherUserId = (members: any[], currentUserId: string): string | null => {
    if (!members || members.length === 0) return null
    
    // Saved Messages (only one member = self)
    if (members.length === 1 && members[0].user_id === currentUserId) {
      return currentUserId
    }
    
    // Find the other user
    const otherMember = members.find((m: any) => m.user_id !== currentUserId)
    return otherMember ? otherMember.user_id : null
  }

  // Extract direct conversation user loading to helper function
  const loadDirectConversationUser = async (convId: string, userId: string): Promise<Profile | null> => {
    // Try cache first for the user ID association
    // We cache the "other user ID" for this conversation to avoid the conversation_members lookup
    let otherUserId = getCache<string>(`direct_user_id_${convId}`)
    
    if (!otherUserId) {
      const { data: allMembers } = await supabase.from('conversation_members').select('user_id').eq('conversation_id', convId)
      otherUserId = findOtherUserId(allMembers || [], userId)
      
      if (otherUserId) {
        setCache(`direct_user_id_${convId}`, otherUserId)
      }
    }

    if (otherUserId) {
      // OPTIMIZATION: Try cache first for the profile data
      const cachedProfile = await offlineStorage.getProfileFromDB(otherUserId)
      if (cachedProfile) return cachedProfile as unknown as Profile
      
      const { data: userData } = await supabase.from('profiles').select('*').eq('id', otherUserId).maybeSingle()
      if (userData) offlineStorage.cacheProfiles([userData])
      return userData
    }
    
    return null
  }

  const loadConversation = async () => {
    // OPTIMIZATION: Trigger member loading immediately if we have cached conversation data
    // This ensures profiles appear instantly along with cached messages
    if (conversation) {
      if (conversation.type === 'group') {
        loadGroupMembers(conversationId!).then(profileMap => {
          setGroupMemberProfiles(prev => {
            // Only update if we have more data or if it's the initial load
            if (prev.size === 0 || profileMap.size > prev.size) {
              return profileMap
            }
            return prev
          })
        })
      }
      // For direct chats, otherUser is already initialized from cache in useState
    }

    const { data, error } = await supabase.from('conversations').select('*').eq('id', conversationId!).maybeSingle()
    if (!error && data) {
      setConversation(data)
      setCache(`conv_${conversationId}`, data)
      
      if (data.type === 'group') {
        const profileMap = await loadGroupMembers(conversationId!)
        setGroupMemberProfiles(profileMap)
      } else if (data.type === 'direct') {
        const otherUserData = await loadDirectConversationUser(conversationId!, user!.id)
        if (otherUserData) {
          setOtherUser(otherUserData)
          setCache(`user_${conversationId}`, otherUserData)
        }
      }
    } else if (!data && !error) {
      // Conversation not found or no access (deleted)
      console.error('Conversation not found or access denied')
      // Clear cached data and redirect immediately
      localStorage.removeItem(`anu_cache_conv_${conversationId}`)
      localStorage.removeItem(`anu_cache_user_${conversationId}`)
      localStorage.removeItem(`anu_cache_msgs_${conversationId}`)
      navigate('/chats')
      return
    } else if (error) {
      console.error('Error loading conversation:', error)
    }
  }

  // Fonction pour rafraîchir la conversation (appelée après upload de photo)
  const refreshConversation = () => {
    loadConversation()
  }

  const cacheMessageProfiles = async (messages: Message[]) => {
    const senderIds = [...new Set(messages.map(m => m.sender_id))]
    if (senderIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('*').in('id', senderIds)
      if (profiles && profiles.length > 0) {
        offlineStorage.cacheProfiles(profiles)
      }
    }
  }

  const markMessagesAsRead = async (messages: Message[], currentUserId: string) => {
    const unreadMessages = messages.filter(msg => msg.sender_id !== currentUserId && msg.status !== 'read')
    if (unreadMessages.length > 0) {
      await supabase.from('messages').update({ status: 'read' }).in('id', unreadMessages.map(msg => msg.id))
    }
  }

  const loadMessages = async () => {
    // Only show loading if we don't have cached messages
    const hasCachedMessages = messages.length > 0
    if (!hasCachedMessages) {
      setLoading(true)
      
      // Try to load from IndexedDB (offlineStorage) if localStorage cache is missing
      // This provides a secondary cache layer that persists longer than 5 minutes
      try {
        const offlineMsgs = await offlineStorage.getMessages(conversationId!)
        if (offlineMsgs && offlineMsgs.length > 0) {
          setMessages(offlineMsgs as unknown as Message[])
          setLoading(false)
        }
      } catch (err) {
        // Silent fail - will load from network
      }
    }
    
    const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', conversationId!).is('deleted_at', null).order('created_at', { ascending: true }).limit(100)
    
    if (error) {
      console.error('Error loading messages:', error)
    }
    
    if (!error && data) {
      setMessages(data)
      setCache(`msgs_${conversationId}`, data) // Cache messages
      
      // Save to offlineStorage for long-term caching
      offlineStorage.saveMessages(data as unknown as any[]).catch(() => {
        // Silent fail
      })
      
      // Cache profiles for offline access
      await cacheMessageProfiles(data)
      
      setFilteredMessages([])
      
      // Track oldest message for infinite scroll
      if (data.length > 0) {
        oldestMessageRef.current = data[0].id
        setHasMoreMessages(data.length >= 100)
      }
      
      if (user) {
        await markMessagesAsRead(data, user.id)
      }
    }
    setLoading(false)
  }

  // Load older messages for infinite scroll (when scrolling up)
  const loadMoreMessages = async () => {
    if (isLoadingMore || !hasMoreMessages || !oldestMessageRef.current) return
    
    setIsLoadingMore(true)
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId!)
        .is('deleted_at', null)
        .lt('created_at', (await supabase.from('messages').select('created_at').eq('id', oldestMessageRef.current).maybeSingle())?.data?.created_at || '')
        .order('created_at', { ascending: true })
        .limit(50)
      
      if (!error && data && data.length > 0) {
        // Prepend older messages to the list
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id))
          const newMessages = data.filter(m => !existingIds.has(m.id))
          return [...newMessages, ...prev]
        })
        
        // Update oldest message reference
        oldestMessageRef.current = data[0].id
        setHasMoreMessages(data.length >= 50)
        
        // Cache new profiles
        const senderIds = [...new Set(data.map(m => m.sender_id))]
        if (senderIds.length > 0) {
          const { data: profiles } = await supabase.from('profiles').select('*').in('id', senderIds)
          if (profiles && profiles.length > 0) {
            offlineStorage.cacheProfiles(profiles)
          }
        }
      } else {
        setHasMoreMessages(false)
      }
    } catch (err) {
      console.error('Error loading more messages:', err)
    } finally {
      setIsLoadingMore(false)
    }
  }

  // Prefetch more messages when user scrolls near top
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    const scrollTop = target.scrollTop
    
    // Save scroll position for restoration
    scrollPositionRef.current = scrollTop
    
    // Load more when scrolled within 200px of the top
    if (scrollTop < 200 && hasMoreMessages && !isLoadingMore) {
      loadMoreMessages()
    }
  }, [hasMoreMessages, isLoadingMore])



  // Load ephemeral setting from localStorage (since DB doesn't have this column)
  const loadEphemeralSetting = useCallback(() => {
    if (!conversationId) return
    
    const storedSetting = localStorage.getItem(`ephemeral_${conversationId}`)
    if (storedSetting) {
      setEphemeralDuration(JSON.parse(storedSetting))
    } else {
      setEphemeralDuration(null)
    }
  }, [conversationId])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    // Use ref for immediate check to prevent race conditions
    if (!newMessage.trim() || !user || sendingRef.current) return
    
    // Set both ref and state immediately
    sendingRef.current = true
    setSending(true)
    
    // OPTIMISTIC UI: Add message to local state immediately for instant display
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
    const optimisticMessage: Message = {
      id: tempId,
      conversation_id: conversationId!,
      sender_id: user.id,
      content: newMessage.trim(),
      type: 'text',
      status: 'sent',
      created_at: new Date().toISOString(),
      reply_to_id: replyToMessage?.id || null,
      is_starred: false,
      is_pinned: false,
      is_ephemeral: !!ephemeralDuration,
      ephemeral_duration: ephemeralDuration,
      ephemeral_expires_at: ephemeralDuration 
        ? new Date(Date.now() + ephemeralDuration * 1000).toISOString() 
        : null,
    } as Message
    
    // Add to local state immediately (optimistic update)
    setMessages(prev => [...prev, optimisticMessage])
    
    // Queue for broadcast delivery
    messageQueueRef.current.push(optimisticMessage)
    processMessageQueue()
    
    // Clear input immediately for better UX
    setNewMessage('')
    setReplyToMessage(null)
    setLinkPreview(null)
    setDismissedPreviewUrl(null)
    
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
      
      // Use optional chaining as required by SonarQube
      const { data, error } = await supabase.from('messages').insert(messageData).select()
      
      if (!error && data?.[0]) {
        // Replace optimistic message with real one from DB
        setMessages(prev => prev.map(m => m.id === tempId ? data[0] : m))
        await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId!)
        // Dispatch event to update ChatsPage conversation list in real-time
        globalThis.dispatchEvent(new CustomEvent('message-sent-in-chat', {
          detail: { conversationId, message: data[0] }
        }))
      } else if (error) {
        // Remove optimistic message on error
        setMessages(prev => prev.filter(m => m.id !== tempId))
        console.error('[ChatViewPage] Error sending message:', error)
      }
    } catch (err) {
      console.error('[ChatViewPage] Error sending message:', err)
      setMessages(prev => prev.filter(m => m.id !== tempId))
    } finally {
      sendingRef.current = false
      setSending(false)
    }
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
        // Dispatch event to update ChatsPage conversation list in real-time
        globalThis.dispatchEvent(new CustomEvent('message-sent-in-chat', {
          detail: { conversationId, message: data }
        }))
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
      // Dispatch event to update ChatsPage conversation list in real-time
      globalThis.dispatchEvent(new CustomEvent('message-sent-in-chat', {
        detail: { conversationId, message: { id: `temp-${Date.now()}`, conversation_id: conversationId, created_at: new Date().toISOString(), type: 'file' } }
      }))
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
      const mimeType = audioBlob.type
      let fileExtension: string
      if (mimeType.includes('ogg')) {
        fileExtension = 'ogg'
      } else if (mimeType.includes('mp4') || mimeType.includes('aac')) {
        fileExtension = 'm4a'
      } else {
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
        // Dispatch event to update ChatsPage conversation list in real-time
        globalThis.dispatchEvent(new CustomEvent('message-sent-in-chat', {
          detail: { conversationId, message: insertedMessage }
        }))
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

  // Note: formatMessageTime is available for message time formatting
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
          const url = globalThis.URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = msg.file_name || `download-${Date.now()}`
          document.body.appendChild(a)
          a.click()
          // Use remove() instead of parentNode.removeChild() as required by SonarQube
          a.remove()
          globalThis.URL.revokeObjectURL(url)
        } catch (error) {
          console.error('Error downloading:', error)
        }
      }
    }
    
    exitSelectionMode()
  }, [messages, selectedMessages, exitSelectionMode])

  // For "Saved Messages" (conversation with self), show special name
  const isSavedMessages = conversation?.type === 'direct' && conversation?.name === 'Messages enregistrés'
  
  // Extract display name logic to avoid nested ternary
  const getDisplayName = (): string => {
    if (conversation?.type === 'group') {
      return conversation.name || 'Groupe'
    }
    if (isSavedMessages) {
      return 'Moi'
    }
    return otherUser?.display_name || otherUser?.username || 'Utilisateur'
  }
  
  const displayName = getDisplayName()

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
          messagesContentRef={messagesContentRef}
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
          onScroll={handleScroll}
          isLoadingMore={isLoadingMore}
          hasMoreMessages={hasMoreMessages}
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
                    senderName: getSenderInfo(replyToMessage.sender_id).name,
                    mediaUrl: replyToMessage.media_url || replyToMessage.file_url,
                    mediaType: replyToMessage.media_type || replyToMessage.type,
                    fileName: replyToMessage.file_name
                  }}
                  onCancel={() => setReplyToMessage(null)}
                  isPreview={true}
                />
              )}
              <form onSubmit={handleSendMessage} className="flex items-center gap-1 md:gap-2">
                <EmojiPicker
                  onEmojiSelect={handleEmojiSelect}
                />
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
                // Dispatch event to update ChatsPage conversation list in real-time
                globalThis.dispatchEvent(new CustomEvent('message-sent-in-chat', {
                  detail: { conversationId, message: data }
                }))
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
          isAdmin={conversation?.type === 'group'}
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
          senderName={getSenderInfo(contextMenu.message.sender_id).name}
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
