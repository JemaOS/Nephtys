import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/context/ThemeContext'
import { MainLayout } from '@/components/MainLayout'
import { supabase, Message, Conversation, Profile } from '@/lib/supabase'
import { ArrowLeft, Send, Phone, Video, MoreVertical, Search, Smile, Mic, Plus, Reply, UserPlus, Archive, Trash2, Bell, BellOff, Lock, Star, Forward, Pin, Info, Share2, Copy } from 'lucide-react'
import { EmojiPicker } from '@/components/EmojiPicker'
import { MessageReactions } from '@/components/MessageReactions'
import { MessageReply } from '@/components/MessageReply'
import { MessageSearch } from '@/components/MessageSearch'
import { EphemeralMessageToggle } from '@/components/EphemeralMessageToggle'
import { MediaUploader } from '@/components/MediaUploader'
import { MediaMessage } from '@/components/MediaMessage'
import { VoiceRecorder } from '@/components/VoiceRecorder'
import { VoiceMessage } from '@/components/VoiceMessage'
import { CallScreen } from '@/components/CallScreen'
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

export function ChatViewPage() {
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [filteredMessages, setFilteredMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [otherUser, setOtherUser] = useState<Profile | null>(null)
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
  
  const displayedMessages = filteredMessages.length > 0 ? filteredMessages : messages

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

  useEffect(() => {
    if (!conversationId || !user) return
    loadConversation()
    loadMessages()
    if (permission === 'default') requestPermission()
    subscribeToConversation(conversationId)
    
    const messagesChannel = supabase
      .channel(`messages:${conversationId}`, { config: { broadcast: { self: true } } })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        const newMsg = payload.new as Message
        setMessages(prev => [...prev, newMsg])
        if (newMsg.sender_id !== user.id) {
          updateMessageStatus(newMsg.id, 'delivered')
          if (document.hidden && permission === 'granted') {
            const senderName = otherUser?.display_name || otherUser?.username || 'Quelqu\'un'
            const preview = newMsg.type === 'text' ? newMsg.content : '📎 Fichier'
            sendNotification(senderName, preview, { conversationId, messageId: newMsg.id, url: `/chat/${conversationId}` })
          }
        }
      })
      .subscribe()

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

    return () => {
      supabase.removeChannel(messagesChannel)
      supabase.removeChannel(profilesChannel)
      unsubscribeFromConversation(conversationId)
    }
  }, [conversationId, user?.id, permission, otherUser?.id])

  useEffect(() => { scrollToBottom() }, [messages])
  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })

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

  const loadConversation = async () => {
    const { data, error } = await supabase.from('conversations').select('*').eq('id', conversationId!).maybeSingle()
    if (!error && data) {
      setConversation(data)
      if (data.type === 'direct') {
        // First, get all members of this conversation
        const { data: allMembers } = await supabase.from('conversation_members').select('user_id').eq('conversation_id', conversationId!)
        
        // Check if this is a "Saved Messages" conversation (only one member = self)
        if (allMembers && allMembers.length === 1 && allMembers[0].user_id === user!.id) {
          // This is "Saved Messages" - use own profile
          const { data: selfProfile } = await supabase.from('profiles').select('*').eq('id', user!.id).maybeSingle()
          if (selfProfile) setOtherUser(selfProfile)
        } else {
          // Normal direct conversation - find the other user
          const { data: members } = await supabase.from('conversation_members').select('user_id').eq('conversation_id', conversationId!).neq('user_id', user!.id)
          if (members && members.length > 0) {
            const { data: otherUserData } = await supabase.from('profiles').select('*').eq('id', members[0].user_id).maybeSingle()
            if (otherUserData) setOtherUser(otherUserData)
          }
        }
      }
    }
  }

  // Fonction pour rafraîchir la conversation (appelée après upload de photo)
  const refreshConversation = () => {
    loadConversation()
  }

  const loadMessages = async () => {
    setLoading(true)
    const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', conversationId!).is('deleted_at', null).order('created_at', { ascending: true }).limit(100)
    if (!error && data) {
      setMessages(data)
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

  const handleMediaUploadComplete = async (url: string, type: 'image' | 'video' | 'file', fileName: string, fileSize: number) => {
    if (!user) return
    setSending(true)
    try {
      const messageData: any = {
        conversation_id: conversationId!, sender_id: user.id, content: newMessage.trim() || '',
        type, status: 'sent', reply_to_id: replyToMessage?.id || null,
        media_url: url, media_type: type, file_name: fileName, file_size: fileSize,
      }
      const { error } = await supabase.from('messages').insert(messageData)
      if (!error) {
        setNewMessage('')
        setReplyToMessage(null)
        setShowMediaUploader(false)
        await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId!)
      }
    } finally { setSending(false) }
  }

  const handleVoiceRecordingComplete = async (audioBlob: Blob, duration: number) => {
    if (!user) return
    setSending(true)
    try {
      const fileName = `${user.id}/${Date.now()}.webm`
      const { error: uploadError } = await supabase.storage.from('media').upload(fileName, audioBlob, { cacheControl: '3600', upsert: false })
      if (uploadError) throw uploadError
      const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(fileName)
      const messageData: any = {
        conversation_id: conversationId!, sender_id: user.id, content: '', type: 'audio', status: 'sent',
        reply_to_id: replyToMessage?.id || null, media_url: publicUrl, media_type: 'audio',
        file_name: `voice-${Date.now()}.webm`, file_size: audioBlob.size,
      }
      const { error } = await supabase.from('messages').insert(messageData)
      if (!error) {
        setReplyToMessage(null)
        setShowVoiceRecorder(false)
        await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId!)
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
        
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          alert('❌ Permissions refusées\n\nVeuillez autoriser l\'accès à votre caméra et microphone dans les paramètres de votre navigateur pour passer des appels vidéo.')
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
          alert('❌ Aucun appareil trouvé\n\nAucune caméra ou microphone n\'a été détecté sur votre appareil.')
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
          alert('❌ Appareil occupé\n\nVotre caméra ou microphone est déjà utilisé par une autre application.')
        } else {
          alert('❌ Erreur\n\nImpossible de démarrer l\'appel vidéo de groupe. Vérifiez vos permissions et réessayez.')
        }
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
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        alert('❌ Permissions refusées\n\nVeuillez autoriser l\'accès à votre caméra et microphone dans les paramètres de votre navigateur pour passer des appels vidéo.')
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        alert('❌ Aucun appareil trouvé\n\nAucune caméra ou microphone n\'a été détecté sur votre appareil.')
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        alert('❌ Appareil occupé\n\nVotre caméra ou microphone est déjà utilisé par une autre application.')
      } else {
        alert('❌ Erreur\n\nImpossible de démarrer l\'appel vidéo. Vérifiez vos permissions et réessayez.')
      }
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
        
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          alert('❌ Permission refusée\n\nVeuillez autoriser l\'accès à votre microphone dans les paramètres de votre navigateur pour passer des appels audio.')
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
          alert('❌ Aucun microphone trouvé\n\nAucun microphone n\'a été détecté sur votre appareil.')
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
          alert('❌ Microphone occupé\n\nVotre microphone est déjà utilisé par une autre application.')
        } else {
          alert('❌ Erreur\n\nImpossible de démarrer l\'appel audio de groupe. Vérifiez vos permissions et réessayez.')
        }
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
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        alert('❌ Permission refusée\n\nVeuillez autoriser l\'accès à votre microphone dans les paramètres de votre navigateur pour passer des appels audio.')
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        alert('❌ Aucun microphone trouvé\n\nAucun microphone n\'a été détecté sur votre appareil.')
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        alert('❌ Microphone occupé\n\nVotre microphone est déjà utilisé par une autre application.')
      } else {
        alert('❌ Erreur\n\nImpossible de démarrer l\'appel audio. Vérifiez vos permissions et réessayez.')
      }
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

  const handleForwardToConversations = async (conversationIds: string[]) => {
    if (!messageToForward || !user) return

    let successCount = 0
    let errorCount = 0

    try {
      for (const targetConversationId of conversationIds) {
        // Build message data - only include fields that exist in the database
        const messageData: any = {
          conversation_id: targetConversationId,
          sender_id: user.id,
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

        console.log('Forwarding message to conversation:', targetConversationId, messageData)

        const { error: insertError } = await supabase.from('messages').insert(messageData)
        
        if (insertError) {
          console.error('Error inserting forwarded message:', insertError)
          errorCount++
        } else {
          successCount++
          // Update conversation's last_message_at
          await supabase
            .from('conversations')
            .update({ last_message_at: new Date().toISOString() })
            .eq('id', targetConversationId)
        }
      }

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
      messageElement.classList.add('bg-[#00a884]/20')
      setTimeout(() => {
        messageElement.classList.remove('bg-[#00a884]/20')
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
    
    // Delete media files from storage for messages that have them
    const selectedMsgs = messages.filter(m => selectedMessages.has(m.id))
    for (const msg of selectedMsgs) {
      if (msg.media_url) {
        try {
          const url = new URL(msg.media_url)
          const pathParts = url.pathname.split('/storage/v1/object/public/media/')
          if (pathParts.length > 1) {
            const filePath = pathParts[1]
            await supabase.storage.from('media').remove([filePath])
          }
        } catch (error) {
          console.error('Error deleting file from storage:', error)
        }
      }
    }
    
    // Soft delete all selected messages
    await supabase
      .from('messages')
      .update({
        deleted_at: new Date().toISOString(),
        content: '',
        media_url: null,
        file_name: null,
        file_size: null,
      })
      .in('id', ids)
    
    setMessages(prev => prev.filter(m => !selectedMessages.has(m.id)))
    setShowBulkDeleteDialog(false)
    exitSelectionMode()
  }, [selectedMessages, messages, exitSelectionMode])

  const handleBulkDeleteForMe = useCallback(async () => {
    const ids = Array.from(selectedMessages)
    
    // Try to insert into deleted_messages table for each message
    if (user) {
      for (const id of ids) {
        try {
          await supabase
            .from('deleted_messages')
            .insert({
              message_id: id,
              user_id: user.id,
              deleted_at: new Date().toISOString(),
            })
        } catch (error) {
          console.log('Using local state for delete for me:', error)
        }
      }
    }
    
    // Update local state to hide the messages
    setDeletedForMeIds(prev => new Set([...prev, ...ids]))
    setMessages(prev => prev.filter(m => !selectedMessages.has(m.id)))
    setShowBulkDeleteDialog(false)
    exitSelectionMode()
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
        {/* Header JemaOS - Selection mode header on mobile */}
        {isSelectionMode && isMobile ? (
          <div className="bg-bg-surface px-2 sm:px-4 py-2 sm:py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={exitSelectionMode}
                className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1]"
              >
                <ArrowLeft size={20} />
              </button>
              <span className="text-lg font-medium text-text-primary">{selectedMessages.size}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setReplyToMessage(messages.find(m => selectedMessages.has(m.id)) || null)}
                disabled={selectedMessages.size !== 1}
                className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1] disabled:opacity-50"
                title="Répondre"
              >
                <Reply size={20} />
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={selectedMessages.size === 0}
                className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1] disabled:opacity-50"
                title="Supprimer"
              >
                <Trash2 size={20} />
              </button>
              <button
                onClick={handleBulkForward}
                disabled={selectedMessages.size === 0}
                className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1] disabled:opacity-50"
                title="Transférer"
              >
                <Forward size={20} />
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowSelectionMenu(!showSelectionMenu)}
                  className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1]"
                >
                  <MoreVertical size={20} />
                </button>
                
                {/* Selection mode dropdown menu */}
                {showSelectionMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowSelectionMenu(false)} />
                    <div className="absolute right-0 top-12 z-50 min-w-[200px] bg-bg-surface rounded-2xl shadow-2xl py-2 border border-bg-hover">
                      <button
                        onClick={() => {
                          handleBulkStar()
                          setShowSelectionMenu(false)
                        }}
                        disabled={selectedMessages.size === 0}
                        className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3 disabled:opacity-50"
                      >
                        <Star size={18} />
                        <span>Important</span>
                      </button>
                      <button
                        onClick={() => {
                          // Show info about selected message
                          if (selectedMessages.size === 1) {
                            const msgId = Array.from(selectedMessages)[0]
                            const msg = messages.find(m => m.id === msgId)
                            if (msg) {
                              alert(`Infos du message:\n\nEnvoyé le: ${new Date(msg.created_at).toLocaleString('fr-FR')}\nType: ${msg.type}\nStatut: ${msg.status || 'envoyé'}`)
                            }
                          }
                          setShowSelectionMenu(false)
                        }}
                        disabled={selectedMessages.size !== 1}
                        className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3 disabled:opacity-50"
                      >
                        <Info size={18} />
                        <span>Infos</span>
                      </button>
                      <button
                        onClick={() => {
                          // Share selected messages
                          const selectedMsgs = messages.filter(m => selectedMessages.has(m.id))
                          const textContent = selectedMsgs
                            .filter(m => m.type === 'text' && m.content)
                            .map(m => m.content)
                            .join('\n')
                          
                          if (navigator.share && textContent) {
                            navigator.share({
                              title: 'Message partagé',
                              text: textContent,
                            }).catch(() => {})
                          } else if (textContent) {
                            navigator.clipboard.writeText(textContent)
                            alert('Contenu copié!')
                          }
                          setShowSelectionMenu(false)
                          exitSelectionMode()
                        }}
                        disabled={selectedMessages.size === 0}
                        className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3 disabled:opacity-50"
                      >
                        <Share2 size={18} />
                        <span>Partager</span>
                      </button>
                      <button
                        onClick={() => {
                          // Pin selected message
                          if (selectedMessages.size === 1) {
                            const msgId = Array.from(selectedMessages)[0]
                            handlePinMessage(msgId)
                          }
                          setShowSelectionMenu(false)
                        }}
                        disabled={selectedMessages.size !== 1}
                        className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3 disabled:opacity-50"
                      >
                        <Pin size={18} />
                        <span>Épingler</span>
                      </button>
                      <button
                        onClick={() => {
                          handleBulkCopy()
                          setShowSelectionMenu(false)
                        }}
                        disabled={selectedMessages.size === 0}
                        className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3 disabled:opacity-50"
                      >
                        <Copy size={18} />
                        <span>Copier</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
        <div className="bg-bg-surface px-2 sm:px-4 py-2 sm:py-3 flex items-center gap-2 sm:gap-4">
          <button onClick={() => navigate('/chats')} className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1]">
            <ArrowLeft size={20} />
          </button>
          <div
            className="flex-1 flex items-center gap-3 cursor-pointer hover:bg-bg-hover -mx-2 px-2 py-1 rounded transition-colors"
            onClick={() => setShowConversationInfo(true)}
          >
            {(conversation?.type === 'direct' && otherUser?.avatar_url) || conversation?.avatar_url ? (
              <img
                src={conversation?.type === 'direct' ? otherUser?.avatar_url! : conversation?.avatar_url!}
                alt={displayName}
                className="w-10 h-10 rounded-full object-cover"
                key={conversation?.type === 'direct' ? otherUser?.avatar_url : conversation?.avatar_url}
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold">
                {displayName[0]?.toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="font-medium text-text-primary truncate">{displayName}</h2>
              <span className="text-xs text-text-secondary">en ligne</span>
            </div>
          </div>
          <div className="flex gap-1 sm:gap-2">
            <button onClick={() => setIsSearching(!isSearching)} className="w-8 h-8 sm:w-10 sm:h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1]">
              <Search size={18} className="sm:hidden" />
              <Search size={20} className="hidden sm:block" />
            </button>
            <button onClick={handleStartAudioCall} className="w-8 h-8 sm:w-10 sm:h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1]">
              <Phone size={18} className="sm:hidden" />
              <Phone size={20} className="hidden sm:block" />
            </button>
            <button onClick={handleStartVideoCall} className="w-8 h-8 sm:w-10 sm:h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1]">
              <Video size={18} className="sm:hidden" />
              <Video size={20} className="hidden sm:block" />
            </button>
            <div className="relative">
              <button
                onClick={() => setShowConversationMenu(!showConversationMenu)}
                className="w-8 h-8 sm:w-10 sm:h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1]"
              >
                <MoreVertical size={18} className="sm:hidden" />
                <MoreVertical size={20} className="hidden sm:block" />
              </button>
              
              {showConversationMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowConversationMenu(false)} />
                  <div className="absolute right-0 top-12 z-50 min-w-[240px] bg-bg-surface rounded-2xl shadow-2xl py-2 border border-bg-hover">
                    {/* For group conversations: add members. For direct: create new group */}
                    <button
                      onClick={() => {
                        setShowConversationMenu(false)
                        if (conversation?.type === 'group') {
                          // Open conversation info to add members
                          setShowConversationInfo(true)
                          setShowAddMemberModal(true)
                        } else {
                          // For direct conversations, navigate to groups page to create a new group
                          // Pass the other user's ID as a query parameter to pre-select them
                          if (otherUser) {
                            navigate(`/groups/new?createWith=${otherUser.id}`)
                          } else {
                            navigate('/groups/new')
                          }
                        }
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                    >
                      <UserPlus size={18} />
                      <span>{conversation?.type === 'group' ? 'Ajouter des membres' : 'Créer un groupe'}</span>
                    </button>
                    <button
                      onClick={async () => {
                        await supabase
                          .from('conversation_members')
                          .update({ is_muted: true })
                          .eq('conversation_id', conversationId!)
                          .eq('user_id', user!.id)
                        setShowConversationMenu(false)
                        alert('Notifications désactivées pour cette conversation')
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                    >
                      <BellOff size={18} />
                      <span>Désactiver les notifications</span>
                    </button>
                    <button
                      onClick={async () => {
                        await supabase
                          .from('conversation_members')
                          .update({ is_archived: true })
                          .eq('conversation_id', conversationId!)
                          .eq('user_id', user!.id)
                        setShowConversationMenu(false)
                        navigate('/chats')
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                    >
                      <Archive size={18} />
                      <span>Archiver la discussion</span>
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Voulez-vous vraiment supprimer cette conversation ?')) {
                          supabase.from('conversation_members').delete().eq('conversation_id', conversationId!).eq('user_id', user!.id)
                          navigate('/chats')
                        }
                        setShowConversationMenu(false)
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors text-[#ea4335] text-sm flex items-center gap-3"
                    >
                      <Trash2 size={18} />
                      <span>Supprimer la discussion</span>
                    </button>
                    <div className="border-t border-bg-hover my-2" />
                    <button
                      onClick={() => {
                        setShowConversationMenu(false)
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                    >
                      <Lock size={18} />
                      <span>Chiffrement : Activé</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        )}

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
        <div
          className="flex-1 overflow-y-auto p-2 sm:p-3 md:p-4 space-y-2 pb-36 md:pb-4"
          style={getWallpaperStyle()}
          onContextMenu={handleBackgroundContextMenu}
        >
          {loading ? (
            <div className="flex justify-center items-center h-full">
              <div className="w-8 h-8 rounded-full border-4 border-[#00a884] border-t-transparent animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-3 px-8">
              <div className="w-16 h-16 rounded-full bg-bg-surface flex items-center justify-center">
                <svg width="24" height="28" viewBox="0 0 16 20" fill="#8696a0">
                  <path d="M13 7h-1V5c0-2.21-1.79-4-4-4S4 2.79 4 5v2H3c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm-5 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H4.9V5c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                </svg>
              </div>
              <div>
                <p className="text-sm text-text-secondary mb-1">Les messages sont chiffrés de bout en bout</p>
                <p className="text-xs text-text-secondary">Personne en dehors de cette discussion ne peut les lire</p>
              </div>
            </div>
          ) : (
            <>
              {displayedMessages.map((message) => {
                const isOwn = message.sender_id === user?.id
                const messageReactions = reactions.filter(r => r.message_id === message.id)
                const isSelected = selectedMessages.has(message.id)
                // Long press handlers for mobile
                const handleTouchStart = (msg: Message) => {
                  if (!isMobile) return
                  longPressMessageRef.current = msg
                  longPressTimerRef.current = setTimeout(() => {
                    // On long press: enter selection mode and show emoji bar
                    setIsSelectionMode(true)
                    setSelectedMessages(new Set([msg.id]))
                    
                    // Show quick reaction bar above the message
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
                  }, 500) // 500ms for long press
                }

                const handleTouchEnd = () => {
                  if (longPressTimerRef.current) {
                    clearTimeout(longPressTimerRef.current)
                    longPressTimerRef.current = null
                  }
                  longPressMessageRef.current = null
                }

                const handleTouchMove = () => {
                  // Cancel long press if user moves finger
                  if (longPressTimerRef.current) {
                    clearTimeout(longPressTimerRef.current)
                    longPressTimerRef.current = null
                  }
                  longPressMessageRef.current = null
                }

                return (
                  <div
                    key={message.id}
                    id={`message-${message.id}`}
                    className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-1 ${isSelected ? 'bg-[#00a884]/10' : ''} transition-colors duration-500`}
                    onMouseEnter={() => setHoveredMessageId(message.id)}
                    onMouseLeave={() => setHoveredMessageId(null)}
                    onTouchStart={() => handleTouchStart(message)}
                    onTouchEnd={handleTouchEnd}
                    onTouchMove={handleTouchMove}
                    onClick={() => {
                      // In selection mode, clicking anywhere on the message row selects/deselects it
                      if (isSelectionMode) {
                        handleSelectMessage(message.id)
                      }
                    }}
                  >
                    {/* Quick action buttons - LEFT of sent messages (isOwn) */}
                    {isOwn && hoveredMessageId === message.id && !isSelectionMode && (
                      <div className="flex items-center gap-0.5 md:gap-1 mr-1 md:mr-2">
                        {/* Mobile: only Reply button */}
                        <button
                          onClick={() => setReplyToMessage(message)}
                          className="md:hidden w-8 h-8 rounded-full bg-[#3b4a54] hover:bg-[#4a5c68] flex items-center justify-center transition-colors shadow-md"
                          title="Répondre"
                        >
                          <Reply size={16} className="text-[#8696a0]" />
                        </button>
                        {/* Desktop: all 3 buttons */}
                        <button
                          onClick={() => handleForwardMessage(message)}
                          className="hidden md:flex w-8 h-8 rounded-full bg-[#3b4a54] hover:bg-[#4a5c68] items-center justify-center transition-colors shadow-md"
                          title="Transférer"
                        >
                          <Forward size={16} className="text-[#8696a0]" />
                        </button>
                        <button
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setQuickReactionBar({
                              isOpen: true,
                              position: { x: rect.left + rect.width / 2, y: rect.top },
                              message,
                            });
                          }}
                          className="hidden md:flex w-8 h-8 rounded-full bg-[#3b4a54] hover:bg-[#4a5c68] items-center justify-center transition-colors shadow-md"
                          title="Réagir"
                        >
                          <Smile size={16} className="text-[#8696a0]" />
                        </button>
                        <button
                          onClick={() => setReplyToMessage(message)}
                          className="hidden md:flex w-8 h-8 rounded-full bg-[#3b4a54] hover:bg-[#4a5c68] items-center justify-center transition-colors shadow-md"
                          title="Répondre"
                        >
                          <Reply size={16} className="text-[#8696a0]" />
                        </button>
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] md:max-w-[65%] relative group`}
                      data-message-id={message.id}
                      onContextMenu={(e) => {
                        // On mobile, prevent native context menu - use long press instead
                        if (isMobile) {
                          e.preventDefault()
                          return
                        }
                        handleContextMenu(e, message)
                      }}
                    >
                      <div className={`relative px-3 py-2 rounded-2xl ${isOwn ? 'bg-[#005c4b] text-white rounded-br-none' : 'bg-bg-surface text-text-primary rounded-bl-none'}`}>
                        {/* Hover Actions (Chevron dropdown) - Inside message bubble */}
                        <MessageHoverActions
                          isVisible={hoveredMessageId === message.id}
                          isOwn={isOwn}
                          onOpenMenu={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setContextMenu({
                              isOpen: true,
                              position: { x: rect.left, y: rect.bottom + 5 },
                              message,
                            });
                          }}
                        />
                        {/* Reply quote inside message - clickable to scroll to original */}
                        {message.reply_to_id && (() => {
                          const replyMessage = messages.find(m => m.id === message.reply_to_id)
                          if (replyMessage) {
                            const replySenderName = replyMessage.sender_id === user?.id
                              ? 'Vous'
                              : otherUser?.display_name || otherUser?.username || 'Utilisateur'
                            return (
                              <div
                                className={`mb-2 rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity ${isOwn ? 'bg-[#004438]' : 'bg-bg-hover'}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  scrollToMessage(replyMessage.id)
                                }}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    scrollToMessage(replyMessage.id)
                                  }
                                }}
                                aria-label={`Aller au message de ${replySenderName}`}
                              >
                                <div className="flex items-stretch">
                                  <div className="w-1 bg-accent flex-shrink-0" />
                                  <div className="flex-1 min-w-0 px-3 py-2">
                                    <div className="text-xs font-semibold text-accent mb-0.5">
                                      {replySenderName}
                                    </div>
                                    <div className={`text-sm truncate ${isOwn ? 'text-white/70' : 'text-text-secondary'}`}>
                                      {replyMessage.content?.substring(0, 100) || '[Média]'}
                                      {replyMessage.content && replyMessage.content.length > 100 ? '...' : ''}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )
                          }
                          return null
                        })()}
                        {message.media_url && message.media_type && message.type !== 'audio' && (
                          <MediaMessage url={message.media_url} type={message.media_type as 'image' | 'video' | 'file'} fileName={message.file_name} fileSize={message.file_size} caption={message.content} />
                        )}
                        {message.type === 'audio' && message.media_url && (
                          <VoiceMessage url={message.media_url} duration={message.ephemeral_duration || 0} isOwn={isOwn} />
                        )}
                        {(!message.media_url && message.content) && (
                          <>
                            {/* Check for GIF or Sticker patterns */}
                            {(() => {
                              // Pattern with optional caption: "caption\n[GIF](url)" or just "[GIF](url)"
                              const gifMatch = message.content.match(/^(?:([\s\S]*?)\n)?\[GIF\]\((https?:\/\/[^\)]+)\)$/)
                              const stickerMatch = message.content.match(/^(?:([\s\S]*?)\n)?\[STICKER\]\((https?:\/\/[^\)]+)\)$/)
                              
                              if (gifMatch) {
                                const caption = gifMatch[1]
                                const gifUrl = gifMatch[2]
                                return (
                                  <div className="space-y-1 max-w-[200px] sm:max-w-[240px]">
                                    <div className="rounded-lg overflow-hidden">
                                      <img
                                        src={gifUrl}
                                        alt="GIF"
                                        className="w-full h-auto max-h-[160px] sm:max-h-[180px] object-contain"
                                        loading="lazy"
                                      />
                                    </div>
                                    {caption && (
                                      <p className="text-sm whitespace-pre-wrap break-words pt-1">{caption}</p>
                                    )}
                                  </div>
                                )
                              }
                              
                              if (stickerMatch) {
                                const caption = stickerMatch[1]
                                const stickerUrl = stickerMatch[2]
                                return (
                                  <div className="space-y-1">
                                    <div className="max-w-[100px] sm:max-w-[120px]">
                                      <img
                                        src={stickerUrl}
                                        alt="Sticker"
                                        className="w-full h-auto max-h-[100px] sm:max-h-[120px] object-contain"
                                        loading="lazy"
                                      />
                                    </div>
                                    {caption && (
                                      <p className="text-sm whitespace-pre-wrap break-words pt-1">{caption}</p>
                                    )}
                                  </div>
                                )
                              }
                              
                              // Regular text message - if there's a link preview, don't show the URL in text
                              let displayContent = message.content
                              if ((message as any).link_preview) {
                                try {
                                  const previewData = typeof (message as any).link_preview === 'string'
                                    ? JSON.parse((message as any).link_preview)
                                    : (message as any).link_preview
                                  // Remove the URL from the message content since it will be shown in the preview
                                  if (previewData.url) {
                                    displayContent = message.content.replace(previewData.url, '').trim()
                                  }
                                } catch {
                                  // Keep original content if parsing fails
                                }
                              }
                              
                              // Only show text if there's content after removing the URL
                              return displayContent ? <p className="text-sm whitespace-pre-wrap break-words">{displayContent}</p> : null
                            })()}
                            {/* Link Preview in message */}
                            {(message as any).link_preview && (() => {
                              try {
                                const previewData = typeof (message as any).link_preview === 'string'
                                  ? JSON.parse((message as any).link_preview)
                                  : (message as any).link_preview
                                return (
                                  <LinkPreview
                                    preview={previewData}
                                    isInMessage={true}
                                    isOwn={isOwn}
                                  />
                                )
                              } catch {
                                return null
                              }
                            })()}
                          </>
                        )}
                        <div className={`flex items-center justify-end gap-1 mt-1 text-xs ${isOwn ? 'text-text-secondary' : 'text-text-secondary'}`}>
                          {message.is_starred && (
                            <Star size={12} className="fill-current" />
                          )}
                          <span>{formatTime(message.created_at)}</span>
                          {isOwn && (
                            <>
                              {/* Message status indicators like WhatsApp */}
                              {message.status === 'sent' && (
                                /* Single gray check - sent */
                                <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
                                  <path d="M10.5 1L4.5 7L2 4.5" stroke="#8696a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                              {message.status === 'delivered' && (
                                /* Double gray checks - delivered */
                                <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
                                  <path d="M1.5 5.5L4.5 8.5L10.5 2.5" stroke="#8696a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                  <path d="M5.5 5.5L8.5 8.5L14.5 2.5" stroke="#8696a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                              {message.status === 'read' && (
                                /* Double blue checks - read */
                                <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
                                  <path d="M1.5 5.5L4.5 8.5L10.5 2.5" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                  <path d="M5.5 5.5L8.5 8.5L14.5 2.5" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                              {!message.status && (
                                /* Default: single gray check */
                                <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
                                  <path d="M10.5 1L4.5 7L2 4.5" stroke="#8696a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      {/* Selection checkbox - shown in selection mode */}
                      {isSelectionMode && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectMessage(message.id);
                          }}
                          className={`absolute top-1/2 -translate-y-1/2 ${
                            isOwn ? '-left-10' : '-right-10'
                          } w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                            isSelected
                              ? 'bg-[#00a884] text-white'
                              : 'bg-bg-surface hover:bg-bg-hover text-text-tertiary border border-bg-hover'
                          }`}
                          type="button"
                          aria-label={isSelected ? 'Désélectionner le message' : 'Sélectionner le message'}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        </button>
                      )}
                      {messageReactions.length > 0 && (
                        <MessageReactions reactions={messageReactions} currentUserId={user?.id || ''} onReactionClick={(emoji) => addReaction(message.id, emoji)} onReactionRemove={(emoji) => removeReaction(message.id, emoji)} />
                      )}
                    </div>
                    {/* Quick action buttons - RIGHT of received messages */}
                    {!isOwn && hoveredMessageId === message.id && !isSelectionMode && (
                      <div className="flex items-center gap-0.5 md:gap-1 pb-4 ml-1 md:ml-2">
                        {/* Mobile: only Reply button */}
                        <button
                          onClick={() => setReplyToMessage(message)}
                          className="md:hidden w-8 h-8 rounded-full bg-[#3b4a54] hover:bg-[#4a5c68] flex items-center justify-center transition-colors shadow-md"
                          title="Répondre"
                        >
                          <Reply size={16} className="text-[#8696a0]" />
                        </button>
                        {/* Desktop: all 3 buttons */}
                        <button
                          onClick={() => setReplyToMessage(message)}
                          className="hidden md:flex w-8 h-8 rounded-full bg-[#3b4a54] hover:bg-[#4a5c68] items-center justify-center transition-colors shadow-md"
                          title="Répondre"
                        >
                          <Reply size={16} className="text-[#8696a0]" />
                        </button>
                        <button
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setQuickReactionBar({
                              isOpen: true,
                              position: { x: rect.left + rect.width / 2, y: rect.top },
                              message,
                            });
                          }}
                          className="hidden md:flex w-8 h-8 rounded-full bg-[#3b4a54] hover:bg-[#4a5c68] items-center justify-center transition-colors shadow-md"
                          title="Réagir"
                        >
                          <Smile size={16} className="text-[#8696a0]" />
                        </button>
                        <button
                          onClick={() => handleForwardMessage(message)}
                          className="hidden md:flex w-8 h-8 rounded-full bg-[#3b4a54] hover:bg-[#4a5c68] items-center justify-center transition-colors shadow-md"
                          title="Transférer"
                        >
                          <Forward size={16} className="text-[#8696a0]" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input Bar JemaOS - Fixed at bottom on mobile, above nav bar - Hidden in selection mode */}
        {!isSelectionMode && (
        <div className="fixed md:relative bottom-14 md:bottom-0 left-0 right-0 bg-bg-surface px-2 sm:px-3 md:px-4 py-2 md:py-3 border-t border-bg-hover md:border-t-0 z-40">
          {/* Link Preview above input */}
          {isLoadingPreview && <LinkPreviewSkeleton />}
          {linkPreview && !isLoadingPreview && (
            <LinkPreview
              preview={linkPreview}
              onDismiss={handleDismissPreview}
            />
          )}
          
          {replyToMessage && (
            <MessageReply replyToMessage={{ id: replyToMessage.id, content: replyToMessage.content, sender_id: replyToMessage.sender_id, senderName: replyToMessage.sender_id === user?.id ? 'Vous' : otherUser?.display_name || otherUser?.username || 'Utilisateur' }} onCancel={() => setReplyToMessage(null)} isPreview={true} />
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
          onMultipleUploadComplete={async (files) => {
            if (!user) return
            setSending(true)
            try {
              // Send each file as a separate message
              for (const file of files) {
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
                }
                await supabase.from('messages').insert(messageData)
              }
              setNewMessage('')
              setReplyToMessage(null)
              setShowMediaUploader(false)
              await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId!)
            } finally {
              setSending(false)
            }
          }}
          onCancel={() => setShowMediaUploader(false)}
          onEmojiSelect={(emoji) => {
            setNewMessage(prev => prev + emoji)
            setShowMediaUploader(false)
          }}
          onGifStickerSend={async (url, type, caption) => {
            if (!user) return
            setSending(true)
            try {
              const prefix = type === 'gif' ? 'GIF' : 'STICKER'
              const content = caption ? `${caption}\n[${prefix}](${url})` : `[${prefix}](${url})`
              
              const messageData: any = {
                conversation_id: conversationId!,
                sender_id: user.id,
                content: content,
                type: 'text',
                status: 'sent',
                reply_to_id: replyToMessage?.id || null,
              }
              
              const { error } = await supabase.from('messages').insert(messageData)
              if (!error) {
                setReplyToMessage(null)
                setShowMediaUploader(false)
                await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId!)
              }
            } finally {
              setSending(false)
            }
          }}
        />
      )}
      {showVoiceRecorder && <VoiceRecorder onRecordingComplete={handleVoiceRecordingComplete} onCancel={() => setShowVoiceRecorder(false)} />}
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
        }}
        onMoreOptions={() => {
          if (quickReactionBar.message) {
            setContextMenu({
              isOpen: true,
              position: quickReactionBar.position,
              message: quickReactionBar.message,
            })
          }
        }}
        onClose={() => setQuickReactionBar({ isOpen: false, position: { x: 0, y: 0 }, message: null })}
      />
    </MainLayout>
  )
}
