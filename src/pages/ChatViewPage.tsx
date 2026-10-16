// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo, lazy, Suspense } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useI18n, tStatic } from '@/i18n'
import { useTheme } from '@/context/ThemeContext'
import { MainLayout } from '@/components/MainLayout'
import { supabase, Message, Conversation, Profile, sendBroadcastMessage } from '@/lib/supabase'
import { signFieldsBatch, resolveMediaUrl, extractStoragePath, buildOpaqueMediaPath } from '@/lib/mediaUrl'
import { createMediaKeysForMessage, fetchMediaRawKey, uploadEncryptedMedia } from '@/lib/encryptedMediaService'
import {
  encryptText,
  createTextKeysForMessage,
  decryptMessageRow,
  decryptMessageRows,
  resolveSealedSenders,
  serializeTextPayload,
  sealSenderForMessage,
  UNDECRYPTABLE_PLACEHOLDER,
  getCachedDecryptedText,
  cacheDecryptedText,
  retryPendingDecryption,
  getPendingDecryptionIds,
  type EncryptedTextPayload,
} from '@/lib/textEncryption'
import { markOwnMessage, isOwnMessage } from '@/lib/ownMessages'
import { tryEncryptWithRatchet } from '@/lib/ratchet/chatIntegration'
import { getMessagingTransport } from '@/lib/transport'
import { downloadMedia } from '@/lib/downloadMedia'
import { offlineStorage } from '@/lib/offlineStorage'
import { applySendJitter } from '@/lib/sendJitter'
import { useUserPresence } from '@/hooks/usePresence'
import { Send, Mic, Plus } from 'lucide-react'
import { MessageReply } from '@/components/MessageReply'
import { MessageSearch } from '@/components/MessageSearch'
import { useMessageReactions } from '@/hooks/useMessageReactions'
import { useCallActions } from '@/context/CallContext'
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
import { QuickReactionBar } from '@/components/QuickReactionBar'
import { ChatHeader, CallLog, TimelineItem, MessageList } from './ChatViewPageComponents'
import type { MessageUserState } from './ChatViewPageComponents'

// Kill-switch : Double Ratchet (forward secrecy) à l'envoi des conversations
// directes. Repli automatique sur la pile X25519/P-256 si indisponible.
//
// Réactivé après correctif d'idempotence (ratchet/decryptCache) : re-déchiffrer
// un message ne ré-avance plus la session (fin des OperationError / OPK
// consommée au rechargement). À REVALIDER en test 2-appareils.
const ENABLE_RATCHET_ON_SEND = true

// Câblage du transport (phases 2/4) : envoi routé via MessagingTransport.
// OFF par défaut — à activer (VITE_TRANSPORT_SEND=1) une fois la réception et
// le backend cible validés. Repli direct Supabase en cas d'échec du transport.
const USE_TRANSPORT_SEND = import.meta.env.VITE_TRANSPORT_SEND === '1'

// Phase 1c — serveur aveugle à l'expéditeur : n'écrit plus `sender_id` en clair.
// L'identité est portée par `sender_sealed` (authentifié, vérifié côté client).
// Risque assumé (directive produit) : les filtres/agrégats SERVEUR par sender_id
// (compteurs non-lus, purge « mes messages ») se dégradent tant qu'ils ne sont
// pas recalculés côté client.
const BLIND_SENDER = true

// Envoi d'un message (média/audio/autre) via le transport quand activé,
// sinon insert Supabase direct (mono-ligne). Repli direct si le transport échoue.
async function insertMessageSingle(messageData: Record<string, unknown>): Promise<{ data: any; error: any }> {
  if (USE_TRANSPORT_SEND) {
    try {
      const transport = getMessagingTransport()
      const res = await transport.sendMessage({
        conversationId: String(messageData.conversation_id ?? ''),
        senderId: String(messageData.sender_id ?? ''),
        content: String(messageData.content ?? ''),
        type: String(messageData.type ?? 'text'),
        replyToId: (messageData.reply_to_id as string) ?? null,
        encryptionMetadata: messageData.encryption_metadata,
        isTextEncrypted: messageData.is_text_encrypted as boolean | undefined,
        senderSealed: (messageData.sender_sealed as string[] | null) ?? null,
        linkPreview: messageData.link_preview,
        mediaUrl: (messageData.media_url as string) ?? null,
        mediaType: (messageData.media_type as string) ?? null,
        mediaThumbnail: (messageData.media_thumbnail as string) ?? null,
        mediaWidth: (messageData.media_width as number) ?? null,
        mediaHeight: (messageData.media_height as number) ?? null,
        fileUrl: (messageData.file_url as string) ?? null,
        fileName: (messageData.file_name as string) ?? null,
        fileSize: (messageData.file_size as number) ?? null,
        isMediaEncrypted: messageData.is_media_encrypted as boolean | undefined,
        ephemeralDuration: (messageData.ephemeral_duration as number) ?? null,
        ephemeralExpiresAt: (messageData.ephemeral_expires_at as string) ?? null,
      })
      return { data: res.raw, error: null }
    } catch (e) {
      console.warn('[transport] envoi échoué, repli direct:', e)
    }
  }
  return await supabase.from('messages').insert(messageData).select().single()
}

// Lazy-load des modals lourds. Ils ne sont jamais rendus au premier paint
// (ouverts uniquement sur action utilisateur), donc ils n'ont pas besoin
// d'être dans le chunk principal de ChatViewPage. Avant : chunk de ~1 MB
// car chacun importait transitivement react-pdf, mediabunny, ImageEditor
// (canvas), EmojiPicker (toutes les emojis), etc. Après : ~250 KB.
const MediaUploader = lazy(() =>
  import('@/components/MediaUploader').then(m => ({ default: m.MediaUploader }))
)
const MediaViewer = lazy(() =>
  import('@/components/MediaViewer').then(m => ({ default: m.MediaViewer }))
)
const VoiceRecorder = lazy(() =>
  import('@/components/VoiceRecorder').then(m => ({ default: m.VoiceRecorder }))
)
const ConversationInfo = lazy(() =>
  import('@/components/ConversationInfo').then(m => ({ default: m.ConversationInfo }))
)
const ForwardMessageModal = lazy(() =>
  import('@/components/ForwardMessageModal').then(m => ({ default: m.ForwardMessageModal }))
)
const EmojiPicker = lazy(() =>
  import('@/components/EmojiPicker').then(m => ({ default: m.EmojiPicker }))
)

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
    String.raw`)*`,
    'gu'
  )
  
  // Find all emojis in the text
  const emojis = trimmed.match(emojiPattern)
  
  if (!emojis) return { isEmoji: false, emojiCount: 0 }
  
  // Check if the entire string is just emojis (with optional whitespace between)
  const emojiString = emojis.join('')
  const textWithoutWhitespace = trimmed.replaceAll(' ', '')
  
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
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return tStatic('callPermError')
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return tStatic('noDeviceError')
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return tStatic('deviceBusyError')
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return tStatic('camIncompatibleError')
  }
  // Erreur WebRTC interne ou réseau — ne pas mentionner "permissions"
  const msg = error?.message || '';
  console.error('[Call] Unexpected error:', name, msg);
  return tStatic('callGenericError', { detail: name || msg || tStatic('unknownError') })
}

const getAudioCallErrorMessage = (error: any): string => {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return tStatic('micPermError')
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return tStatic('noMicError')
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return tStatic('micBusyError')
  }
  const msg = error?.message || '';
  console.error('[Call] Unexpected audio error:', name, msg);
  return tStatic('audioCallGenericError', { detail: name || msg || tStatic('unknownError') })
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
  const { t } = useI18n()
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
  // Miroir ref de l'état `messages`. Les rechargements déclenchés par le poll
  // (`debouncedLoadData`) capturent une closure potentiellement périmée ; ce
  // ref permet de retrouver la version locale la plus récente (aperçu de lien
  // en clair, médias locaux) sans dépendre de la closure React.
  const messagesRef = useRef<Message[]>([])
  const [callLogs, setCallLogs] = useState<CallLog[]>([])
  const [filteredMessages, setFilteredMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState<string>(() => {
    const savedDraft = conversationId ? localStorage.getItem(`draft_${conversationId}`) : null
    return savedDraft || ''
  })
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
  // Role of the current user in this conversation ('admin' | 'member' | null)
  // Used to gate admin-only actions like changing the group avatar.
  const [currentUserRole, setCurrentUserRole] = useState<'admin' | 'member' | null>(null)
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null)
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  // Miroir ref de `isSearching` : `loadMessages` est rappelé par le poll
  // (via `debouncedLoadData`, `useCallback([])` → closure périmée) et ne doit
  // PAS effacer les résultats de recherche tant qu'une recherche est active.
  const isSearchingRef = useRef(false)
  useEffect(() => {
    isSearchingRef.current = isSearching
  }, [isSearching])
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
  // IDs of messages the current user has "deleted for me" (per-user soft delete
  // stored in the `deleted_messages` table). Kept as STATE (not a ref) so that
  // `rawMediaItems` / message list / MediaViewer counter re-render correctly
  // when the user deletes-for-me. A ref mirror is kept for stable access from
  // event handlers (realtime, optimistic updates) without re-creating callbacks.
  const [deletedForMeIds, setDeletedForMeIdsState] = useState<Set<string>>(new Set())
  const deletedForMeIdsRef = useRef<Set<string>>(new Set())
  const setDeletedForMeIds = useCallback((updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setDeletedForMeIdsState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      deletedForMeIdsRef.current = next
      return next
    })
  }, [])

  // ── État message PAR UTILISATEUR (étoile / épingle) ────────────────────────
  // `messages.is_starred` / `is_pinned` sont des colonnes PARTAGÉES : l'action
  // d'un participant affecte tout le monde. On lit/écrit l'état par utilisateur
  // dans `public.message_user_state` (map messageId → état), transmis aux
  // composants d'affichage. Repli rétrocompat : si la table n'existe pas encore
  // (prod non migrée), la map reste vide et l'affichage retombe sur les colonnes
  // partagées historiques.
  const [messageUserState, setMessageUserState] = useState<Map<string, MessageUserState>>(new Map())
  const messageUserStateRef = useRef<Map<string, MessageUserState>>(new Map())
  // `null` = disponibilité de la table inconnue ; `false` = absente (repli actif).
  const userStateTableAvailableRef = useRef<boolean | null>(null)
  // Ref sur l'id utilisateur : ces helpers sont appelés depuis des callbacks au
  // périmètre figé (poll `debouncedLoadData`), il ne faut donc PAS capturer
  // `user` par closure.
  const userIdRef = useRef<string | null>(null)
  useEffect(() => {
    userIdRef.current = user?.id ?? null
  }, [user?.id])

  // État effectif (per-user) d'un message. Sans entrée dans la map (table
  // absente OU message pas encore chargé), repli sur les colonnes partagées.
  const getEffectiveUserState = useCallback((messageId: string): MessageUserState => {
    const known = messageUserStateRef.current.get(messageId)
    if (known) return known
    const legacy = messagesRef.current.find(m => m.id === messageId) as any
    return {
      is_starred: !!legacy?.is_starred,
      is_pinned: !!legacy?.is_pinned,
      pinned_until: legacy?.pinned_until ?? null,
    }
  }, [])

  // Applique un patch à la map per-user (optimiste + rollback). Met à jour la
  // ref pour un accès immédiat depuis les handlers.
  const applyLocalUserState = useCallback((messageId: string, patch: Partial<MessageUserState>) => {
    setMessageUserState(prev => {
      const base = prev.get(messageId) ?? { is_starred: false, is_pinned: false, pinned_until: null as string | null }
      const next = new Map(prev)
      next.set(messageId, { ...base, ...patch })
      messageUserStateRef.current = next
      return next
    })
  }, [])

  // Charge l'état per-user pour une liste d'ids. `available=false` si la table
  // n'existe pas encore → repli colonnes partagées (map vide, on n'écrit rien).
  const fetchMyMessageState = useCallback(async (ids: string[]) => {
    const unique = Array.from(new Set(ids.filter(Boolean)))
    const uid = userIdRef.current
    if (!uid || unique.length === 0) {
      return { available: userStateTableAvailableRef.current !== false, map: new Map<string, MessageUserState>() }
    }
    const { data, error } = await supabase
      .from('message_user_state')
      .select('message_id, is_starred, is_pinned, pinned_until')
      .eq('user_id', uid)
      .in('message_id', unique)
    if (error) {
      userStateTableAvailableRef.current = false
      console.warn('[message_user_state] lecture ignorée (table absente ?):', error.message)
      return { available: false, map: new Map<string, MessageUserState>() }
    }
    userStateTableAvailableRef.current = true
    const map = new Map<string, MessageUserState>()
    // Table disponible → elle fait AUTORITÉ : toute ligne absente = false. Sans
    // cela, on retomberait sur la colonne partagée et le bug « étoilé pour tout
    // le monde » persisterait sur les données historiques.
    for (const id of unique) map.set(id, { is_starred: false, is_pinned: false, pinned_until: null })
    for (const row of (data ?? []) as any[]) {
      map.set(row.message_id, {
        is_starred: !!row.is_starred,
        is_pinned: !!row.is_pinned,
        pinned_until: row.pinned_until ?? null,
      })
    }
    return { available: true, map }
  }, [])

  const mergeMessageUserState = useCallback((map: Map<string, MessageUserState>) => {
    if (map.size === 0) return
    setMessageUserState(prev => {
      const next = new Map(prev)
      map.forEach((v, k) => next.set(k, v))
      messageUserStateRef.current = next
      return next
    })
  }, [])

  // Écriture per-user (upsert). Repli rétrocompat : si la table n'existe pas,
  // on écrit sur les colonnes partagées `messages` (ancien comportement).
  const setMessageState = useCallback(async (messageId: string, patch: Partial<MessageUserState>) => {
    const uid = userIdRef.current
    if (!uid) return { error: new Error('no user') as any }
    const current = getEffectiveUserState(messageId)
    const next = { ...current, ...patch }
    const { error } = await supabase
      .from('message_user_state')
      .upsert({
        message_id: messageId,
        user_id: uid,
        is_starred: !!next.is_starred,
        is_pinned: !!next.is_pinned,
        pinned_until: next.pinned_until ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'message_id,user_id' })
    if (error) {
      const legacy = userStateTableAvailableRef.current === false
        || /does not exist|42P01|schema cache/i.test(error.message ?? '')
      if (legacy) {
        userStateTableAvailableRef.current = false
        const legacyPatch: any = {}
        if (patch.is_starred !== undefined) legacyPatch.is_starred = patch.is_starred
        if (patch.is_pinned !== undefined) {
          legacyPatch.is_pinned = patch.is_pinned
          legacyPatch.pinned_at = patch.is_pinned ? new Date().toISOString() : null
          legacyPatch.pinned_until = patch.pinned_until ?? null
        }
        const res = await supabase.from('messages').update(legacyPatch).eq('id', messageId)
        return { error: res.error as any }
      }
    }
    return { error: error as any }
  }, [getEffectiveUserState])

  // IDs supprimés « pour tout le monde » de façon optimiste, le temps que la
  // mise à jour serveur (`deleted_at`) soit commitée. Filtre les reloads
  // concurrents (poll 4 s, reconnexion) qui, sans cela, feraient réapparaître
  // un message déjà retiré de l'UI — cause du « je suis obligé de faire F5 ».
  const pendingDeletedIdsRef = useRef<Set<string>>(new Set())
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

  // Tient le miroir `messagesRef` à jour (cf. loadMessages / poll).
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // Suppression des messages éphémères : setTimeout adaptatif au lieu de
  // setInterval(1000ms) en boucle. On programme un seul timer jusqu'à la
  // prochaine expiration. Avant : 1 vérif par seconde même quand aucun
  // message n'est éphémère → 60 setMessages/min inutiles, casse la
  // mémoization, draine la batterie. Après : 0 timer si rien d'éphémère,
  // sinon 1 timer programmé pile à l'expiration suivante.
  useEffect(() => {
    const ephemeralTimes = messages
      .filter(m => m.is_ephemeral && m.ephemeral_expires_at)
      .map(m => new Date(m.ephemeral_expires_at!).getTime())

    if (ephemeralTimes.length === 0) return

    const nextExpiration = Math.min(...ephemeralTimes)
    const delay = Math.max(0, nextExpiration - Date.now())

    const timer = setTimeout(() => {
      setMessages(prev => {
        const now = Date.now()
        const valid = prev.filter(msg => {
          if (msg.is_ephemeral && msg.ephemeral_expires_at) {
            return new Date(msg.ephemeral_expires_at).getTime() > now
          }
          return true
        })
        return valid.length !== prev.length ? valid : prev
      })
    }, delay)

    return () => clearTimeout(timer)
  }, [messages])

  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  const longPressMessageRef = useRef<Message | null>(null)
  
  // State for infinite scroll and prefetching
  const [hasMoreMessages, setHasMoreMessages] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const oldestMessageRef = useRef<string | null>(null)
  const scrollPositionRef = useRef(0)
  
  const { reactions, addReaction, removeReaction } = useMessageReactions(conversationId || '')
  // useCallActions au lieu de useCall : ne renvoie que les méthodes
  // (référence stable) → ChatViewPage ne re-render plus à chaque
  // changement d'état d'appel (toggle audio/vidéo, stream update, etc.).
  const { startCall, startGroupCall } = useCallActions()
  const { permission, requestPermission, sendNotification, subscribeToConversation, unsubscribeFromConversation } = useNotifications()
  const { wallpaper } = useTheme()
  const isMobile = useIsMobile()
  
  // Get real-time presence status for the other user
  const { statusText: otherUserStatusText, isOnline: otherUserIsOnline } = useUserPresence(otherUser?.id)
  
  // Garde-fou : un message ENCORE marqué chiffré (is_text_encrypted=true) ne doit
