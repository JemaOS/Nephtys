import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/context/ThemeContext'
import { MainLayout } from '@/components/MainLayout'
import { supabase, Message, Conversation, Profile } from '@/lib/supabase'
import { ArrowLeft, Send, Phone, Video, MoreVertical, Search, Smile, Mic, Plus, Reply, UserPlus, Archive, Trash2, Bell, BellOff, Lock } from 'lucide-react'
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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  
  const { reactions, addReaction, removeReaction } = useMessageReactions(conversationId || '')
  const { startCall } = useCall()
  const { permission, requestPermission, sendNotification, subscribeToConversation, unsubscribeFromConversation } = useNotifications()
  const { wallpaper } = useTheme()
  
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
    
    const channel = supabase
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
    return () => { supabase.removeChannel(channel); unsubscribeFromConversation(conversationId) }
  }, [conversationId, user?.id, permission])

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

  const handleEmojiSelect = (emoji: string) => {
    setNewMessage(prev => prev + emoji)
    setShowEmojiPicker(false)
  }

  const loadConversation = async () => {
    const { data, error } = await supabase.from('conversations').select('*').eq('id', conversationId!).maybeSingle()
    if (!error && data) {
      setConversation(data)
      if (data.type === 'direct') {
        const { data: members } = await supabase.from('conversation_members').select('user_id').eq('conversation_id', conversationId!).neq('user_id', user!.id)
        if (members && members.length > 0) {
          const { data: otherUserData } = await supabase.from('profiles').select('*').eq('id', members[0].user_id).maybeSingle()
          if (otherUserData) setOtherUser(otherUserData)
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
    if (!otherUser || !conversationId) return
    
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
    if (!otherUser || !conversationId) return
    
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

  const displayName = conversation?.type === 'group' ? conversation.name : otherUser?.display_name || otherUser?.username || 'Utilisateur'

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col bg-bg-primary h-full overflow-hidden">
        {/* Header WhatsApp */}
        <div className="bg-bg-surface px-2 sm:px-4 py-2 sm:py-3 flex items-center gap-2 sm:gap-4">
          <button onClick={() => navigate('/chats')} className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1]">
            <ArrowLeft size={20} />
          </button>
          <div
            className="flex-1 flex items-center gap-3 cursor-pointer hover:bg-bg-hover -mx-2 px-2 py-1 rounded transition-colors"
            onClick={() => setShowConversationInfo(true)}
          >
            {conversation?.avatar_url ? (
              <img
                src={conversation.avatar_url}
                alt={displayName}
                className="w-10 h-10 rounded-full object-cover"
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
                  <div className="absolute right-0 top-12 z-50 min-w-[240px] bg-[#233138] rounded-2xl shadow-2xl py-2 border border-bg-hover">
                    <button
                      onClick={() => {
                        navigate('/contacts')
                        setShowConversationMenu(false)
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                    >
                      <UserPlus size={18} />
                      <span>Ajouter au groupe</span>
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

        {isSearching && <MessageSearch messages={messages} onSearchResults={setFilteredMessages} onClose={() => { setIsSearching(false); setFilteredMessages([]) }} />}

        {/* Messages avec fond personnalisable */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-3 md:p-4 space-y-2 pb-24 md:pb-4" style={getWallpaperStyle()}>
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
                return (
                  <div key={message.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-1`} onMouseEnter={() => setHoveredMessageId(message.id)} onMouseLeave={() => setHoveredMessageId(null)}>
                    <div className={`max-w-[85%] md:max-w-[65%] relative group`}>
                      <div className={`px-3 py-2 rounded-2xl ${isOwn ? 'bg-[#005c4b] text-white rounded-br-none' : 'bg-bg-surface text-text-primary rounded-bl-none'}`}>
                        {message.media_url && message.media_type && message.type !== 'audio' && (
                          <MediaMessage url={message.media_url} type={message.media_type as 'image' | 'video' | 'file'} fileName={message.file_name} fileSize={message.file_size} caption={message.content} />
                        )}
                        {message.type === 'audio' && message.media_url && (
                          <VoiceMessage url={message.media_url} duration={message.ephemeral_duration || 0} isOwn={isOwn} />
                        )}
                        {(!message.media_url && message.content) && (
                          <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                        )}
                        <div className={`flex items-center justify-end gap-1 mt-1 text-xs ${isOwn ? 'text-text-secondary' : 'text-text-secondary'}`}>
                          <span>{formatTime(message.created_at)}</span>
                          {isOwn && (
                            <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
                              <path d="M11.071.653a.75.75 0 0 0-1.06 1.06l3.182 3.183-3.182 3.182a.75.75 0 1 0 1.06 1.061l3.712-3.712a.75.75 0 0 0 0-1.06L11.071.653Z" fill={message.status === 'read' ? '#53bdeb' : '#8696a0'}/>
                              <path d="M6.071.653a.75.75 0 0 0-1.06 1.06l3.182 3.183-3.182 3.182a.75.75 0 1 0 1.06 1.061l3.712-3.712a.75.75 0 0 0 0-1.06L6.071.653Z" fill={message.status === 'read' ? '#53bdeb' : '#8696a0'}/>
                            </svg>
                          )}
                        </div>
                      </div>
                      {messageReactions.length > 0 && (
                        <MessageReactions reactions={messageReactions} currentUserId={user?.id || ''} onReactionClick={(emoji) => addReaction(message.id, emoji)} onReactionRemove={(emoji) => removeReaction(message.id, emoji)} />
                      )}
                      {hoveredMessageId === message.id && (
                        <div className={`absolute -bottom-2 ${isOwn ? 'left-2' : 'right-2'} opacity-0 group-hover:opacity-100 transition-opacity flex gap-1`}>
                          <button onClick={() => setReplyToMessage(message)} className="p-2 rounded-full bg-bg-surface hover:bg-bg-hover transition-colors" aria-label="Répondre">
                            <Reply size={16} className="text-text-secondary" />
                          </button>
                          <EmojiPicker onEmojiSelect={(emoji) => addReaction(message.id, emoji)} />
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input Bar WhatsApp - Fixed at bottom on mobile, above nav bar */}
        <div className="fixed md:relative bottom-14 md:bottom-0 left-0 right-0 bg-bg-surface px-2 sm:px-3 md:px-4 py-2 md:py-3 border-t border-bg-hover md:border-t-0 z-40">
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
      </div>

      {showMediaUploader && <MediaUploader onMediaSelect={(file, type) => console.log('Media selected:', file.name, type)} onUploadComplete={handleMediaUploadComplete} onCancel={() => setShowMediaUploader(false)} />}
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
            refreshConversation()
          }}
          onStartVideoCall={handleStartVideoCall}
          onStartAudioCall={handleStartAudioCall}
        />
      )}
    </MainLayout>
  )
}