// JAMAIS afficher son contenu brut (ciphertext base64). Après déchiffrement,
// `decryptMessageRows` passe is_text_encrypted à false → le clair s'affiche ;
// sinon → placeholder 🔒 (jamais de base64 à l'écran, quel que soit le chemin).
  const displayedMessages = useMemo(() => {
    // Recherche : quand la barre est ouverte, on affiche UNIQUEMENT les
    // résultats — même vides. Avant, `filteredMessages.length > 0 ? ... :
    // messages` faisait réapparaître TOUT le fil dès qu'une recherche ne
    // renvoyait rien (et le poll écrasait `filteredMessages` par []).
    const base = isSearching ? filteredMessages : messages
    return base.map(m => {
      if (!(m as any).is_text_encrypted) return m
      // Si on a déjà déchiffré ce message (cache par id), on affiche le clair
      // même si l'état a été ré-écrit par la version ciphertext (race d'état).
      const cached = getCachedDecryptedText(m.id)
      if (cached !== undefined) return { ...m, content: cached, is_text_encrypted: false }
      return { ...m, content: UNDECRYPTABLE_PLACEHOLDER }
    })
  }, [filteredMessages, messages, isSearching])

  // ── Re-tentative de déchiffrement (message reçu AVANT ses clés) ───────────
  // `textEncryption` conserve le ciphertext d'un message indéchiffrable et
  // expose `retryPendingDecryption`/`getPendingDecryptionIds`. Sans appel, un
  // message dont les clés enveloppées (`message_text_keys`) arrivent APRÈS
  // restait bloqué sur le cadenas jusqu'à un rechargement. On planifie ici une
  // re-tentative avec un backoff court après chaque échec, et on ré-injecte le
  // clair dès qu'il arrive (jamais de ciphertext à l'écran).
  const decryptionRetryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const refreshDecryptedMessage = useCallback((id: string, text: string) => {
    setMessages(prev => prev.map(m => (
      m.id === id ? ({ ...m, content: text, is_text_encrypted: false } as Message) : m
    )))
  }, [])

  const scheduleDecryptionRetry = useCallback((id: string) => {
    const uid = user?.id
    if (!uid || decryptionRetryTimersRef.current.has(id)) return
    const MAX_ATTEMPTS = 6
    const attemptRetry = async (attempt: number): Promise<void> => {
      if (attempt > 0) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, Math.min(1000 * 2 ** (attempt - 1), 30000))
          decryptionRetryTimersRef.current.set(id, timer)
        })
      }
      decryptionRetryTimersRef.current.delete(id)
      let text: string | null = null
      try {
        text = await retryPendingDecryption(id, uid)
      } catch {
        text = null
      }
      if (text !== null) {
        refreshDecryptedMessage(id, text)
        return
      }
      if (attempt < MAX_ATTEMPTS) await attemptRetry(attempt + 1)
    }
    void attemptRetry(0)
  }, [user?.id, refreshDecryptedMessage])

  // Planifie la re-tentative de TOUS les messages en attente (couvre aussi les
  // ids hors du fil courant). Idempotent : dédupliqué par id.
  const schedulePendingDecryptionRetries = useCallback(() => {
    for (const id of getPendingDecryptionIds()) scheduleDecryptionRetry(id)
  }, [scheduleDecryptionRetry])

  useEffect(() => () => {
    decryptionRetryTimersRef.current.forEach(timer => clearTimeout(timer))
    decryptionRetryTimersRef.current.clear()
  }, [])

  // Helper function to get sender info for a message (works for both direct and group conversations)
  const getSenderInfo = useCallback((senderId: string): { name: string; avatar?: string } => {
    // If it's the current user
    if (senderId === user?.id) {
      return {
        name: profile?.display_name || profile?.username || t('you'),
        avatar: profile?.avatar_url ?? undefined
      }
    }
    
    // For group conversations, look up in groupMemberProfiles
    if (conversation?.type === 'group') {
      const memberProfile = groupMemberProfiles.get(senderId)
      if (memberProfile) {
        return {
          name: memberProfile.display_name || memberProfile.username || t('userFallback'),
          avatar: memberProfile.avatar_url ?? undefined
        }
      }
    }
    
    // For direct conversations, use otherUser
    if (otherUser) {
      return {
        name: otherUser.display_name || otherUser.username || t('userFallback'),
        avatar: otherUser.avatar_url ?? undefined
      }
    }
    
    // Fallback
    return { name: t('userFallback'), avatar: undefined }
  }, [user?.id, profile, conversation?.type, groupMemberProfiles, otherUser])

  // Collect all media from messages for navigation in MediaViewer.
  // On construit d'abord la liste brute (paths nus), puis on signe
  // les URLs en batch pour que la navigation ← → fonctionne.
  const rawMediaItems = useMemo(() => {
    // Ensure messages is always an array
    const msgs = Array.isArray(messages) ? messages : []
    return msgs
      .filter(m => {
        // WhatsApp-style: never expose deleted media in the navigator.
        // - `deleted_at` = "delete for everyone" (soft delete on the row)
        // - `deletedForMeIds` = "delete for me" (per-user soft delete)
        // Both must be excluded so the counter and prev/next match what the
        // user actually sees in the thread.
        if ((m as any).deleted_at) return false
        if (deletedForMeIds.has(m.id)) return false

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
          isOwn: (m.sender_id === user?.id || isOwnMessage(m.id)),
          messageId: m.id,
          // Per-item download metadata so the viewer's download button can save
          // the file under its original name and decrypt E2EE entries.
          fileName: m.file_name ?? undefined,
          isEncrypted: !!(m as any).is_media_encrypted,
        }
      })
  }, [messages, user?.id, getSenderInfo, deletedForMeIds])

  // URLs signées pour la navigation viewer — on résout en batch
  // quand la liste brute change. Les GIFs/stickers ont déjà des https,
  // seuls les paths du bucket privé sont signés.
  const [allMediaItems, setAllMediaItems] = useState(rawMediaItems)

  useEffect(() => {
    let cancelled = false
    const resolveAll = async () => {
      // Résolution parallèle de toutes les URLs
      const resolved = await Promise.all(
        rawMediaItems.map(async (item) => {
          if (!item.url || item.url.startsWith('http')) return item // déjà URL complète
          try {
            const signed = await resolveMediaUrl(item.url)
            return signed ? { ...item, url: signed } : item
          } catch {
            return item
          }
        })
      )
      if (!cancelled) setAllMediaItems(resolved)
    }
    resolveAll()
    return () => { cancelled = true }
  }, [rawMediaItems])

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

  // Regroupement WhatsApp-style : médias consécutifs du même expéditeur
  // envoyés à moins de 30s d'écart sont groupés en un seul "album".
  const mediaAlbumMap = useMemo(() => {
    const ALBUM_GAP_MS = 30_000
    const map = new Map<string, { isLeader: boolean; leaderId: string; members: typeof messages }>()
    const msgs = Array.isArray(messages) ? messages : []

    const isAlbumCandidate = (m: typeof messages[0]) =>
      !!m.media_url && (m.media_type === 'image' || m.media_type === 'video') && m.type !== 'audio'

    let i = 0
    while (i < msgs.length) {
      const m = msgs[i]
      if (!isAlbumCandidate(m)) {
        i++
        continue
      }
      // Démarrer une chaîne potentielle
      const group = [m]
      let j = i + 1
      while (j < msgs.length) {
        const next = msgs[j]
        if (!isAlbumCandidate(next)) break
        if (next.sender_id !== m.sender_id) break
        const prev = group[group.length - 1]
        const dt = new Date(next.created_at).getTime() - new Date(prev.created_at).getTime()
        if (dt > ALBUM_GAP_MS) break
        group.push(next)
        j++
      }
      if (group.length >= 2) {
        const leaderId = group[0].id
        group.forEach((gm, idx) => {
          map.set(gm.id, { isLeader: idx === 0, leaderId, members: group })
        })
      }
      i = j
    }
    return map
  }, [messages])

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
      // 20261035 : caller_id/callee_id sont des pseudonymes serveur. On déduit
      // le sens (sortant/entrant) du pseudonyme de l'utilisateur courant, comme
      // dans CallsPage.
      let myRef: string | null = null
      try {
        const { data: ref } = await supabase.rpc('current_user_ref')
        myRef = typeof ref === 'string' ? ref : null
      } catch {
        // pas de RPC (migration non appliquée) → repli « entrant »
      }
      setCallLogs(data.map((c: any) => ({
        ...c,
        is_outgoing: !!myRef && c.caller_id === myRef,
      })))
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
    const { error } = await supabase.from('messages').update({ status }).eq('id', messageId)
    if (error) {
      console.error('[ChatViewPage] Error updating message status:', error)
    }
  }

  // Helper to update a message in the list
  const updateMessageInList = (currentMessages: Message[], updatedMsg: Message): Message[] => {
    return currentMessages.map(m => m.id === updatedMsg.id ? updatedMsg : m)
  }

  // Helper to remove a message from the list
  const removeMessageFromList = (currentMessages: Message[], deletedId: string): Message[] => {
    return currentMessages.filter(m => m.id !== deletedId)
  }

  // Remplace le message optimiste (`temp-*`) par la ligne réelle de façon
  // IDEMPOTENTE. Si la ligne réelle a déjà été injectée par le Realtime
  // (broadcast ou postgres_changes) pendant l'aller-retour d'insertion, on ne
  // crée PAS une seconde entrée : sinon DOUBLON (temp + réel, ou 2× le même
  // id réel). On préserve l'ordre (remplacement en place) et on nettoie le temp.
  const settleOptimisticMessage = useCallback((tempId: string, realMsg: Message) => {
    // Sealed sender : la ligne réelle peut avoir `sender_id` NULL. On mémorise
    // systématiquement son id RÉEL comme « envoyé par moi » (l'id temp ne
    // suffit pas : il disparaît du state et n'est jamais persisté).
    markOwnMessage(realMsg.id)
    setMessages(prev => {
      const alreadyHasReal = prev.some(m => m.id === realMsg.id)
      if (alreadyHasReal) {
        return prev
          .map(m => m.id === realMsg.id ? realMsg : m)
          .filter(m => m.id !== tempId)
      }
      if (prev.some(m => m.id === tempId)) {
        return prev.map(m => m.id === tempId ? realMsg : m)
      }
      return prev
    })
  }, [])

  const otherUserRef = useRef<Profile | null>(null)
  
  useEffect(() => {
    otherUserRef.current = otherUser
  }, [otherUser])

  // Helper to handle notifications for new messages (extracted to reduce complexity)
  const handleNewMessageNotification = useCallback(async (newMsg: Message, senderId: string) => {
    if (!document.hidden) {
      await updateMessageStatus(newMsg.id, 'read')
    } else {
      await updateMessageStatus(newMsg.id, 'delivered')
      if (permission === 'granted') {
        const currentOtherUser = otherUserRef.current
        const senderName = currentOtherUser?.display_name || currentOtherUser?.username || 'Quelqu\'un'
        const preview = newMsg.type === 'text' ? newMsg.content : '📎 Fichier'
        sendNotification(senderName, preview, { conversationId, messageId: newMsg.id, url: `/chat/${conversationId}` })
      }
    }
  }, [permission, conversationId, sendNotification])

  // Helper to handle new message insertion with deduplication and optimistic update replacement
  const handleNewMessage = useCallback(async (payload: any) => {
    const newMsg = payload.new as Message
    // WhatsApp-style defensive guards: never inject a message that the
    // server already marked deleted, that the current user soft-deleted
    // for themselves, or whose ephemeral lifetime has already expired.
    // Without these, MediaViewer's count and prev/next navigation drift
    // out of sync with what's actually rendered in the thread.
    if ((newMsg as any).deleted_at) return
    if (deletedForMeIdsRef.current.has(newMsg.id)) return
    if ((newMsg as any).is_ephemeral && (newMsg as any).ephemeral_expires_at) {
      const expiresAt = new Date((newMsg as any).ephemeral_expires_at).getTime()
      if (expiresAt <= Date.now()) return
    }

    // Déchiffrement E2EE du texte : le serveur ne stocke/ne pousse que du
    // ciphertext. On restaure le clair AVANT la déduplication par contenu,
    // sinon le message optimiste (clair) et la ligne DB (ciphertext) ne
    // matcheraient jamais et créeraient un doublon.
    // ⚠️ Ne JAMAIS laisser un échec de déchiffrement bloquer l'injection
    // du message temps réel (sinon le message n'apparaît jamais → « pas de
    // temps réel »). On encapsule donc strictement.
    //
    // Sealed sender (Phase 1c) : résolution de l'expéditeur RÉEL pour TOUT
    // message temps réel, pas seulement le texte chiffré. `sender_id` est NULL
    // côté serveur ; sans résolution, les médias (albums regroupés par
    // sender_id) fusionnent entre expéditeurs et l'alignement « mes messages »
    // est faux. `decryptMessageRow` ne le fait que pour les messages chiffrés.
    if (user) {
      try {
        await resolveSealedSenders([newMsg as any], user.id)
      } catch (e) {
        console.warn('[sealedSender] résolution temps réel échouée (sender_id conservé):', e)
      }
    }
    if ((newMsg as any).is_text_encrypted && user) {
      try {
        await decryptMessageRow(newMsg as any, user.id)
      } catch (e) {
        console.warn('[E2EE] decrypt realtime échoué, message conservé:', e)
      }
    }
    // Message toujours indéchiffrable (clés enveloppées pas encore arrivées) :
    // on planifie une re-tentative avec backoff → dès que la clé arrive, le
    // clair remplace le cadenas sans attendre un rechargement.
    if ((newMsg as any).is_text_encrypted) schedulePendingDecryptionRetries()

    // Signer les paths storage (bucket privé) avant injection dans le state.
    // On skip la signature pour les médias chiffrés E2EE (télécharge auto via fetchAndDecryptMedia).
    // ⚠️ On capture les valeurs BRUTES AVANT signature : `signFieldsBatch` MUTE
    // `media_url`/`file_url` en URL signée, ce qui cassait le rapprochement avec
    // le message optimiste (temp) et créait des DOUBLONS de médias.
    const rawMediaUrl = (newMsg as any).media_url
    const rawFileUrl = (newMsg as any).file_url
    if (!(newMsg as any).is_media_encrypted) {
      try {
        await signFieldsBatch([newMsg as any], ['media_url', 'file_url', 'media_thumbnail'])
      } catch (e) {
        // Ne JAMAIS bloquer l'injection temps réel sur un échec de signature
        // (sinon le message n'apparaît qu'après rechargement).
        console.warn('[realtime] signature média échouée (paths conservés):', e)
      }
    }

    setMessages(prev => {
      // 1. Message déjà présent (par ID) → ne jamais réinjecter. Dédup broadcast
      //    + postgres_changes, et on conserve la version locale (qui peut porter
      //    l'aperçu de lien en clair).
      if (prev.some(m => m.id === newMsg.id)) {
        return prev
      }

      // 2. Rapprochement de l'éventuel message optimiste (`temp-*`) à remplacer.
      const tempIndex = prev.findIndex(m => {
        if (!m.id.startsWith('temp-')) return false
        if (newMsg.sender_id && m.sender_id !== newMsg.sender_id) return false
        // Texte / GIF / sticker : comparaison sur le contenu (déjà déchiffré).
        if (m.type === 'text' && newMsg.type === 'text') {
          return m.content === newMsg.content
        }
        // Média / doc / vocal : comparer le PATH BRUT (avant signature) et des
        // indices stables (file_url, nom de fichier).
        const tempMedia = (m as any).media_url ?? (m as any).file_url
        if (tempMedia) {
          if (rawMediaUrl && tempMedia === rawMediaUrl) return true
          if (rawFileUrl && tempMedia === rawFileUrl) return true
        }
        if ((m as any).file_name && (newMsg as any).file_name && (m as any).file_name === (newMsg as any).file_name) return true
        return false
      })

      if (tempIndex !== -1) {
        const temp = prev[tempIndex]
        const merged: any = { ...newMsg }
        // Ne jamais perdre la version locale : aperçu de lien en clair et média
        // local encore non résolu côté serveur.
        if (!merged.link_preview && (temp as any).link_preview) {
          merged.link_preview = (temp as any).link_preview
        }
        if (!merged.media_url && (temp as any).media_url) {
          merged.media_url = (temp as any).media_url
        }
        const newMessages = [...prev]
        newMessages[tempIndex] = merged
        return newMessages
      }

      return [...prev, newMsg]
    })
    
    // Handle notification if not own message.
    // Sealed sender : mes propres messages ont `sender_id` NULL → l'ancien test
    // `sender_id !== user.id` était VRAI et déclenchait une auto-notification
    // (+ marquage lu) de mes propres messages. On exclut explicitement les ids
    // que l'on a envoyés via le registre local `isOwnMessage`.
    if (user && !isOwnMessage(newMsg.id) && newMsg.sender_id !== user.id) {
      handleNewMessageNotification(newMsg, newMsg.sender_id ?? '')
    }
  }, [user, handleNewMessageNotification, schedulePendingDecryptionRetries])

  // Ref stable pour le handler realtime : le canal ne doit PAS se re-souscrire
  // à chaque changement d'identité du callback (sinon statut CLOSED/SUBSCRIBED
  // en boucle → messages manqués → « pas de temps réel »).
  const handleNewMessageRef = useRef(handleNewMessage)
  useEffect(() => {
    handleNewMessageRef.current = handleNewMessage
  }, [handleNewMessage])

  // Handler UPDATE Realtime : la ligne serveur est BRUTE (ciphertext, sender_id
  // NULL, media paths non signés). Avant, elle était injectée telle quelle →
  // ciphertext affiché en base64, aperçus de lien/médias locaux écrasés, bulle
  // décalée (sender NULL). On déchiffre, on résout le scellé, on signe les
  // médias ET on préserve les champs purement locaux (link_preview, media_url
  // déjà résolu).
  const handleMessageUpdate = useCallback(async (payload: any) => {
    const updatedMsg = payload.new as Message
    if (!updatedMsg?.id) return
    if (updatedMsg.deleted_at) {
      setMessages(prev => removeMessageFromList(prev, updatedMsg.id))
      return
    }

    if (user) {
      try {
        await resolveSealedSenders([updatedMsg as any], user.id)
      } catch (e) {
        console.warn('[sealedSender] résolution UPDATE échouée (sender_id conservé):', e)
      }
      if ((updatedMsg as any).is_text_encrypted) {
        try {
          await decryptMessageRow(updatedMsg as any, user.id)
        } catch (e) {
          console.warn('[E2EE] decrypt UPDATE échoué, message conservé:', e)
        }
      }
      // Toujours indéchiffrable → re-tentative avec backoff (clés en route).
      if ((updatedMsg as any).is_text_encrypted) schedulePendingDecryptionRetries()
    }

    // Signe les paths storage (médias non chiffrés) comme à l'injection INSERT.
    const rawMediaUrl = (updatedMsg as any).media_url
    const rawFileUrl = (updatedMsg as any).file_url
    if (!(updatedMsg as any).is_media_encrypted) {
      try {
        await signFieldsBatch([updatedMsg as any], ['media_url', 'file_url', 'media_thumbnail'])
      } catch (e) {
        console.warn('[realtime] signature média UPDATE échouée (paths conservés):', e)
      }
    }

    setMessages(prev => {
      const existing = prev.find(m => m.id === updatedMsg.id)
      if (existing) {
        const local = existing as any
        // Ne JAMAIS écraser un aperçu de lien / média local par une version
        // serveur qui ne les porte pas (le link_preview est replié dans le
        // payload chiffré, absent de la ligne brute).
        if (!(updatedMsg as any).link_preview && local.link_preview) {
          (updatedMsg as any).link_preview = local.link_preview
        }
        if (!rawMediaUrl && local.media_url) {
          (updatedMsg as any).media_url = local.media_url
        }
        if (!rawFileUrl && local.file_url) {
          (updatedMsg as any).file_url = local.file_url
        }
        // Si le déchiffrement a échoué mais qu'on connaît déjà le clair, on
        // conserve le clair au lieu d'écraser par le placeholder/ciphertext.
        if ((updatedMsg as any).is_text_encrypted) {
          const cached = getCachedDecryptedText(updatedMsg.id)
          if (cached !== undefined) {
            (updatedMsg as any).content = cached
            ;(updatedMsg as any).is_text_encrypted = false
          }
        }
      }
      return updateMessageInList(prev, updatedMsg)
    })
  }, [user, schedulePendingDecryptionRetries])

  const handleMessageUpdateRef = useRef(handleMessageUpdate)
  useEffect(() => {
    handleMessageUpdateRef.current = handleMessageUpdate
  }, [handleMessageUpdate])

  // CRITICAL STABILITY FIX: Prevent multiple simultaneous data loads
  const isLoadingDataRef = useRef(false)
  const lastLoadTimeRef = useRef(0)
  const initialLoadDoneRef = useRef(false)
  const lastLoadedConvRef = useRef<string | null>(null)
  
  // Debounced load function to prevent request spam - WHATSAPP STYLE
  const debouncedLoadData = useCallback(() => {
    const now = Date.now()
    // Only allow reload every 10 seconds minimum (WhatsApp style)
    if (now - lastLoadTimeRef.current < 10000) {
      return
    }
    if (isLoadingDataRef.current) {
      return
    }
    
    // Silent reload - no console spam
    isLoadingDataRef.current = true
    lastLoadTimeRef.current = now
    
    // Load sequentially using async/await to reduce nesting
    const loadDataSequentially = async () => {
      try {
        await loadMessages()
        await loadConversation()
      } catch (error) {
        console.error('[ChatViewPage] Error in sequential load:', error)
      } finally {
        await loadCallLogs()
        isLoadingDataRef.current = false
      }
    }
    loadDataSequentially()
  }, [])

  useEffect(() => {
    if (!conversationId || !user) return

    // Self-healing membership : s'assure d'être membre (sinon RLS bloque
    // SELECT/INSERT → fil vide + envoi impossible après suppr./ré-ajout).
    supabase
      .from('conversation_members')
      .upsert(
        { conversation_id: conversationId, user_id: user.id, role: 'member' },
        { onConflict: 'conversation_id,user_id', ignoreDuplicates: true },
      )
      .then(() => undefined, () => undefined)

    // Reset du garde-fou quand on CHANGE de conversation : sinon la nouvelle
    // conversation ne charge jamais ses messages → fil vide.
    if (lastLoadedConvRef.current !== conversationId) {
      lastLoadedConvRef.current = conversationId
      initialLoadDoneRef.current = false
      lastLoadTimeRef.current = 0
    }

    // WHATSAPP-LEVEL STABILITY: Only load once on mount
    // Real-time updates come through the channel, not polling
    if (!initialLoadDoneRef.current) {
      initialLoadDoneRef.current = true
      lastLoadTimeRef.current = Date.now()
      
      // Initial load complete
      // Load sequentially using async/await to reduce nesting
      const loadInitialData = async () => {
        try {
          await loadMessages()
          await loadConversation()
        } finally {
          await loadCallLogs()
        }
        // Course « nouvelle conversation » : la membership peut ne pas être
        // encore propagée côté RLS → 0 message. On vérifie et on retente.
        setTimeout(async () => {
          try {
            const { count } = await supabase
              .from('messages')
              .select('id', { count: 'exact', head: true })
              .eq('conversation_id', conversationId)
            if (count && count > 0) {
              lastLoadTimeRef.current = 0
              await loadMessages()
            }
          } catch {
            // ignore
          }
        }, 2500)
      }
      loadInitialData()
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
    // Phase 2 : DEUX canaux séparés — « messagerie » d'un côté (prérequis pour
    // router la réception via un transport décentralisé), « application » de
    // l'autre (appels, profils, appartenance, présence). Comportement identique.
    const msgChannel = supabase
      .channel(`msg:${conversationId}`, {
        config: { broadcast: { self: false } }
      })
      // Messages INSERT
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => handleNewMessageRef.current(payload))
      // Messages UPDATE
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        // Délègue au handler asynchrone (déchiffrement + sealed sender +
        // préservation des champs locaux). Ne JAMAIS injecter la ligne brute.
        handleMessageUpdateRef.current(payload)
      })
      // Messages DELETE
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        const deletedId = payload.old?.id
        if (deletedId) {
          setMessages(prev => removeMessageFromList(prev, deletedId))
        }
      })
      // Broadcast for instant message delivery
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        if (payload?.message) {
          handleNewMessageRef.current({ new: payload.message })
        }
      })
      .subscribe((status) => {
      })

    const appChannel = supabase
      .channel(`app:${conversationId}`, {
        config: { presence: { key: user?.id || 'anonymous' } }
      })
      // Call logs changes
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'call_logs',
        filter: `conversation_id=eq.${conversationId}`
      }, () => {
        loadCallLogs()
      })
      // Profile updates
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'profiles'
      }, (payload) => {
        if (otherUser && payload.new.id === otherUser.id) {
          setOtherUser(payload.new as Profile)
        }
      })
      // Member left
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'conversation_members',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        if (payload.old && payload.old.user_id === user?.id) {
          navigate('/chats')
        }
      })
      .subscribe((status) => {
      })

    // Handle visibility change - WHATSAPP STYLE: NO reload on visibility change
    // The realtime channel handles updates, no need to poll
    const handleVisibilityChange = () => {
      // Only log, don't reload - realtime channel handles updates
      if (document.visibilityState === 'visible') {
        // Tab visible, realtime channel active
        // Mark unread messages as read when coming back to the tab
        if (user) {
          setMessages(currentMessages => {
            markMessagesAsRead(currentMessages, user.id);
            return currentMessages;
          });
        }
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

    // Filet de sécurité anti-F5 : rafraîchit la conversation ouverte si le
    // Realtime ne délivre pas (onglet visible). 4 s = ressenti quasi temps réel.
    const fallbackPoll = setInterval(() => {
      if (document.visibilityState === 'visible') {
        debouncedLoadData()
      }
    }, 4000)

    return () => {
      clearTimeout(loadingTimeout)
      clearInterval(fallbackPoll)
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      try {
        supabase.removeChannel(msgChannel)
        supabase.removeChannel(appChannel)
      } catch {
        // Ignore channel removal errors
      }
      unsubscribeFromConversation(conversationId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      globalThis.removeEventListener('supabase-reconnected', handleSupabaseReconnect)
      globalThis.removeEventListener('call-log-created', handleCallLogCreated as EventListener)
    }
  }, [conversationId, user?.id, permission, debouncedLoadData])

  // Track previous message count to detect new messages
  const prevMessageCountRef = useRef(0)
  const hasScrolledInitially = useRef(false)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesContentRef = useRef<HTMLDivElement>(null)
  const [isInitialScrollDone, setIsInitialScrollDone] = useState(false)
  const scrollAttemptsRef = useRef(0)
  // « Suivre le bas » : à l'ouverture d'une conversation on doit atterrir sur le
  // message le plus récent et y RESTER. Les médias (images/vidéos) se chargent
  // en différé et agrandissent la liste APRÈS le scroll initial → l'ancien code
  // ne recollait en bas que si on était à <150px, donc la vue dérivait vers les
  // anciens messages (surtout en responsive/mobile où les médias sont plus
  // grands). Tant que l'utilisateur reste en bas, on re-colle à chaque
  // changement de taille ; dès qu'il remonte, on arrête de le ramener.
  const stickToBottomRef = useRef(true)
  
  // Reset initial scroll flag when conversation changes - MUST run before scroll effect
  useLayoutEffect(() => {
    hasScrolledInitially.current = false
    prevMessageCountRef.current = 0
    scrollAttemptsRef.current = 0
    stickToBottomRef.current = true
    setIsInitialScrollDone(false)
  }, [conversationId])

  // WHATSAPP-STYLE: Scroll to bottom with multiple attempts for perfect positioning
  useLayoutEffect(() => {
    // Only run when messages are loaded and we haven't scrolled yet for this conversation
    if (loading || !conversationId) return
    
    // If no messages and no call logs, we are done
    if (timelineItems.length === 0) {
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
        prevMessageCountRef.current = timelineItems.length
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
        prevMessageCountRef.current = timelineItems.length
      }
    }, 2000)
    
    return () => {
      clearTimeout(initialTimeout)
      safetyTimeouts.forEach(t => clearTimeout(t))
      clearTimeout(finalTimeout)
    }
  }, [loading, timelineItems.length, conversationId])

  // ResizeObserver to handle dynamic content changes (images loading, etc.)
  useEffect(() => {
    const scrollContainer = messagesContainerRef.current
    const contentContainer = messagesContentRef.current
    
    if (!scrollContainer || !contentContainer) return

    // Function to handle resize
    const handleResize = () => {
      const el = messagesContainerRef.current
      if (!el) return

      // Suivi du bas : tant que l'utilisateur est en bas (ouverture de la
      // conversation, nouveau message), on re-colle en bas à CHAQUE changement
      // de taille du contenu — c'est ce qui rattrape l'agrandissement des médias
      // chargés en différé. S'il a remonté, on ne corrige que s'il est proche
      // du bas (comportement « rester en bas » classique).
      if (stickToBottomRef.current) {
        el.scrollTop = el.scrollHeight
        return
      }

      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150
      if (isNearBottom) {
        el.scrollTop = el.scrollHeight
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
    if (!loading && timelineItems.length > 0 && hasScrolledInitially.current) {
      if (timelineItems.length > prevMessageCountRef.current) {
        // New message added - scroll smoothly
        const behavior = getScrollBehavior()
        stickToBottomRef.current = true
        messagesEndRef.current?.scrollIntoView({ behavior })
        prevMessageCountRef.current = timelineItems.length
      }
    }
  }, [loading, timelineItems.length])

  // Note: scrollToBottom is implemented via messagesEndRef.scrollIntoView
  // Extract ternary for scroll behavior
  const getScrollBehavior = (): ScrollBehavior => {
    if (timelineItems.length > prevMessageCountRef.current) {
      return 'smooth'
    }
    return 'instant'
  }

  // Debounced function to fetch link preview.
  // 250ms est un bon compromis : on évite de spammer l'edge function pendant
  // que l'utilisateur tape, mais le skeleton apparaît rapidement.
  const debouncedFetchPreview = useCallback(
    debounce(async (url: string) => {
      const preview = await fetchLinkPreview(url)
      setLinkPreview(preview)
      setIsLoadingPreview(false)
    }, 250),
    []
  )

  // Effect to detect URLs in input and fetch preview
  useEffect(() => {
    const url = getFirstPreviewUrl(newMessage)

    if (url && url !== dismissedPreviewUrl) {
      // Only fetch if URL changed
      if (linkPreview?.url !== url) {
        // Allume le skeleton IMMÉDIATEMENT pour que l'UX soit
        // « instantanée », même si la requête prend quelques centaines
        // de ms. Ça évite l'effet « rien ne se passe » que voyait l'user.
        setIsLoadingPreview(true)
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
      const cachedProfiles = Array.from(cachedProfilesMap.values()) as Profile[]
      
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
      if (cachedProfile) return cachedProfile as Profile
      
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
      // Signer l'avatar (bucket privé)
      if (data.avatar_url) {
        data.avatar_url = (await resolveMediaUrl(data.avatar_url)) ?? data.avatar_url
      }
      setConversation(data)
      setCache(`conv_${conversationId}`, data)
      
      if (data.type === 'group') {
        // Charger le rôle de l'utilisateur courant dans cette conversation
        // pour décider s'il peut modifier l'avatar/description du groupe.
        // Le créateur est implicitement considéré comme admin (cohérent
        // avec la RLS `created_by = auth.uid()` côté serveur).
        if (user?.id) {
          if (data.created_by === user.id) {
            setCurrentUserRole('admin')
          } else {
            const { data: memberRow } = await supabase
              .from('conversation_members')
              .select('role')
              .eq('conversation_id', conversationId!)
              .eq('user_id', user.id)
              .maybeSingle()
            const role = (memberRow?.role as 'admin' | 'member' | undefined) ?? null
            setCurrentUserRole(role)
          }
        }

        const profileMap = await loadGroupMembers(conversationId!)
        // Signer les avatars de tous les membres
        await signFieldsBatch(Array.from(profileMap.values()) as any[], ['avatar_url'])
        setGroupMemberProfiles(profileMap)
      } else if (data.type === 'direct') {
        const otherUserData = await loadDirectConversationUser(conversationId!, user!.id)
        if (otherUserData) {
          if (otherUserData.avatar_url) {
            otherUserData.avatar_url = (await resolveMediaUrl(otherUserData.avatar_url)) ?? otherUserData.avatar_url
          }
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
    const senderIds = [...new Set(messages.map(m => m.sender_id))].filter((id): id is string => !!id)
    if (senderIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('*').in('id', senderIds)
      if (profiles && profiles.length > 0) {
        offlineStorage.cacheProfiles(profiles)
      }
    }
  }

  async function markMessagesAsRead(messages: Message[], currentUserId: string) {
    // Sealed sender : mes propres messages ont un `sender_id` NULL → l'ancien
    // test `sender_id !== currentUserId` les considérait comme reçus et les
    // marquait « lus ». On exclut explicitement mes envois via `isOwnMessage`.
    const unreadMessages = messages.filter(
      msg => !isOwnMessage(msg.id) && msg.sender_id !== currentUserId && msg.status !== 'read'
    )
    if (unreadMessages.length === 0) return

    const conversationIdRef = unreadMessages[0]?.conversation_id
    if (!conversationIdRef) return

    // Utilise la RPC mark_messages_as_read (SECURITY DEFINER) pour bypass
    // d'\u00e9ventuels probl\u00e8mes RLS sur la table messages. Met \u00e0 jour TOUS les
    // messages non-lus de la conv en une seule requ\u00eate.
    // Phase 1c : le serveur ne connait plus l'expediteur (sender_id NULL).
    // On marque par identifiants explicites — l'expediteur a deja ete resolu
    // cote client, on ne retient que les messages recus non lus.
    const ids = unreadMessages.map(msg => msg.id)
    const { error } = await supabase
      .from('messages')
      .update({ status: 'read' })
      .in('id', ids)
    if (error) {
      console.error('[ChatViewPage] mark-as-read UPDATE failed:', error)
      return
    }

    const updatedCount = ids.length

    // Mise \u00e0 jour optimiste de l'\u00e9tat local
    setMessages(prev =>
      prev.map(m =>
        !isOwnMessage(m.id) && m.sender_id !== currentUserId && m.status !== 'read'
          ? { ...m, status: 'read' as const }
          : m
      )
    )

    // Notifier ChatsPage pour qu'elle remette le compteur \u00e0 0 imm\u00e9diatement
    globalThis.dispatchEvent(new CustomEvent('messages-marked-read', {
      detail: { conversationId: conversationIdRef, count: updatedCount }
    }))
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
          setMessages(offlineMsgs as Message[])
          setLoading(false)
        }
      } catch {
        // Silent fail - will load from network
      }
    }
    
    // Load in parallel: the message page AND the user's "delete for me"
    // entries for this conversation. Without this, messages the user
    // previously deleted-for-me would resurface on every reload (refresh,
    // reconnect, navigation) and pollute MediaViewer's count + navigation.
    const [messagesRes, deletedForMeRes] = await Promise.all([
      supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId!)
        .is('deleted_at', null)
        .or(`ephemeral_expires_at.is.null,ephemeral_expires_at.gt.${new Date().toISOString()}`)
        .order('created_at', { ascending: true })
        .limit(100),
      user
        ? supabase
            .from('deleted_messages')
            .select('message_id')
            .eq('user_id', user.id)
        : Promise.resolve({ data: [] as { message_id: string }[], error: null as any }),
    ])

    const { data, error } = messagesRes

    // Build the deleted-for-me set BEFORE applying it to messages so the
    // UI never flashes a message the user already removed locally.
    let deletedForMeSet = deletedForMeIdsRef.current
    if (!deletedForMeRes.error && deletedForMeRes.data) {
      // UNION (et non remplacement) : un « supprimer pour moi » optimiste dont
      // l'INSERT est encore en vol ne doit pas être annulé par un reload qui a
      // interrogé la table avant le commit — sinon le message ressuscite.
      deletedForMeSet = new Set<string>([
        ...deletedForMeIdsRef.current,
        ...(deletedForMeRes.data as { message_id: string }[]).map(r => r.message_id),
      ])
      setDeletedForMeIds(deletedForMeSet)
    }

    if (error) {
      console.error('Error loading messages:', error)
    }

    if (!error && data) {
      // Filter out expired ephemeral messages AND messages the user
      // soft-deleted-for-themselves (delete-for-me).
      const now = Date.now();
      const validData = data.filter(msg => {
        if (deletedForMeSet.has(msg.id)) return false;
        if (pendingDeletedIdsRef.current.has(msg.id)) return false;
        if (msg.is_ephemeral && msg.ephemeral_expires_at) {
          const expiresAt = new Date(msg.ephemeral_expires_at).getTime();
          return expiresAt > now;
        }
        return true;
      });

      // Affichage IMMÉDIAT des messages avec les paths storage nus.
      // Les composants <MediaImg> + useMediaUrl signeront les URLs en
      // arrière-plan via getMediaUrl (cache mémoire dans mediaUrl.ts) et
      // re-rendront chaque image dès que sa signed URL est prête.
      // Avant, on bloquait jusqu'à 3s ici → écran vide pendant 3s sur 3G
      // si la conv a beaucoup de médias. Maintenant : 0ms d'attente.
      // Déchiffrement E2EE : restaure le clair des messages chiffrés avant
      // de les injecter dans le state (le cache local garde donc du clair,
      // ce qui est acceptable car il ne quitte jamais l'appareil).
      if (user) {
await decryptMessageRows(validData as any[], user.id)
          for (let i = 0; i < validData.length; i++) ((validData as any[])[i]) = { ...(validData as any[])[i] }
          // Messages indéchiffrables (clés pas encore arrivées) : re-tentative
          // planifiée avec backoff (cf. schedulePendingDecryptionRetries).
          schedulePendingDecryptionRetries()
      }

      // ── Local-first : le serveur ne garde pas tout (rétention type
      // WhatsApp). On fusionne l'historique LOCAL DURABLE (IndexedDB) avec ce
      // que renvoie le serveur. Les messages locaux plus ANCIENS que la fenêtre
      // serveur (= historique purgé côté serveur) sont conservés ; les messages
      // récents absents du serveur (supprimés pour moi / pour tout le monde) ne
      // sont PAS ressuscités.
      let localHistory: Message[] = []
      try {
        localHistory = (await offlineStorage.getMessages(conversationId!)) as Message[]
      } catch {
        // ignore : on retombe sur l'état en mémoire
      }
      const localById = new Map<string, Message>()
      for (const m of [...localHistory, ...messagesRef.current]) localById.set(m.id, m)

      // Report de l'aperçu de lien / des médias locaux depuis la version locale.
      // Le `link_preview` est replié DANS le payload chiffré et, pour nos propres
      // messages, le déchiffrement « cache ratchet » (mine) ne le restaure pas →
      // sans ce report, l'aperçu (carte + miniature) disparaissait au
      // rechargement (poll toutes les ~4 s) en ne laissant que l'URL en texte.
      for (const row of validData as any[]) {
        const local = localById.get(row.id) as any
        if (!local) continue
        if (!row.link_preview && local.link_preview) row.link_preview = local.link_preview
        if (!row.media_url && local.media_url) row.media_url = local.media_url
      }

      const validIds = new Set(validData.map(m => m.id))
      const oldestServerTs = validData.length > 0 ? Date.parse(validData[0].created_at) : Number.POSITIVE_INFINITY
      const nowTs = Date.now()
      const localOnly = [...localById.values()].filter(m => {
        if (validIds.has(m.id)) return false
        if (deletedForMeSet.has(m.id)) return false
        if (pendingDeletedIdsRef.current.has(m.id)) return false
        if (typeof m.id === 'string' && m.id.startsWith('temp-')) return true
        if (m.is_ephemeral && m.ephemeral_expires_at && Date.parse(m.ephemeral_expires_at) <= nowTs) return false
        const ts = Date.parse(m.created_at)
        return Number.isFinite(ts) && ts < oldestServerTs
      })
      const merged: Message[] = [...localOnly, ...validData]
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))

      setMessages(merged)
      setCache(`msgs_${conversationId}`, merged)

      // État star/pin PAR UTILISATEUR des messages chargés (repli silencieux si
      // `message_user_state` n'existe pas encore).
      try {
        const { map } = await fetchMyMessageState(merged.map(m => m.id))
        mergeMessageUserState(map)
      } catch (e) {
        console.warn('[message_user_state] chargement ignoré:', e)
      }

      // Pré-signer les médias non chiffrés EN PARALLÈLE pour que les URLs
      // soient prêtes au moment où MediaImg les demande. signFieldsBatch
      // mute aussi les objets en place — on déclenche un re-render léger
      // ensuite via une nouvelle référence de tableau.
      const nonEncrypted = validData.filter((m: any) => !m.is_media_encrypted)
      if (nonEncrypted.length > 0) {
        signFieldsBatch(nonEncrypted as any[], ['media_url', 'file_url', 'media_thumbnail'])
          .then(() => {
            // Force un re-render avec les URLs maintenant signées
            setMessages(prev => [...prev])
          })
          .catch(e => {
            console.warn('[loadMessages] signFieldsBatch failed (paths kept raw):', e)
          })
      }
      
      // Save to offlineStorage for long-term caching (historique durable local)
      offlineStorage.saveMessages(merged as any[]).catch(() => {
        // Silent fail
      })
      
      // Cache profiles for offline access
      await cacheMessageProfiles(validData)
      
      // Ne pas écraser les résultats de recherche actifs (le poll tourne
      // toutes les ~4 s ; sans ce garde-fou les résultats disparaissaient).
      if (!isSearchingRef.current) setFilteredMessages([])
      
      // Track oldest message for infinite scroll
      if (validData.length > 0) {
        oldestMessageRef.current = validData[0].id
        setHasMoreMessages(validData.length >= 100) // Still use original data length for pagination logic? Actually, if we filtered some out, we might need to load more, but this is fine for now.
      }
      
      if (user) {
        await markMessagesAsRead(validData, user.id)
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
          .or(`ephemeral_expires_at.is.null,ephemeral_expires_at.gt.${new Date().toISOString()}`)
          .lt('created_at', (await supabase.from('messages').select('created_at').eq('id', oldestMessageRef.current).maybeSingle())?.data?.created_at || '')
          .order('created_at', { ascending: true })
          .limit(50)
      
      if (!error && data && data.length > 0) {
        // Filter out expired ephemeral messages AND messages the user
        // soft-deleted-for-themselves (delete-for-me) — paginated history
        // must respect the same rules as initial load.
        const now = Date.now();
        const deletedForMeSet = deletedForMeIdsRef.current
        const validData = data.filter(msg => {
          if (deletedForMeSet.has(msg.id)) return false;
          if (pendingDeletedIdsRef.current.has(msg.id)) return false;
          if (msg.is_ephemeral && msg.ephemeral_expires_at) {
            const expiresAt = new Date(msg.ephemeral_expires_at).getTime();
            return expiresAt > now;
          }
          return true;
        });

        // Déchiffrement E2EE des messages paginés avant affichage.
        if (user) {
await decryptMessageRows(validData as any[], user.id)
        // ⚠️ `decryptMessageRows` mute `content` EN PLACE (même référence objet)
        // → `MessageItem` (React.memo) ne re-rendait pas et gardait le ciphertext
        // déjà affiché. On force de NOUVELLES références pour les lignes déchiffrées.
        for (let i = 0; i < validData.length; i++) ((validData as any[])[i]) = { ...(validData as any[])[i] }
        // Indéchiffrables (clés pas encore arrivées) → re-tentative avec backoff.
        schedulePendingDecryptionRetries()
        }

        // Prepend older messages to the list
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id))
          const newMessages = validData.filter(m => !existingIds.has(m.id))
          return [...newMessages, ...prev]
        })

        // État star/pin PAR UTILISATEUR des messages paginés.
        try {
          const { map } = await fetchMyMessageState(validData.map(m => m.id))
          mergeMessageUserState(map)
        } catch (e) {
          console.warn('[message_user_state] chargement paginé ignoré:', e)
        }
        
        // Update oldest message reference
        oldestMessageRef.current = data[0].id
        setHasMoreMessages(data.length >= 50)
        
        // Cache new profiles
        const senderIds = [...new Set(validData.map(m => m.sender_id))].filter((id): id is string => !!id)
        if (senderIds.length > 0) {
          const { data: profiles } = await supabase.from('profiles').select('*').in('id', senderIds)
          if (profiles && profiles.length > 0) {
            offlineStorage.cacheProfiles(profiles)
          }
        }
      } else {
        setHasMoreMessages(false)
      }
    } catch (loadError) {
      console.error('Error loading more messages:', loadError)
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

    // Suivre le bas : on n'évalue le flag qu'APRÈS le scroll initial, sinon un
    // simple event transitoire (changement de conversation, remise à zéro de
    // scrollTop) le remettrait à faux avant qu'on ait atteint le bas.
    if (hasScrolledInitially.current) {
      const distanceFromBottom = target.scrollHeight - scrollTop - target.clientHeight
      stickToBottomRef.current = distanceFromBottom < 80
    }
    
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
    // Using crypto.getRandomValues for better randomness (not for security, just for unique IDs)
    const randomBytes = new Uint8Array(8);
    crypto.getRandomValues(randomBytes);
    const randomStr = Array.from(randomBytes).map(b => b.toString(36).padStart(2, '0')).join('').substring(0, 9);
    const tempId = `temp-${Date.now()}-${randomStr}`;
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
      // Aperçu de lien affiché IMMÉDIATEMENT, et conservé jusqu'au remplacement
      // par la ligne réelle : sinon la carte pouvait disparaître au rechargement.
      link_preview: linkPreview ? JSON.stringify({
        url: linkPreview.url,
        title: linkPreview.title,
        description: linkPreview.description,
        image: linkPreview.image,
        siteName: linkPreview.siteName,
        domain: linkPreview.domain,
      }) : null,
      is_ephemeral: !!ephemeralDuration,
      ephemeral_duration: ephemeralDuration,
      ephemeral_expires_at: ephemeralDuration 
        ? new Date(Date.now() + ephemeralDuration * 1000).toISOString() 
        : null,
    } as Message
    
    // Add to local state immediately (optimistic update)
    setMessages(prev => [...prev, optimisticMessage])
    // FAIL-CLOSED (fuite de clair Realtime) : on ne diffuse JAMAIS le message
    // optimiste (texte en clair). Le broadcast est mis en file APRÈS chiffrement
    // + insertion des clés, avec la ligne CHIFFRÉE (cf. plus bas). Le broadcast
    // ne sert qu'à l'instantanéité ; il ne doit transporter que du ciphertext.

    // Clear input immediately for better UX
    setNewMessage('')
    setReplyToMessage(null)
    setLinkPreview(null)
    setDismissedPreviewUrl(null)
    
    try {
      const plaintext = newMessage.trim()
      const messageData: any = {
        conversation_id: conversationId!, sender_id: BLIND_SENDER ? null : user.id, content: plaintext,
        type: 'text', status: 'sent', reply_to_id: replyToMessage?.id || null,
      }

      // Aperçu de lien : rangé DANS l'enveloppe chiffrée quand le message
      // est chiffré (le serveur ne voit alors aucune métadonnée de lien).
      const linkPreviewPayload = linkPreview ? {
        url: linkPreview.url,
        title: linkPreview.title,
        description: linkPreview.description,
        image: linkPreview.image,
        siteName: linkPreview.siteName,
        domain: linkPreview.domain,
      } : null

      // E2EE du texte : clé AES unique au message, enveloppée pour chaque
      // destinataire (l'émetteur inclus, pour relire ses propres messages).
      // FAIL-CLOSED : si le chiffrement échoue, on ANNULE l'envoi — plus aucun
      // repli en clair (le serveur ne doit jamais voir le texte).
      let encryptedText: EncryptedTextPayload
      try {
        // 1) X25519 TOUJOURS (clé AES enveloppée par destinataire) → repli
        // garanti : TOUT destinataire peut déchiffrer, même sans clés ratchet.
        encryptedText = await encryptText(plaintext, linkPreviewPayload)
        messageData.content = encryptedText.ciphertextB64
        messageData.is_text_encrypted = true
        const meta: Record<string, unknown> = { v: 1, iv: encryptedText.ivB64 }

        // 2) Double Ratchet en SURCOUCHE (forward secrecy) quand disponible.
        // Les clés X25519 restent enregistrées (repli) même si le ratchet marche.
        try {
          const ratchet = ENABLE_RATCHET_ON_SEND && conversationId
            ? await tryEncryptWithRatchet(user.id, conversationId, serializeTextPayload(plaintext, linkPreviewPayload))
            : null
          if (ratchet) {
            meta.ratchet = ratchet.encryptionMetadata
            meta.ratchetContent = ratchet.content
          }
        } catch (rErr) {
          console.warn('[E2EE] ratchet indisponible, X25519 seul:', rErr)
        }

        messageData.encryption_metadata = meta
      } catch (encErr) {
        // FAIL-CLOSED : on n'envoie JAMAIS le message en clair. On annule
        // l'optimistic update et on rend le texte à l'utilisateur.
        console.error('[E2EE] chiffrement du texte échoué — envoi annulé (fail-closed):', encErr)
        setMessages(prev => prev.filter(m => m.id !== tempId))
        setNewMessage(plaintext)
        alert(t('messageSendError'))
        return
      }
      
      if (ephemeralDuration) {
        const expiresAt = new Date()
        expiresAt.setSeconds(expiresAt.getSeconds() + ephemeralDuration)
        messageData.is_ephemeral = true
        messageData.ephemeral_duration = ephemeralDuration
        messageData.ephemeral_expires_at = expiresAt.toISOString()
      }
      
      // Phase 1 (sealed sender v3) : l'identité est scellée APRÈS insertion
      // (l'id du message n'est connu qu'à ce moment) → `sender_sealed` est
      // attaché juste après la création des clés (voir plus bas).

      // Jitter anti-analyse temporelle : décalage réseau aléatoire borné, APRÈS
      // l'affichage optimiste (UI toujours instantanée) et AVANT l'insertion
      // réseau / la diffusion. N'affecte pas l'accusé de réception optimiste.
      await applySendJitter()

      // Use optional chaining as required by SonarQube
      let insertResult: { data: any; error: any }
      if (USE_TRANSPORT_SEND) {
        // Envoi via l'abstraction de transport (phases 2/4). Repli direct si échec.
        try {
          const transport = getMessagingTransport()
          const res = await transport.sendMessage({
            conversationId: conversationId!,
            senderId: user.id,
            content: messageData.content,
            type: messageData.type,
            replyToId: messageData.reply_to_id ?? null,
            encryptionMetadata: messageData.encryption_metadata,
            isTextEncrypted: messageData.is_text_encrypted,
            senderSealed: messageData.sender_sealed,
            linkPreview: messageData.link_preview,
            ephemeralDuration: messageData.ephemeral_duration,
            ephemeralExpiresAt: messageData.ephemeral_expires_at,
          })
          insertResult = { data: [res.raw], error: null }
        } catch (transportErr) {
          console.warn('[transport] envoi via transport échoué, repli direct:', transportErr)
          insertResult = await supabase.from('messages').insert(messageData).select()
        }
      } else {
        insertResult = await supabase.from('messages').insert(messageData).select()
      }

      // FAIL-CLOSED : plus de repli en clair si la migration E2EE n'est pas
      // appliquée (colonnes/tables absentes). On laisse l'erreur remonter :
      // mieux vaut un échec visible qu'un message en clair stocké au serveur.

      const { data, error } = insertResult
      
      if (!error && data?.[0]) {
        // Persiste les clés enveloppées (une par destinataire, incl. soi).
        // FAIL-CLOSED : sans ces clés le message (déjà chiffré) serait
        // indéchiffrable → on supprime la ligne au lieu de la laisser cassée.
        try {
          await createTextKeysForMessage({
            messageId: data[0].id,
            senderId: user.id,
            conversationId: conversationId!,
            rawKey: encryptedText.rawKey,
          })
        } catch (keyErr) {
          console.error('[E2EE] création des clés texte échouée — annulation du message:', keyErr)
          await supabase.from('messages').delete().eq('id', data[0].id)
          setMessages(prev => prev.filter(m => m.id !== tempId))
          setNewMessage(plaintext)
          alert(t('messageSendError'))
          return
        }

        // Phase 1 (sealed sender v3) : scelle l'identité liée au message
        // (id + conversation + hash du contenu) et l'attache à la ligne.
        // Best-effort : un échec conserve `sender_id` côté client.
        const sealedSender: string[] | null = conversationId
          ? await sealSenderForMessage({
              messageId: data[0].id,
              senderId: user.id,
              conversationId,
              content: messageData.content,
            })
          : null

        // Replace optimistic message with real one from DB, en conservant
        // le texte en clair côté client (jamais le ciphertext à l'écran).
        const settled: any = { ...(data[0] as Message), content: plaintext, sender_id: (data[0] as any).sender_id ?? user.id }
        // Mémorise le clair de CE message envoyé (l'expéditeur ne peut pas
        // re-déchiffrer ses propres messages ratchet → sans ça, 🔒 après reload).
        cacheDecryptedText(data[0].id, plaintext)
        markOwnMessage(data[0].id)
        // Conserve l'aperçu en clair côté client (le serveur n'a que le ciphertext).
        if (!settled.link_preview && linkPreviewPayload) {
          settled.link_preview = JSON.stringify(linkPreviewPayload)
        }
        settleOptimisticMessage(tempId, settled)
        // Diffusion Realtime APRÈS chiffrement : on envoie la ligne CHIFFRÉE
        // (ciphertext + enveloppe), JAMAIS le `settled` en clair. Les clés sont
        // déjà en base → le destinataire déchiffre dès réception (latence conservée).
        messageQueueRef.current.push({
          ...(data[0] as Message),
          sender_sealed: sealedSender ?? undefined,
          content: encryptedText.ciphertextB64,
          is_text_encrypted: true,
          encryption_metadata: messageData.encryption_metadata,
          link_preview: null,
        } as Message)
        processMessageQueue()
        await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId!)
        // Dispatch event to update ChatsPage conversation list in real-time
        globalThis.dispatchEvent(new CustomEvent('message-sent-in-chat', {
          detail: { conversationId, message: settled }
        }))
      } else if (error) {
        // Remove optimistic message on error
        setMessages(prev => prev.filter(m => m.id !== tempId))
        console.error('[ChatViewPage] Error sending message:', error)
        alert(t('messageSendError'))
      }
    } catch (sendError) {
      console.error('[ChatViewPage] Error sending message:', sendError)
      setMessages(prev => prev.filter(m => m.id !== tempId))
      alert(t('messageSendError'))
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  // Type for uploaded file data from MediaUploader
  type UploadedFileData = {
    url: string;
    type: 'image' | 'video' | 'file' | 'audio';
    fileName: string;
    fileSize: number;
    width?: number;
    height?: number;
    thumbnail?: string;
    duration?: number;
  };

  const handleMediaUploadComplete = async (fileData: UploadedFileData) => {
    if (!user) return
    setSending(true)
    
    const { url, type, fileName, fileSize, width, height, thumbnail } = fileData
    const isEncrypted = !!(fileData as any).encrypted
    const encryptionKey = (fileData as any).encryptionKey as Uint8Array | undefined
    const mediaIv = (fileData as any).mediaIv as string | undefined

    // FAIL-CLOSED : un média non chiffré (ou sans clé/IV) ne doit JAMAIS partir
    // en clair. MediaUploader échoue explicitement désormais ; on refuse ici par
    // défense en profondeur AVANT tout insert / optimistic update.
    if (!isEncrypted || !encryptionKey || !mediaIv) {
      console.error('[E2EE] média non chiffré (encrypted=false) — envoi annulé (fail-closed)')
      alert(t('messageSendError'))
      setSending(false)
      return
    }

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
      is_ephemeral: !!ephemeralDuration,
      ephemeral_duration: ephemeralDuration,
      ephemeral_expires_at: ephemeralDuration 
        ? new Date(Date.now() + ephemeralDuration * 1000).toISOString() 
        : null,
    } as unknown as Message

    setMessages(prev => [...prev, optimisticMessage])
    setNewMessage('')
    setReplyToMessage(null)
    setShowMediaUploader(false)

    try {
      const caption = newMessage.trim()
      const messageData: any = {
        conversation_id: conversationId!, sender_id: user.id, content: caption,
        type, status: 'sent', reply_to_id: optimisticMessage.reply_to_id,
        media_url: url, media_type: type, file_name: fileName, file_size: fileSize,
        file_url: url, // Fallback for older schema
      }
      // Le média est toujours chiffré ici (garde en tête de fonction).
      messageData.is_media_encrypted = true

      // FAIL-CLOSED : la légende est du TEXTE → elle doit être chiffrée comme un
      // message texte (sinon elle partirait en clair vers le serveur). Les clés
      // texte enveloppées sont créées après l'insert (comme pour un message texte).
      let captionEnc: EncryptedTextPayload | null = null
      if (caption) {
        try {
          captionEnc = await encryptText(caption, null)
          messageData.content = captionEnc.ciphertextB64
          messageData.is_text_encrypted = true
          messageData.encryption_metadata = { v: 1, iv: captionEnc.ivB64 }
        } catch (encErr) {
          console.error('[E2EE] chiffrement de la légende échoué — envoi annulé (fail-closed):', encErr)
          setMessages(prev => prev.filter(m => m.id !== tempId))
          alert(t('messageSendError'))
          return
        }
      }

      // Add image dimensions if available
      if (width && height) {
        messageData.media_width = width
        messageData.media_height = height
      }
      if (thumbnail) {
        messageData.media_thumbnail = thumbnail
      }

      // Add ephemeral fields if enabled
      if (ephemeralDuration) {
        messageData.is_ephemeral = true
        messageData.ephemeral_duration = ephemeralDuration
        messageData.ephemeral_expires_at = ephemeralDuration
          ? new Date(Date.now() + ephemeralDuration * 1000).toISOString()
          : null
      }

      // Jitter anti-analyse temporelle : après l'affichage optimiste, avant l'envoi réseau.
      await applySendJitter()

      // INSERT du message.
      const insertResult = await supabase.from('messages').insert(messageData).select().single()
      // FAIL-CLOSED : plus de repli « sans is_media_encrypted ». Si la migration
      // E2EE n'est pas appliquée, on préfère un échec visible plutôt qu'un média
      // chiffré stocké sans son flag (indéchiffrable côté destinataire).
      const { data, error } = insertResult

      if (!error && data) {
        // Légende chiffrée : clés texte enveloppées (comme un message texte).
        // FAIL-CLOSED : sans elles la légende serait indéchiffrable.
        if (captionEnc) {
          try {
            await createTextKeysForMessage({
              messageId: data.id,
              senderId: user.id,
              conversationId: conversationId!,
              rawKey: captionEnc.rawKey,
            })
          } catch (keyErr) {
            console.error('[E2EE] clés texte de la légende échouées — annulation:', keyErr)
            await supabase.from('messages').delete().eq('id', data.id)
            setMessages(prev => prev.filter(m => m.id !== tempId))
            alert(t('messageSendError'))
            return
          }
        }
        // Média chiffré (garanti par la garde en tête de fonction) : créer les
        // clés enveloppées pour chaque destinataire. FAIL-CLOSED : sans ces clés
        // le média serait indéchiffrable → on supprime la ligne et on annule
        // l'optimistic update.
        try {
          const result = await createMediaKeysForMessage({
            messageId: data.id,
            senderId: user.id,
            conversationId: conversationId!,
            rawKey: encryptionKey,
            mediaIvBase64: mediaIv,
          })
          if (result.missingKeys.length > 0) {
            console.warn('[E2EE] Membres sans clé publique (média non déchiffrable pour eux):', result.missingKeys)
          }
        } catch (e) {
          console.error('[E2EE] Échec de création des clés enveloppées — annulation du média:', e)
          await supabase.from('messages').delete().eq('id', data.id)
          setMessages(prev => prev.filter(m => m.id !== tempId))
          alert(t('messageSendError'))
          return
        }

        // Phase 1 (sealed sender v3) : scelle l'identité liée au message
        // (id + conversation + hash du contenu) et l'attache à la ligne média.
        const sealedSender: string[] | null = conversationId
          ? await sealSenderForMessage({
              messageId: data.id,
              senderId: user.id,
              conversationId,
              content: String(messageData.content ?? ''),
            })
          : null

        // Replace optimistic message with real one, en conservant la légende en
        // clair côté client (jamais le ciphertext à l'écran).
        const settledMedia: any = { ...data, content: caption, sender_id: data.sender_id ?? user.id }
        if (caption) cacheDecryptedText(data.id, caption)
        // Sealed sender : `sender_id` peut être NULL côté serveur → on mémorise
        // l'id RÉEL comme « envoyé par moi » pour que l'alignement (droite)
        // survive au rechargement / à l'écho realtime (sender_id NULL).
        markOwnMessage(data.id)
        settleOptimisticMessage(tempId, settledMedia)
        // Diffusion Realtime : la ligne RÉELLE (chemins storage + enveloppe
        // éventuelle), jamais le blob local. Garantit l'arrivée instantanée des
        // MÉDIAS/FICHIERS (le garde-fou ne bloque que le texte non chiffré).
        messageQueueRef.current.push({ ...(data as unknown as Message), sender_sealed: sealedSender ?? undefined } as Message)
        processMessageQueue()
        await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId!)
        // Dispatch event to update ChatsPage conversation list in real-time
        globalThis.dispatchEvent(new CustomEvent('message-sent-in-chat', {
          detail: { conversationId, message: settledMedia }
        }))
      } else {
        // Remove optimistic message on error
        setMessages(prev => prev.filter(m => m.id !== tempId))
        console.error('Error sending message:', error)
        alert(t('messageSendError'))
      }
    } catch (uploadError) {
      console.error('Error sending message:', uploadError)
      setMessages(prev => prev.filter(m => m.id !== tempId))
      alert(t('messageSendError'))
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
          is_pinned: false,
          is_ephemeral: !!ephemeralDuration,
          ephemeral_duration: ephemeralDuration,
          ephemeral_expires_at: ephemeralDuration 
            ? new Date(Date.now() + ephemeralDuration * 1000).toISOString() 
            : null,
        } as unknown as Message
        tempMessages.push(optimisticMessage)
    })
    
    // Update state immediately
    setMessages(prev => [...prev, ...tempMessages])
    setNewMessage('')
    setReplyToMessage(null)
    setShowMediaUploader(false)

    let fileErrorCount = 0
    try {
      // Jitter anti-analyse temporelle : un seul décalage borné pour le lot,
      // après l'affichage optimiste et avant les insertions réseau.
      await applySendJitter()

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
        
        // Chiffrement E2EE : marquer le message + créer les clés wrappées
        const isEncrypted = !!(file as any).encrypted
        const encryptionKey = (file as any).encryptionKey as Uint8Array | undefined
        const mediaIv = (file as any).mediaIv as string | undefined
        // FAIL-CLOSED : pas de média non chiffré / sans clé vers le serveur.
        if (!isEncrypted || !encryptionKey || !mediaIv) {
          console.error('[E2EE] média non chiffré (multi) — envoi annulé (fail-closed)')
          setMessages(prev => prev.filter(m => m.id !== tempId))
          fileErrorCount++
          continue
        }
        messageData.is_media_encrypted = true

        // Add ephemeral fields if enabled
        if (ephemeralDuration) {
          messageData.is_ephemeral = true
          messageData.ephemeral_duration = ephemeralDuration
          messageData.ephemeral_expires_at = ephemeralDuration 
            ? new Date(Date.now() + ephemeralDuration * 1000).toISOString() 
            : null
        }
        
        const insertResult = await insertMessageSingle(messageData)
        // FAIL-CLOSED : plus de repli « sans is_media_encrypted ».
        const { data, error } = insertResult
        
        if (!error && data) {
          // Créer les clés enveloppées pour les médias chiffrés.
          // FAIL-CLOSED : si la création échoue, on supprime la ligne et on
          // annule l'optimistic update (média sinon indéchiffrable).
          try {
            const result = await createMediaKeysForMessage({
              messageId: data.id,
              senderId: user.id,
              conversationId: conversationId!,
              rawKey: encryptionKey,
              mediaIvBase64: mediaIv,
            })
            if (result.missingKeys.length > 0) {
              console.warn('[E2EE] Membres sans clé publique:', result.missingKeys)
            }
          } catch (e) {
            console.error('[E2EE] Échec création clés enveloppées (multi) — annulation:', e)
            await supabase.from('messages').delete().eq('id', data.id)
            setMessages(prev => prev.filter(m => m.id !== tempId))
            fileErrorCount++
            continue
          }
          // Phase 1 (sealed sender v3) : scelle l'identité du fichier (id +
          // conversation + hash du contenu) et l'attache à la ligne.
          const sealedSender: string[] | null = conversationId
            ? await sealSenderForMessage({
                messageId: data.id,
                senderId: user.id,
                conversationId,
                content: String(messageData.content ?? ''),
              })
            : null
          const settledFile = { ...data, sender_id: data.sender_id ?? user.id, sender_sealed: sealedSender ?? undefined } as unknown as Message
          // Sealed sender : id RÉEL mémorisé comme « à moi » (chaque fichier).
          markOwnMessage(data.id)
          settleOptimisticMessage(tempId, settledFile)
          // Diffusion Realtime de chaque fichier (ligne réelle, chemins storage).
          messageQueueRef.current.push(settledFile)
        } else {
            // Remove failed message
            setMessages(prev => prev.filter(m => m.id !== tempId))
            fileErrorCount++
        }
      }
      
      // Émet la diffusion en une passe après la boucle (tous les fichiers en file).
      processMessageQueue()
      await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId!)
      // Dispatch event to update ChatsPage conversation list in real-time
      globalThis.dispatchEvent(new CustomEvent('message-sent-in-chat', {
        detail: { conversationId, message: { id: `temp-${Date.now()}`, conversation_id: conversationId, created_at: new Date().toISOString(), type: 'file' } }
      }))
      if (fileErrorCount > 0) {
        alert(t('messageSendError'))
      }
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
      // Chemin OPAQUE (ni uid, ni horodatage) : sealed sender préservé pour le
      // vocal, comme pour images/vidéos/documents (cf. buildOpaqueMediaPath).
      const fileName = buildOpaqueMediaPath(conversationId!, fileExtension)

      // E2EE : on chiffre le vocal AVANT l'upload (comme images/vidéos/docs).
      // Le bucket ne contient qu'un blob opaque ; la clé AES est enveloppée par
      // destinataire dans `message_media_keys` (createMediaKeysForMessage plus bas).
      const encrypted = await uploadEncryptedMedia(audioBlob, fileName)

      // On stocke le path nu (pas l'URL signée). L'URL est régénérée au chargement.
      const now = new Date().toISOString()
      const tempId = `temp-${Date.now()}`
      
      const messageData: any = {
        conversation_id: conversationId!, sender_id: user.id, content: '', type: 'audio', status: 'sent',
        reply_to_id: replyToMessage?.id || null, media_url: encrypted.path, media_type: 'audio',
        file_name: `voice-${Date.now()}.${fileExtension}`, file_size: encrypted.originalSize,
        file_url: encrypted.path, // Fallback for older schema
        is_media_encrypted: true,
      }
      
      // Add ephemeral fields if enabled
      if (ephemeralDuration) {
        messageData.is_ephemeral = true
        messageData.ephemeral_duration = ephemeralDuration
        messageData.ephemeral_expires_at = ephemeralDuration 
          ? new Date(Date.now() + ephemeralDuration * 1000).toISOString() 
          : null
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
        media_url: encrypted.path,   // path nu — résolu en URL signée / déchiffré à l'affichage
        media_type: 'audio',
        file_name: messageData.file_name,
        file_size: encrypted.originalSize,
        reply_to_id: replyToMessage?.id || null,
        is_media_encrypted: true,
        is_ephemeral: !!ephemeralDuration,
        ephemeral_duration: ephemeralDuration,
        ephemeral_expires_at: ephemeralDuration
          ? new Date(Date.now() + ephemeralDuration * 1000).toISOString()
          : null,
      } as unknown as Message
      
      setMessages(prev => [...prev, optimisticMessage])
      setReplyToMessage(null)
      
      // Jitter anti-analyse temporelle : après l'optimiste, avant l'envoi réseau.
      await applySendJitter()

      // Insert into database
      const { data: insertedMessage, error } = await insertMessageSingle(messageData)
      
      if (!error && insertedMessage) {
        // Clés média enveloppées : sans elles le destinataire (et l'expéditeur
        // sur un autre appareil) ne peut pas déchiffrer le vocal.
        // FAIL-CLOSED : on annule le message plutôt que de laisser un vocal
        // chiffré indéchiffrable.
        try {
          await createMediaKeysForMessage({
            messageId: insertedMessage.id,
            senderId: user.id,
            conversationId: conversationId!,
            rawKey: encrypted.rawKey,
            mediaIvBase64: encrypted.mediaIvBase64,
          })
        } catch (e) {
          console.error('[E2EE] Échec création clés média vocal — annulation:', e)
          await supabase.from('messages').delete().eq('id', insertedMessage.id)
          setMessages(prev => prev.filter(m => m.id !== tempId))
          alert(t('voiceSendError'))
          return
        }
        // Phase 1 (sealed sender v3) : scelle l'identité du vocal (id +
        // conversation + hash du contenu) et l'attache à la ligne.
        const sealedSender: string[] | null = conversationId
          ? await sealSenderForMessage({
              messageId: insertedMessage.id,
              senderId: user.id,
              conversationId,
              content: String(messageData.content ?? ''),
            })
          : null
        // Replace optimistic message with real one
        // Sealed sender : id RÉEL mémorisé comme « à moi » (vocal).
        markOwnMessage(insertedMessage.id)
        settleOptimisticMessage(tempId, { ...insertedMessage, sender_id: insertedMessage.sender_id ?? user.id } as unknown as Message)
        // Diffusion Realtime du vocal (ligne réelle, chemin storage chiffré).
        messageQueueRef.current.push({ ...insertedMessage, sender_sealed: sealedSender ?? undefined } as unknown as Message)
        processMessageQueue()
        await supabase.from('conversations').update({ last_message_at: now }).eq('id', conversationId!)
        // Dispatch event to update ChatsPage conversation list in real-time
        globalThis.dispatchEvent(new CustomEvent('message-sent-in-chat', {
          detail: { conversationId, message: insertedMessage }
        }))
      } else if (error) {
        // Remove optimistic message on error
        setMessages(prev => prev.filter(m => m.id !== tempId))
        alert(t('voiceSendError'))
      }
    } catch {
      alert(t('voiceSendError'))
    } finally { setSending(false) }
  }

  // useCallback : ces handlers sont passés en props à <MessageList> /
  // <ChatHeader> / <ConversationInfo> qui sont React.memo. Sans
  // useCallback, chaque render parent recrée la fonction → la mémoization
  // se casse → tous les enfants re-render → ~5 fps sur mobile pendant
  // le polling éphémère 1 Hz.
  const handleStartVideoCall = useCallback(async () => {
    if (!conversationId) return
    try {
      if (conversation?.type === 'group') {
        await startGroupCall(conversationId, { audio: true, video: true })
      } else {
        if (!otherUser) return
        await startCall(otherUser.id, conversationId, { audio: true, video: true })
      }
    } catch (error: any) {
      console.error('Error starting video call:', error)
      alert(getCallErrorMessage(error))
    }
  }, [conversationId, conversation?.type, otherUser, startCall, startGroupCall])

  const handleStartAudioCall = useCallback(async () => {
    if (!conversationId) return
    try {
      if (conversation?.type === 'group') {
        await startGroupCall(conversationId, { audio: true, video: false })
      } else {
        if (!otherUser) return
        await startCall(otherUser.id, conversationId, { audio: true, video: false })
      }
    } catch (error: any) {
      console.error('Error starting audio call:', error)
      alert(getAudioCallErrorMessage(error))
    }
  }, [conversationId, conversation?.type, otherUser, startCall, startGroupCall])

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
  const handleDeleteMessage = useCallback((messageId: string) => {
    const message = messages.find(m => m.id === messageId)
    if (message) {
      setMessageToDelete(message)
      setShowDeleteDialog(true)
    }
  }, [messages])

  // Masque un ou plusieurs messages pour l'utilisateur courant de façon durable
  // et optimiste : état local immédiat (aucun F5), écriture serveur en tâche de
  // fond (idempotente). Sert au « supprimer pour moi » et de repli quand un
  // « supprimer pour tout le monde » est refusé côté serveur (message antérieur
  // à l'enregistrement de l'auteur) : mieux vaut qu'il reste masqué chez
  // l'utilisateur que de le voir réapparaître (effet « obligé de faire F5 »).
  const persistDeleteForMeBatch = useCallback((messageIds: string[]) => {
    if (messageIds.length === 0) return
    setDeletedForMeIds(prev => {
      const next = new Set(prev)
      messageIds.forEach(id => next.add(id))
      return next
    })
    if (!user) return
    const records = messageIds.map(id => ({
      message_id: id,
      user_id: user.id,
      deleted_at: new Date().toISOString(),
    }))
    void (async () => {
      try {
        const { error } = await supabase.from('deleted_messages').insert(records)
        // 23505 = doublon (déjà supprimé) : ce n'est pas une erreur.
        if (error && error.code !== '23505') {
          /* erreur non bloquante */
        }
      } catch (error) {
        console.error('Error deleting message for me:', error)
      }
    })()
  }, [user, setDeletedForMeIds])

  const persistDeleteForMe = useCallback(
    (messageId: string) => persistDeleteForMeBatch([messageId]),
    [persistDeleteForMeBatch]
  )

  // Delete for everyone - removes from database and storage
  const handleDeleteForEveryone = async () => {
    const target = messageToDelete
    if (!target) return

    // OPTIMISTE : on ferme le dialogue et on retire le message de l'UI
    // immédiatement (0 ms), avant tout aller-retour réseau. Sinon l'utilisateur
    // attendait la suppression storage + l'UPDATE DB avant de voir le message
    // disparaître (ressenti « ça prend du temps »).
    pendingDeletedIdsRef.current.add(target.id)
    // Retire aussi du cache durable : sinon la fusion local-first le
    // ressusciterait (le serveur ne le renvoie plus, mais le local l'a encore).
    offlineStorage.deleteMessage(target.id).catch(() => {})
    if (target.media_url) offlineStorage.deleteMediaBlob(target.id).catch(() => {})
    setMessageToDelete(null)
    setShowDeleteDialog(false)
    setMessages(prev => prev.filter(m => m.id !== target.id))

    try {
      // Média : suppression storage en tâche de fond (ne bloque plus l'UI).
      if (target.media_url) {
        // media_url peut être un path nu ou une URL complète signée.
        // extractStoragePath gère les deux cas.
        const filePath = extractStoragePath(target.media_url)
        if (filePath) {
          supabase.storage
            .from('media')
            .remove([filePath])
            .then(({ error: storageError }) => {
              if (storageError) console.error('Error deleting file from storage:', storageError)
            })
            .catch(err => console.error('Error deleting file from storage:', err))
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
        .eq('id', target.id)

      if (error) {
        // Échec serveur : on NE réaffiche PAS le message. Repli « pour moi »
        // pour qu'il reste masqué durablement (pas de rebond / F5).
        console.error('Error deleting message for everyone:', error)
        persistDeleteForMe(target.id)
      }
    } catch (error) {
      console.error('Error deleting message for everyone:', error)
      persistDeleteForMe(target.id)
    }
  }

  // Delete for me - only hides locally
  const handleDeleteForMe = async () => {
    const target = messageToDelete
    if (!target || !user) return

    // OPTIMISTE : masquage local instantané, l'écriture `deleted_messages`
    // part en tâche de fond. Avant, le message restait visible le temps de
    // l'INSERT réseau.
    setMessages(prev => prev.filter(m => m.id !== target.id))
    setMessageToDelete(null)
    setShowDeleteDialog(false)
    persistDeleteForMe(target.id)
  }

  const handleForwardMessage = useCallback((message: Message) => {
    setMessageToForward(message)
    setShowForwardModal(true)
  }, [])

  // Note: formatMessageTime is available for message time formatting
  // Helper to build forward message data
  const buildForwardMessageData = (targetConversationId: string, messageToForward: Message, senderId: string): any => {
    const messageData: any = {
      conversation_id: targetConversationId,
      sender_id: senderId,
      content: messageToForward.content ? `${t('forwardedPrefix')} ${messageToForward.content}` : t('forwardedMessage'),
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
    // Copier les métadonnées de média (dimensions, thumbnail, chiffrement)
    if ((messageToForward as any).media_thumbnail) {
      messageData.media_thumbnail = (messageToForward as any).media_thumbnail
    }
    if (messageToForward.media_width) {
      messageData.media_width = messageToForward.media_width
    }
    if (messageToForward.media_height) {
      messageData.media_height = messageToForward.media_height
    }
    if ((messageToForward as any).is_media_encrypted) {
      messageData.is_media_encrypted = true
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

    // Si le message source est chiffré E2EE, on récupère la clé AES une seule
    // fois pour la re-wrapper vers les membres de chaque conversation cible.
    const isSourceEncrypted = !!(messageToForward as any)?.is_media_encrypted
    let sourceKeyData: { rawKey: Uint8Array; mediaIvBase64: string } | null = null
    if (isSourceEncrypted && messageToForward) {
      try {
        sourceKeyData = await fetchMediaRawKey(messageToForward.id, userId)
      } catch (e) {
        console.error('[forward] failed to fetch source media key:', e)
      }
    }

    for (const targetConversationId of conversationIds) {
      const messageData = buildForwardMessageData(targetConversationId, messageToForward!, userId)

      // FAIL-CLOSED : si la clé média source n'a pas pu être récupérée pour un
      // message chiffré, on N'ENVOIE PAS (plus de transfert en clair / cassé).
      if (isSourceEncrypted && !sourceKeyData) {
        console.error('[forward][E2EE] clé média source introuvable — transfert annulé (fail-closed)')
        errorCount++
        continue
      }

      // Chiffrer la LÉGENDE des messages transférés : pas seulement le type
      // 'text'. Un média/doc transféré porte sa légende dans `content`
      // (`[Transféré] …`) — l'ancien garde `type === 'text'` la laissait
      // partir EN CLAIR vers le serveur. Toute légende non vide est chiffrée.
      const forwardPlaintext = typeof messageData.content === 'string' ? messageData.content : ''
      let forwardLinkPreview: unknown | null = null
      try {
        forwardLinkPreview = messageData.link_preview ? JSON.parse(messageData.link_preview) : null
      } catch {
        forwardLinkPreview = null
      }
      let encryptedText: EncryptedTextPayload | null = null
      if (forwardPlaintext) {
        try {
          // 1) X25519 TOUJOURS (repli garanti : tout destinataire déchiffre,
          // même sans clés ratchet). Les clés sont persistées plus bas.
          encryptedText = await encryptText(forwardPlaintext, forwardLinkPreview)
          messageData.content = encryptedText.ciphertextB64
          messageData.is_text_encrypted = true
          const meta: Record<string, unknown> = { v: 1, iv: encryptedText.ivB64 }

          // 2) Double Ratchet en SURCOUCHE (forward secrecy) quand disponible.
          try {
            const ratchet = ENABLE_RATCHET_ON_SEND
              ? await tryEncryptWithRatchet(userId, targetConversationId, serializeTextPayload(forwardPlaintext, forwardLinkPreview))
              : null
            if (ratchet) {
              meta.ratchet = ratchet.encryptionMetadata
              meta.ratchetContent = ratchet.content
            }
          } catch (rErr) {
            console.warn('[forward][E2EE] ratchet indisponible, X25519 seul:', rErr)
          }

          messageData.encryption_metadata = meta
          if (forwardLinkPreview) delete messageData.link_preview
        } catch (encErr) {
          // FAIL-CLOSED : jamais de transfert en clair.
          console.error('[forward][E2EE] chiffrement texte échoué — transfert annulé (fail-closed):', encErr)
          errorCount++
          continue
        }
      }

      // Phase 1 (sealed sender v3) : scellé APRÈS insertion (id connu).

      const insertResult = await supabase
        .from('messages')
        .insert(messageData)
        .select('id')

      // FAIL-CLOSED : plus de repli en clair si la migration E2EE n'est pas
      // appliquée — on laisse l'erreur d'insertion remonter.

      const { data: insertedRows, error: insertError } = insertResult

      if (insertError) {
        console.error('Error inserting forwarded message:', insertError)
        errorCount++
      } else {
        const newId = insertedRows?.[0]?.id
        // Recréer les clés texte enveloppées pour la conversation cible.
        // FAIL-CLOSED : on supprime la ligne si les clés ne peuvent être créées.
        if (encryptedText && newId) {
          try {
            await createTextKeysForMessage({
              messageId: newId,
              senderId: userId,
              conversationId: targetConversationId,
              rawKey: encryptedText.rawKey,
            })
          } catch (e) {
            console.error('[forward][E2EE] création des clés texte échouée — annulation:', e)
            await supabase.from('messages').delete().eq('id', newId)
            errorCount++
            continue
          }
        }

        // Re-créer les clés de chiffrement pour le message transféré
        // afin que les membres de la conversation cible puissent déchiffrer le média.
        if (isSourceEncrypted && sourceKeyData && newId) {
          try {
            await createMediaKeysForMessage({
              messageId: newId,
              senderId: userId,
              conversationId: targetConversationId,
              rawKey: sourceKeyData.rawKey,
              mediaIvBase64: sourceKeyData.mediaIvBase64,
            })
          } catch (e) {
            console.error('[forward] failed to create media keys for target — annulation:', e)
            await supabase.from('messages').delete().eq('id', newId)
            errorCount++
            continue
          }
        }

        successCount++
        // Phase 1 (sealed sender v3) : scelle l'identité du transfert (id +
        // conversation cible + hash du contenu) et l'attache à la ligne.
        if (newId) {
          await sealSenderForMessage({
            messageId: newId,
            senderId: userId,
            conversationId: targetConversationId,
            content: String(messageData.content ?? ''),
          })
          // Sealed sender : id RÉEL du transfert mémorisé comme « à moi ».
          markOwnMessage(newId)
        }
        await updateConversationLastMessage(targetConversationId)
      }
    }

    return { successCount, errorCount }
  }

  const handleForwardToConversations = async (conversationIds: string[]) => {
    if (!messageToForward || !user) return

    try {
      // Jitter anti-analyse temporelle : décale l'envoi réseau des transferts.
      await applySendJitter()

      const { successCount, errorCount } = await forwardMessageToConversations(
        conversationIds,
        messageToForward,
        user.id
      )

      // Show feedback to user
      if (successCount > 0 && errorCount === 0) {
        /* transfert réussi */
      } else if (errorCount > 0) {
        alert(t('forwardPartialError', { failed: errorCount, total: conversationIds.length }))
      }
    } catch (error) {
      console.error('Error forwarding message:', error)
      alert(t('forwardError'))
    }

    setMessageToForward(null)
    setShowForwardModal(false)
  }

  const handlePinMessage = useCallback(async (messageId: string) => {
    const message = messages.find(m => m.id === messageId)
    if (message) {
      setMessageToPin(message)
      setShowPinDialog(true)
    }
  }, [messages])

  const handleConfirmPin = async (durationSeconds: number) => {
    if (!messageToPin || !conversationId) return

    const pinnedAt = new Date()
    const pinnedUntil = new Date(pinnedAt.getTime() + durationSeconds * 1000)
    const previousState = getEffectiveUserState(messageToPin.id)

    // Épingle PAR UTILISATEUR : écriture dans `message_user_state`. Optimiste +
    // rollback (avant, `messages.is_pinned` était partagé → épingle globale).
    applyLocalUserState(messageToPin.id, { is_pinned: true, pinned_until: pinnedUntil.toISOString() })

    const senderName = messageToPin.sender_id === user?.id
      ? t('you')
      : otherUser?.display_name || otherUser?.username || t('userFallback')

    setPinnedMessage({
      id: messageToPin.id,
      content: messageToPin.content || '',
      sender_name: senderName,
      pinned_at: pinnedAt.toISOString(),
      pinned_until: pinnedUntil.toISOString(),
    })

    const { error } = await setMessageState(messageToPin.id, {
      is_pinned: true,
      pinned_until: pinnedUntil.toISOString(),
    })

    if (error) {
      console.error('Pin failed, rolling back:', error)
      applyLocalUserState(messageToPin.id, {
        is_pinned: previousState.is_pinned,
        pinned_until: previousState.pinned_until ?? null,
      })
      setPinnedMessage(null)
    }

    setMessageToPin(null)
    setShowPinDialog(false)
  }

  const handleUnpinMessage = useCallback(async () => {
    if (!pinnedMessage) return

    // Optimistic UI : on retire la pin instantanément, rollback si erreur
    const previousPinned = pinnedMessage
    const previousState = getEffectiveUserState(previousPinned.id)
    setPinnedMessage(null)
    applyLocalUserState(previousPinned.id, { is_pinned: false, pinned_until: null })

    const { error } = await setMessageState(previousPinned.id, { is_pinned: false, pinned_until: null })

    if (error) {
      // Rollback en cas d'erreur réseau / RLS
      console.error('Unpin failed, rolling back:', error)
      setPinnedMessage(previousPinned)
      applyLocalUserState(previousPinned.id, {
        is_pinned: previousState.is_pinned,
        pinned_until: previousState.pinned_until ?? null,
      })
    }
  }, [pinnedMessage, getEffectiveUserState, applyLocalUserState, setMessageState])

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
      if (!conversationId || !user) return

      const nowIso = new Date().toISOString()

      // Épingle PAR UTILISATEUR : on part de `message_user_state` (RLS), puis on
      // ne retient que les messages de CETTE conversation.
      const { data: states, error: stateError } = await supabase
        .from('message_user_state')
        .select('message_id, pinned_until, updated_at')
        .eq('user_id', user.id)
        .eq('is_pinned', true)
        .gt('pinned_until', nowIso)
        .order('updated_at', { ascending: false })
        .limit(20)

      if (stateError) {
        // Repli rétrocompat (prod non migrée) : colonne partagée `messages`.
        userStateTableAvailableRef.current = false
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .eq('is_pinned', true)
          .gt('pinned_until', nowIso)
          .order('pinned_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (!error && data) {
          const senderName = data.sender_id === user.id
            ? t('you')
            : otherUser?.display_name || otherUser?.username || t('userFallback')
          setPinnedMessage({
            id: data.id,
            content: data.content || '',
            sender_name: senderName,
            pinned_at: data.pinned_at,
            pinned_until: data.pinned_until,
          })
        }
        return
      }

      const stateRows = (states ?? []) as any[]
      const ids = stateRows.map(s => s.message_id)
      if (ids.length === 0) return

      const { data: msgs, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .in('id', ids)
      if (error || !msgs || msgs.length === 0) return

      const byId = new Map<string, any>(msgs.map((m: any) => [m.id, m]))
      let chosen: any = null
      let chosenState: any = null
      for (const s of stateRows) {
        const m = byId.get(s.message_id)
        if (m) { chosen = m; chosenState = s; break }
      }
      if (!chosen) return

      const senderName = chosen.sender_id === user.id
        ? t('you')
        : otherUser?.display_name || otherUser?.username || t('userFallback')
      setPinnedMessage({
        id: chosen.id,
        content: chosen.content || '',
        sender_name: senderName,
        pinned_at: chosenState.updated_at ?? nowIso,
        pinned_until: chosenState.pinned_until ?? nowIso,
      })
    }

    loadPinnedMessage()
  }, [conversationId, user?.id, otherUser])

  const handleStarMessage = useCallback(async (messageId: string) => {
    const previous = getEffectiveUserState(messageId)
    const newStarredStatus = !previous.is_starred

    // Étoile PAR UTILISATEUR : écriture dans `message_user_state` (avant,
    // `messages.is_starred` partagé → étoile globale). Optimiste + rollback.
    applyLocalUserState(messageId, { is_starred: newStarredStatus })

    const { error } = await setMessageState(messageId, { is_starred: newStarredStatus })

    if (error) {
      console.error('Star toggle failed, rolling back:', error)
      applyLocalUserState(messageId, { is_starred: previous.is_starred })
    }
  }, [getEffectiveUserState, applyLocalUserState, setMessageState])

  const handleReportMessage = (messageId: string) => {
    // Report functionality - show confirmation and send to server
    const confirmed = window.confirm(t('reportConfirm'))
    if (confirmed) {
      // In a real implementation, this would send a report to the server
      alert(t('reportedToAdmins'))
    }
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
      alert(t('messagesCopied'))
    } else {
      alert(t('noTextToCopy'))
    }
    exitSelectionMode()
  }, [messages, selectedMessages, exitSelectionMode])

  const handleBulkStar = useCallback(async () => {
    const ids = Array.from(selectedMessages)
    if (ids.length === 0) {
      exitSelectionMode()
      return
    }

    // Étoile PAR UTILISATEUR pour tous les messages sélectionnés (optimiste).
    ids.forEach(id => applyLocalUserState(id, { is_starred: true }))

    const results = await Promise.all(ids.map(id => setMessageState(id, { is_starred: true })))
    if (results.some(r => r.error)) {
      // Non bloquant : on recharge l'état réel pour corriger la map optimiste.
      console.error('Bulk star failed:', results.find(r => r.error)?.error)
      try {
        const { map } = await fetchMyMessageState(ids)
        mergeMessageUserState(map)
      } catch { /* ignore */ }
    }

    exitSelectionMode()
  }, [selectedMessages, exitSelectionMode, applyLocalUserState, setMessageState, fetchMyMessageState, mergeMessageUserState])

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

    // Tombsones locales : empêchent le poll/reload de réafficher ces messages
    // tant que l'UPDATE serveur n'est pas commité.
    ids.forEach(id => pendingDeletedIdsRef.current.add(id))
    // Purge aussi le cache durable local (évite toute résurrection local-first).
    ids.forEach(id => { offlineStorage.deleteMessage(id).catch(() => {}) })
    
    // Collect all media file paths to delete in batch
    const selectedMsgs = messages.filter(m => selectedMessages.has(m.id))
    const mediaFilePaths: string[] = []
    
    for (const msg of selectedMsgs) {
      if (msg.media_url) {
        const filePath = extractStoragePath(msg.media_url)
        if (filePath) mediaFilePaths.push(filePath)
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
          // Repli groupé « pour moi » : on garde les messages masqués au lieu
          // de les faire réapparaître (pas de rebond / F5).
          persistDeleteForMeBatch(ids)
        }
      })
  }, [selectedMessages, messages, exitSelectionMode, persistDeleteForMeBatch])

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
            /* erreur non bloquante */
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
    const mediaMessages = selectedMsgs.filter(m => m.media_url || m.file_url)

    if (mediaMessages.length === 0) {
      alert(t('noMediaToDownload'))
      return
    }

    // Helper centralisé pour chaque média : gère paths nus, URLs expirées,
    // médias chiffrés E2EE. Lancé séquentiellement pour éviter de saturer
    // le navigateur de downloads concurrents.
    let successCount = 0
    let failCount = 0
    for (const msg of mediaMessages) {
      const url = msg.media_url || msg.file_url
      if (!url) continue
      const ok = await downloadMedia({
        mediaUrl: url,
        fileName: msg.file_name,
        mediaType: msg.type || 'file',
        messageId: msg.id,
        userId: user?.id,
        isEncrypted: (msg as any).is_media_encrypted || false,
      })
      if (ok) successCount++
      else failCount++
    }

    if (failCount > 0 && successCount === 0) {
      // L'alerte d'erreur a déjà été affichée par downloadMedia
    } else if (failCount > 0) {
      alert(t('downloadResults', { success: successCount, failed: failCount }))
    }

    exitSelectionMode()
  }, [messages, selectedMessages, exitSelectionMode, user?.id])

  // For "Saved Messages" (conversation with self), show special name
  const isSavedMessages = conversation?.type === 'direct' && conversation?.name === 'Messages enregistrés'
  
  // Extract display name logic to avoid nested ternary
  const getDisplayName = (): string => {
    if (conversation?.type === 'group') {
      return conversation.name || t('groupFallback')
    }
    if (isSavedMessages) {
      return t('me')
    }
    return otherUser?.display_name || otherUser?.username || t('userFallback')
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
          mediaAlbumMap={mediaAlbumMap}
          scrollToMessage={scrollToMessage}
          handleStartVideoCall={handleStartVideoCall}
          handleStartAudioCall={handleStartAudioCall}
          messagesEndRef={messagesEndRef}
          messagesContainerRef={messagesContainerRef}
          getWallpaperStyle={getWallpaperStyle}
          handleBackgroundContextMenu={handleBackgroundContextMenu}
          onScroll={handleScroll}
          onLoadMore={loadMoreMessages}
          isLoadingMore={isLoadingMore}
          hasMoreMessages={hasMoreMessages}
          linkPreview={linkPreview}
          replyToMessage={replyToMessage}
          isLoadingPreview={isLoadingPreview}
          otherUser={otherUser}
          messageUserState={messageUserState}
        />

        {/* Input Bar JemaOS - Fixed at bottom on mobile, above nav bar - Hidden in selection mode */}
        {!isSelectionMode && (
        <div className="fixed md:relative bottom-[calc(3.5rem+env(safe-area-inset-bottom))] md:bottom-0 left-0 right-0 bg-bg-surface px-2 sm:px-3 md:px-4 py-2 md:py-3 border-t border-bg-hover md:border-t-0 z-40">
          {/* Voice Recorder - replaces input bar when recording */}
          {showVoiceRecorder ? (
            <Suspense fallback={null}>
              <VoiceRecorder onRecordingComplete={handleVoiceRecordingComplete} onCancel={() => setShowVoiceRecorder(false)} />
            </Suspense>
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
              
              {replyToMessage && (() => {
                // Même stratégie que ReplyQuote (cf. MessageItemComponents.tsx) :
                // - data URL base64 (media_thumbnail) si dispo → affichable direct
                // - sinon URL signée pour les non-chiffrés
                // - sinon path brut → décryption à la volée via EncryptedReplyThumbnail
                const reply = replyToMessage as any
                const mediaThumbnail = reply.media_thumbnail as string | null | undefined
                const isReplyEncrypted = !!reply.is_media_encrypted
                const rawSrc = replyToMessage.media_url || replyToMessage.file_url
                const directThumb: string | null = mediaThumbnail
                  ? mediaThumbnail
                  : isReplyEncrypted
                    ? null
                    : (rawSrc || null)
                const decryptable: string | null = !directThumb && rawSrc ? rawSrc : null
                return (
                  <MessageReply
                    replyToMessage={{
                      id: replyToMessage.id,
                      content: replyToMessage.content,
                      sender_id: replyToMessage.sender_id,
                      senderName: getSenderInfo(replyToMessage.sender_id).name,
                      mediaUrl: directThumb,
                      mediaType: replyToMessage.media_type || replyToMessage.type,
                      fileName: replyToMessage.file_name,
                      isEncrypted: isReplyEncrypted,
                      encryptedSrc: decryptable,
                    }}
                    onCancel={() => setReplyToMessage(null)}
                    isPreview={true}
                  />
                )
              })()}
              <form onSubmit={handleSendMessage} className="flex items-center gap-1 md:gap-2">
                <Suspense fallback={<div className="w-9 h-9 md:w-10 md:h-10" />}>
                  <EmojiPicker
                    onEmojiSelect={handleEmojiSelect}
                  />
                </Suspense>
                <button type="button" onClick={() => setShowMediaUploader(true)} className="w-9 h-9 md:w-10 md:h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-text-secondary">
                  <Plus size={20} className="md:hidden" />
                  <Plus size={24} className="hidden md:block" />
                </button>
                <div className="flex-1 relative">
                  <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder={t('typeMessagePlaceholder')} className="w-full h-10 md:h-11 px-3 md:px-4 rounded-2xl bg-bg-hover text-text-primary text-sm border-none outline-none placeholder:text-text-secondary" />
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
        <Suspense fallback={null}>
        <MediaUploader
          conversationId={conversationId!}
          onMediaSelect={() => undefined}
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
              is_ephemeral: !!ephemeralDuration,
              ephemeral_duration: ephemeralDuration,
              ephemeral_expires_at: ephemeralDuration 
                ? new Date(Date.now() + ephemeralDuration * 1000).toISOString() 
                : null,
            } as unknown as Message

            setMessages(prev => [...prev, optimisticMessage])
            setReplyToMessage(null)
            setShowMediaUploader(false)

            try {
              const messageData: any = {
                conversation_id: conversationId!,
                sender_id: BLIND_SENDER ? null : user.id,
                content: content,
                type: 'text',
                status: 'sent',
                reply_to_id: optimisticMessage.reply_to_id,
              }

              // FAIL-CLOSED : le contenu (caption + lien distant vers le
              // GIF/sticker) doit être CHIFFRÉ comme un message texte, sinon le
              // lien part en clair vers le serveur. Pas de repli en clair.
              let encryptedText: EncryptedTextPayload
              try {
                encryptedText = await encryptText(content, null)
                messageData.content = encryptedText.ciphertextB64
                messageData.is_text_encrypted = true
                const meta: Record<string, unknown> = { v: 1, iv: encryptedText.ivB64 }
                try {
                  const ratchet = ENABLE_RATCHET_ON_SEND && conversationId
                    ? await tryEncryptWithRatchet(user.id, conversationId, serializeTextPayload(content, null))
                    : null
                  if (ratchet) {
                    meta.ratchet = ratchet.encryptionMetadata
                    meta.ratchetContent = ratchet.content
                  }
                } catch (rErr) {
                  console.warn('[E2EE] ratchet indisponible (GIF/sticker), X25519 seul:', rErr)
                }
                messageData.encryption_metadata = meta
              } catch (encErr) {
                console.error('[E2EE] chiffrement GIF/sticker échoué — envoi annulé (fail-closed):', encErr)
                setMessages(prev => prev.filter(m => m.id !== tempId))
                alert(t('messageSendError'))
                return
              }

              // Add ephemeral fields if enabled
              if (ephemeralDuration) {
                messageData.is_ephemeral = true
                messageData.ephemeral_duration = ephemeralDuration
                messageData.ephemeral_expires_at = ephemeralDuration 
                  ? new Date(Date.now() + ephemeralDuration * 1000).toISOString() 
                  : null
              }

              // Phase 1 (sealed sender v3) : scellé APRÈS insertion (id connu).

              // Jitter anti-analyse temporelle : après l'optimiste, avant l'envoi réseau.
              await applySendJitter()

              const { data, error } = await insertMessageSingle(messageData)
              
              if (!error && data) {
                // FAIL-CLOSED : sans les clés enveloppées le message serait
                // indéchiffrable → on supprime la ligne au lieu de la laisser cassée.
                try {
                  await createTextKeysForMessage({
                    messageId: data.id,
                    senderId: user.id,
                    conversationId: conversationId!,
                    rawKey: encryptedText.rawKey,
                  })
                } catch (keyErr) {
                  console.error('[E2EE] clés GIF/sticker échouées — annulation:', keyErr)
                  await supabase.from('messages').delete().eq('id', data.id)
                  setMessages(prev => prev.filter(m => m.id !== tempId))
                  alert(t('messageSendError'))
                  return
                }
                // Phase 1 (sealed sender v3) : scelle l'identité (id +
                // conversation + hash du contenu) et l'attache à la ligne.
                const sealedSender: string[] | null = conversationId
                  ? await sealSenderForMessage({
                      messageId: data.id,
                      senderId: user.id,
                      conversationId,
                      content: messageData.content,
                    })
                  : null
                // Conserve le clair côté client (jamais le ciphertext à l'écran).
                const settled: any = { ...(data as any), content: content, sender_id: (data as any).sender_id ?? user.id }
                cacheDecryptedText(data.id, content)
                markOwnMessage(data.id)
                settleOptimisticMessage(tempId, settled)
                // Diffusion Realtime (texte chiffré → autorisé par le garde-fou).
                messageQueueRef.current.push({
                  ...(data as any),
                  sender_sealed: sealedSender ?? undefined,
                  content: encryptedText.ciphertextB64,
                  is_text_encrypted: true,
                  encryption_metadata: messageData.encryption_metadata,
                  link_preview: null,
                } as Message)
                processMessageQueue()
                await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId!)
                // Dispatch event to update ChatsPage conversation list in real-time
                globalThis.dispatchEvent(new CustomEvent('message-sent-in-chat', {
                  detail: { conversationId, message: settled }
                }))
              } else {
                setMessages(prev => prev.filter(m => m.id !== tempId))
                alert(t('messageSendError'))
              }
            } finally {
              setSending(false)
            }
          }}
        />
        </Suspense>
      )}
      {showConversationInfo && (
        <Suspense fallback={null}>
        <ConversationInfo
          conversationId={conversationId!}
          conversationType={conversation?.type || 'direct'}
          conversationName={displayName}
          conversationDescription={conversation?.description}
          conversationAvatar={conversation?.avatar_url}
          otherUser={otherUser}
          currentUserId={user?.id || ''}
          isAdmin={
            conversation?.type === 'group' &&
            (conversation?.created_by === user?.id || currentUserRole === 'admin')
          }
          onClose={() => {
            setShowConversationInfo(false)
            setShowAddMemberModal(false)
            refreshConversation()
            loadEphemeralSetting()
          }}
          onAvatarChange={(newPath) => {
            // Met à jour le state local conversation immédiatement sans reload
            setConversation(prev => prev ? { ...prev, avatar_url: newPath } : prev)
            // Mise à jour du cache localStorage de la conversation courante
            try {
              const cacheKey = `conv_${conversationId}`
              const existing = localStorage.getItem(`anu_cache_${cacheKey}`)
              if (existing) {
                const parsed = JSON.parse(existing)
                if (parsed?.data) {
                  parsed.data.avatar_url = newPath
                  localStorage.setItem(`anu_cache_${cacheKey}`, JSON.stringify(parsed))
                }
              }
            } catch { /* ignore */ }
            // Mise à jour du cache de la liste des conversations (ChatsPage)
            // pour que la nouvelle photo apparaisse aussi dans la sidebar
            // sans attendre un refetch complet du serveur.
            try {
              const cached = offlineStorage.getConversationsSync()
              if (cached && Array.isArray(cached)) {
                const updated = cached.map((c: any) =>
                  c?.id === conversationId ? { ...c, avatar_url: newPath } : c
                )
                offlineStorage.saveConversations(updated).catch(() => { /* ignore */ })
              }
            } catch { /* ignore */ }
          }}
            onStartVideoCall={handleStartVideoCall}
            onStartAudioCall={handleStartAudioCall}
            initialTab={showAddMemberModal ? 'members' : 'overview'}
            openAddMemberModal={showAddMemberModal}
            onSystemMessage={(msg) => {
              setMessages(prev => {
                if (prev.some(m => m.id === msg.id)) return prev;
                return [...prev, msg];
              });
            }}
          />
        </Suspense>
      )}

      {/* Context Menu */}
      {contextMenu.isOpen && contextMenu.message && (
        <MessageContextMenu
          isOpen={true}
          position={contextMenu.position}
          messageId={contextMenu.message.id}
          messageContent={contextMenu.message.content || ''}
          messageType={contextMenu.message.type as 'text' | 'image' | 'video' | 'file' | 'audio'}
          isOwn={(contextMenu.message.sender_id === user?.id || isOwnMessage(contextMenu.message.id))}
          isGroupChat={conversation?.type === 'group'}
          senderName={getSenderInfo(contextMenu.message.sender_id).name}
          mediaUrl={contextMenu.message.media_url || contextMenu.message.file_url || undefined}
          fileName={contextMenu.message.file_name || null}
          isEncrypted={(contextMenu.message as any).is_media_encrypted || false}
          currentUserId={user?.id}
          onClose={closeContextMenu}
          onReply={() => setReplyToMessage(contextMenu.message)}
          onReplyPrivately={() => {
            // TODO: Implement reply privately for group chats
            alert(t('replyPrivately'))
          }}
          onSendMessage={() => {
            // TODO: Navigate to direct message with user
            alert(t('sendMessageLabel'))
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
        isOwn={(messageToDelete?.sender_id === user?.id || (messageToDelete ? isOwnMessage(messageToDelete.id) : false))}
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
          return !!msg && (msg.sender_id === user?.id || isOwnMessage(msg.id))
        })}
        hasMedia={Array.from(selectedMessages).some(id => {
          const msg = messages.find(m => m.id === id)
          return !!msg?.media_url
        })}
        messageCount={selectedMessages.size}
      />

      {/* Forward Message Modal — lazy, ne se charge qu'à l'ouverture */}
      {showForwardModal && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

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

      {/* GIF/Sticker Fullscreen Viewer — lazy */}
      {gifStickerViewer && (
        <Suspense fallback={null}>
        <MediaViewer
          isOpen={gifStickerViewer.isOpen}
          mediaUrl={gifStickerViewer.url}
          mediaType={gifStickerViewer.type}
          senderName={gifStickerViewer.senderName}
          senderAvatar={gifStickerViewer.senderAvatar}
          timestamp={gifStickerViewer.timestamp}
          isOwn={gifStickerViewer.isOwn}
          isStarred={getEffectiveUserState(gifStickerViewer.messageId).is_starred}
          onClose={() => setGifStickerViewer(null)}
          onReaction={(emoji) => addReaction(gifStickerViewer.messageId, emoji)}
          onForward={() => {
            // Fermer le viewer plein écran AVANT d'ouvrir le ForwardMessageModal
            // sinon le top layer du <dialog showModal()> masque le modal de transfert.
            const message = messages.find(m => m.id === gifStickerViewer.messageId)
            setGifStickerViewer(null)
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
        </Suspense>
      )}

    </MainLayout>
  )
}

