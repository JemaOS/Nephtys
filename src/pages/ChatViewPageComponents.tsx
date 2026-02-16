import React, { useRef, useEffect } from 'react'
import { ArrowLeft, Search, Phone, Video, MoreVertical, UserPlus, BellOff, Archive, Trash2, Lock, Star, Info, Share2, Copy, Reply, Forward, Pin, Smile } from 'lucide-react'
import { Message, Conversation, Profile } from '@/lib/supabase'
import { SelectionModeToolbar } from '@/components/SelectionModeToolbar'
import { CallMessage } from '@/components/CallMessage'
import { MessageHoverActions } from '@/components/MessageHoverActions'
import { MessageReactions } from '@/components/MessageReactions'
import { MessageReply } from '@/components/MessageReply'
import { MediaMessage } from '@/components/MediaMessage'
import { VoiceMessage } from '@/components/VoiceMessage'
import { AudioFilePlayer } from '@/components/AudioFilePlayer'
import { LinkPreview } from '@/components/LinkPreview'
import { MessageListSkeleton } from '@/components/MessageListSkeleton'
import { formatTime } from '@/components/MessageItemComponents'

// Helper to extract message type info - extracted to reduce complexity in MessageList
const getMessageTypeInfo = (message: Message) => {
  // Check if this is an emoji-only message (1-3 emojis, no other text)
  const emojiCheck = message.type === 'text' && message.content && !message.media_url
    ? isEmojiOnly(message.content)
    : { isEmoji: false, emojiCount: 0 }
  const isEmojiOnlyMessage = emojiCheck.isEmoji
  const emojiCount = emojiCheck.emojiCount

  // Check if this is a GIF or Sticker message
  const gifMatch = message.type === 'text' && message.content && !message.media_url
    ? message.content.match(/^(?:\[Transféré\]\s*)?([\s\S]*?)\[GIF\]\((https?:\/\/[^)]+)\)$/)
    : null
  const stickerMatch = message.type === 'text' && message.content && !message.media_url
    ? message.content.match(/^(?:\[Transféré\]\s*)?([\s\S]*?)\[STICKER\]\((https?:\/\/[^)]+)\)$/)
    : null
  const isGifMessage = !!gifMatch
  const isStickerMessage = !!stickerMatch
  const isGifOrStickerMessage = isGifMessage || isStickerMessage

  // Check if this is an image or video message
  const mediaUrl = message.media_url || message.file_url
  const mediaType = message.media_type || message.type
  
  const isMediaMessage = mediaUrl && (mediaType === 'image' || mediaType === 'video') && message.type !== 'audio'
  // Check if this is a document/file message
  const isDocumentMessage = mediaUrl && mediaType === 'file'

  return { isEmojiOnlyMessage, emojiCount, isGifMessage, isStickerMessage, isGifOrStickerMessage, mediaUrl, mediaType, isMediaMessage, isDocumentMessage, gifMatch, stickerMatch }
}

// Extracted component for system messages to reduce nesting complexity in MessageList
const SystemMessageItem = ({ messageId, content }: { messageId: string, content: string }) => (
  <div
    key={messageId}
    id={`message-${messageId}`}
    className="flex justify-center my-4 px-4"
  >
    <div className="relative bg-white/10 dark:bg-white/5 backdrop-blur-xl px-5 py-3 rounded-2xl max-w-[85%] sm:max-w-[70%] text-center border border-white/20 dark:border-white/10 shadow-lg">
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-accent/10 to-transparent pointer-events-none" />
      
      {/* Icon */}
      <div className="flex justify-center mb-2">
        <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
      </div>
      
      {/* Message content */}
      <p className="text-xs sm:text-sm text-text-secondary leading-relaxed relative z-10">
        {content}
      </p>
    </div>
  </div>
)

// Utility function to detect emoji-only messages// Extracted component for message status icons
const MessageStatusIcons = ({ status }: { status: string | undefined }) => {
  if (status === 'sent') {
    return (
      <svg width="14" height="9" viewBox="0 0 16 11" fill="none">
        <path d="M10.5 1L4.5 7L2 4.5" stroke="#8696a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  }
  if (status === 'delivered') {
    return (
      <svg width="14" height="9" viewBox="0 0 16 11" fill="none">
        <path d="M1.5 5.5L4.5 8.5L10.5 2.5" stroke="#8696a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5.5 5.5L8.5 8.5L14.5 2.5" stroke="#8696a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  }
  if (status === 'read') {
    return (
      <svg width="14" height="9" viewBox="0 0 16 11" fill="none">
        <path d="M1.5 5.5L4.5 8.5L10.5 2.5" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5.5 5.5L8.5 8.5L14.5 2.5" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  }
  return (
    <svg width="14" height="9" viewBox="0 0 16 11" fill="none">
      <path d="M10.5 1L4.5 7L2 4.5" stroke="#8696a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// Extracted component for message timestamp bubble
const MessageTimestamp = ({ timestamp, isStarred, isOwn, status }: { timestamp: string, isStarred: boolean, isOwn: boolean, status: string | undefined }) => (
  <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mt-1`}>
    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs ${
      isOwn ? 'bg-[#787add]/80' : 'bg-bg-surface/80'
    }`}>
      {isStarred && (
        <Star size={10} className="fill-current text-text-secondary" />
      )}
      <span className="text-text-secondary">{formatTime(timestamp)}</span>
      {isOwn && (
        <MessageStatusIcons status={status} />
      )}
    </div>
  </div>
)

export const isEmojiOnly = (text: string): { isEmoji: boolean; emojiCount: number } => {
  if (!text || text.trim() === '') return { isEmoji: false, emojiCount: 0 }
  
  const trimmed = text.trim()
  const emojiPattern = /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F?|\p{Regional_Indicator}{2}|[\u0023\u002A\u0030-\u0039]\uFE0F?\u20E3)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F?))*(?:\p{Emoji_Modifier})?/gu
  
  const emojis = trimmed.match(emojiPattern)
  if (!emojis) return { isEmoji: false, emojiCount: 0 }
  
  const emojiString = emojis.join('')
  const textWithoutWhitespace = trimmed.replace(/\s/g, '')
  
  if (textWithoutWhitespace === emojiString && emojis.length >= 1 && emojis.length <= 3) {
    return { isEmoji: true, emojiCount: emojis.length }
  }
  
  return { isEmoji: false, emojiCount: 0 }
}

export interface CallLog {
  id: string
  conversation_id: string
  caller_id: string
  callee_id: string | null
  type: 'audio' | 'video'
  status: 'initiated' | 'answered' | 'missed' | 'rejected' | 'ended'
  started_at: string
  ended_at: string | null
  duration: number | null
  participant_count: number | null
}

export interface TimelineItem {
  type: 'message' | 'call'
  timestamp: string
  data: Message | CallLog
}

interface ChatHeaderProps {
  isSelectionMode: boolean
  isMobile: boolean
  selectedMessages: Set<string>
  exitSelectionMode: () => void
  handleBulkDelete: () => void
  handleBulkStar: () => void
  handleBulkCopy: () => void
  handleBulkForward: () => void
  handleBulkDownload: () => void
  showSelectionMenu: boolean
  setShowSelectionMenu: (show: boolean) => void
  messages: Message[]
  handlePinMessage: (id: string) => void
  navigate: (path: string) => void
  setShowConversationInfo: (show: boolean) => void
  conversation: Conversation | null
  otherUser: Profile | null
  displayName: string
  otherUserStatusText: string
  otherUserIsOnline: boolean
  isSearching: boolean
  setIsSearching: (isSearching: boolean) => void
  handleStartAudioCall: () => void
  handleStartVideoCall: () => void
  showConversationMenu: boolean
  setShowConversationMenu: (show: boolean) => void
  setShowAddMemberModal: (show: boolean) => void
  user: any
  conversationId: string
  setReplyToMessage: (message: Message | null) => void
  setMessageToForward: (message: Message | null) => void
  setShowForwardModal: (show: boolean) => void
  supabase: any
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  isSelectionMode,
  isMobile,
  selectedMessages,
  exitSelectionMode,
  handleBulkDelete,
  handleBulkStar,
  handleBulkCopy,
  handleBulkForward,
  handleBulkDownload,
  showSelectionMenu,
  setShowSelectionMenu,
  messages,
  handlePinMessage,
  navigate,
  setShowConversationInfo,
  conversation,
  otherUser,
  displayName,
  otherUserStatusText,
  otherUserIsOnline,
  isSearching,
  setIsSearching,
  handleStartAudioCall,
  handleStartVideoCall,
  showConversationMenu,
  setShowConversationMenu,
  setShowAddMemberModal,
  user,
  conversationId,
  setReplyToMessage,
  setMessageToForward,
  setShowForwardModal,
  supabase
}) => {
  if (isSelectionMode && isMobile) {
    return (
      <div className="bg-bg-surface px-2 sm:px-4 py-2 sm:py-3 flex items-center justify-between flex-shrink-0 z-50">
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
            onClick={() => {
              const selectedMsg = messages.find(m => selectedMessages.has(m.id))
              if (selectedMsg) {
                setReplyToMessage(selectedMsg)
                exitSelectionMode()
              }
            }}
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
            onClick={() => {
              // Get the first selected message to forward immediately
              const selectedMsgs = messages.filter(m => selectedMessages.has(m.id))
              if (selectedMsgs.length > 0) {
                setMessageToForward(selectedMsgs[0])
                setShowForwardModal(true)
                exitSelectionMode()
              }
            }}
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
    )
  }

  return (
    <div className="bg-bg-surface px-2 sm:px-4 py-2 sm:py-3 flex items-center gap-2 sm:gap-4 flex-shrink-0 z-50">
      <button onClick={() => navigate('/chats')} className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1]">
        <ArrowLeft size={20} />
      </button>
      <div
        className="flex-1 flex items-center gap-3 cursor-pointer hover:bg-bg-hover -mx-2 px-2 py-1 rounded transition-colors"
        onClick={() => setShowConversationInfo(true)}
      >
        {(conversation?.type === 'direct' && otherUser?.avatar_url) || conversation?.avatar_url ? (
          <img
            src={conversation?.type === 'direct' ? otherUser?.avatar_url : conversation?.avatar_url}
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
          {conversation?.type === 'direct' && otherUserStatusText && (
            <span className={`text-xs ${otherUserIsOnline ? 'text-green-500' : 'text-text-secondary'}`}>
              {otherUserStatusText}
            </span>
          )}
          {conversation?.type === 'group' && (
            <span className="text-xs text-text-secondary">
              Groupe
            </span>
          )}
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
  )
}

interface TimelineItemComponentProps {
  item: TimelineItem
  user: any
  reactions: any[]
  selectedMessages: Set<string>
  hoveredMessageId: string | null
  setHoveredMessageId: (id: string | null) => void
  handleTouchStart: (msg: Message) => void
  handleTouchEnd: () => void
  handleTouchMove: () => void
  handleSelectMessage: (id: string) => void
  isSelectionMode: boolean
  isMobile: boolean
  setReplyToMessage: (msg: Message) => void
  handleForwardMessage: (msg: Message) => void
  setQuickReactionBar: (data: any) => void
  handleContextMenu: (e: React.MouseEvent, msg: Message) => void
  setContextMenu: (data: any) => void
  getSenderInfo: (id: string) => { name: string; avatar?: string }
  setGifStickerViewer: (data: any) => void
  handlePinMessage: (id: string) => void
  addReaction: (id: string, emoji: string) => void
  removeReaction: (id: string, emoji: string) => void
  handleStarMessage: (id: string) => void
  allMediaItems: any[]
  getMediaIndexForMessage: (id: string) => number
  handleMediaNavigate: (index: number) => void
  scrollToMessage: (id: string) => void
  handleStartVideoCall: () => void
  handleStartAudioCall: () => void
  otherUser: Profile | null
  messages: Message[]
}

// Helper components for TimelineItemComponent to reduce complexity

const EmojiMessageDisplay = ({ message, typeInfo, hoveredMessageId, isOwn, setContextMenu, addReaction }: any) => (
  <div className="relative">
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
    <div className={`${
      typeInfo.emojiCount === 1 ? 'text-7xl' : typeInfo.emojiCount === 2 ? 'text-6xl' : 'text-5xl'
    } leading-none py-1`}>
      {message.content}
    </div>
    <MessageTimestamp timestamp={message.created_at} isStarred={message.is_starred || false} isOwn={isOwn} status={message.status} />
  </div>
)

const GifStickerMessageDisplay = ({ message, typeInfo, hoveredMessageId, isOwn, setContextMenu, getSenderInfo, setGifStickerViewer, user }: any) => {
  const { isGifMessage, gifMatch, isStickerMessage, stickerMatch } = typeInfo
  
  return (
    <div className="relative">
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
      {isGifMessage && gifMatch && (() => {
        const caption = gifMatch[1]
        const gifUrl = gifMatch[2]
        const senderInfo = getSenderInfo(message.sender_id)
        return (
          <div className="space-y-1">
            <div
                className="overflow-hidden cursor-pointer max-w-[240px] sm:max-w-[280px] rounded-xl border-[3px] border-[#787add]"
                onClick={(e) => {
                e.stopPropagation()
                setGifStickerViewer({
                  isOpen: true,
                  url: gifUrl,
                  type: 'gif',
                  senderName: senderInfo.name,
                  senderAvatar: senderInfo.avatar,
                  timestamp: message.created_at,
                  isOwn: message.sender_id === user?.id,
                  messageId: message.id
                })
              }}
            >
              <img
                src={gifUrl}
                alt="GIF"
                className="w-full h-auto max-h-[200px] sm:max-h-[240px] object-contain"
                loading="lazy"
              />
            </div>
            {caption && (
              <div className={`px-3 py-2 rounded-2xl ${isOwn ? 'bg-[#787add] text-white' : 'bg-bg-surface text-text-primary'}`}>
                <p className="text-sm whitespace-pre-wrap break-words">{caption}</p>
              </div>
            )}
          </div>
        )
      })()}
      {isStickerMessage && stickerMatch && (() => {
        const caption = stickerMatch[1]
        const stickerUrl = stickerMatch[2]
        const senderInfo = getSenderInfo(message.sender_id)
        return (
          <div className="space-y-1">
            <div
              className="cursor-pointer max-w-[160px] sm:max-w-[200px] overflow-hidden rounded-xl border-[3px] border-[#787add]"
              onClick={(e) => {
                e.stopPropagation()
                setGifStickerViewer({
                  isOpen: true,
                  url: stickerUrl,
                  type: 'sticker',
                  senderName: senderInfo.name,
                  senderAvatar: senderInfo.avatar,
                  timestamp: message.created_at,
                  isOwn: message.sender_id === user?.id,
                  messageId: message.id
                })
              }}
            >
              <img
                src={stickerUrl}
                alt="Sticker"
                className="w-full h-auto max-h-[160px] sm:max-h-[200px] object-contain"
                loading="lazy"
              />
            </div>
            {caption && (
              <div className={`px-3 py-2 rounded-2xl ${isOwn ? 'bg-[#787add] text-white' : 'bg-bg-surface text-text-primary'}`}>
                <p className="text-sm whitespace-pre-wrap break-words">{caption}</p>
              </div>
            )}
          </div>
        )
      })()}
      <MessageTimestamp timestamp={message.created_at} isStarred={message.is_starred || false} isOwn={isOwn} status={message.status} />
    </div>
  )
}

const MediaMessageDisplay = ({ message, typeInfo, hoveredMessageId, isOwn, setContextMenu, getSenderInfo, handleForwardMessage, handleStarMessage, handlePinMessage, addReaction, allMediaItems, getMediaIndexForMessage, handleMediaNavigate, user }: any) => {
  const { mediaUrl, mediaType } = typeInfo
  const mediaSenderInfo = getSenderInfo(message.sender_id)
  
  return (
    <div className="relative">
      <div className="space-y-1">
        <MediaMessage
            url={mediaUrl!}
            type={mediaType as 'image' | 'video' | 'file'}
            fileName={message.file_name}
            fileSize={message.file_size}
            caption={message.content}
            width={message.media_width ?? undefined}
            height={message.media_height ?? undefined}
            thumbnail={message.media_thumbnail ?? undefined}
            senderName={mediaSenderInfo.name}
            senderAvatar={mediaSenderInfo.avatar}
            timestamp={message.created_at}
            isOwn={message.sender_id === user?.id}
            isStarred={message.is_starred || false}
            messageId={message.id}
            status={message.status as 'sent' | 'delivered' | 'read' | undefined}
            onForward={() => handleForwardMessage(message)}
            onStar={() => handleStarMessage(message.id)}
            onPin={() => handlePinMessage(message.id)}
            onReaction={(emoji) => addReaction(message.id, emoji)}
            showHoverActions={hoveredMessageId === message.id}
            onOpenMenu={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setContextMenu({
                isOpen: true,
                position: { x: rect.left, y: rect.bottom + 5 },
                message,
              });
            }}
            allMedia={allMediaItems}
            currentIndex={getMediaIndexForMessage(message.id)}
            onNavigate={handleMediaNavigate}
          />
      </div>
    </div>
  )
}

const DocumentMessageDisplay = ({ message, typeInfo, hoveredMessageId, isOwn, setContextMenu, getSenderInfo, handleForwardMessage, handleStarMessage, handlePinMessage, addReaction, user }: any) => {
  const { mediaUrl } = typeInfo
  const docSenderInfo = getSenderInfo(message.sender_id)
  
  return (
    <div className="relative">
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
      <MediaMessage
        url={mediaUrl!}
        type="file"
        fileName={message.file_name}
        fileSize={message.file_size}
        caption={message.content}
        thumbnail={message.media_thumbnail ?? undefined}
        senderName={docSenderInfo.name}
        timestamp={message.created_at}
        isOwn={message.sender_id === user?.id}
        isStarred={message.is_starred || false}
        messageId={message.id}
        status={message.status as 'sent' | 'delivered' | 'read' | undefined}
        onForward={() => handleForwardMessage(message)}
        onStar={() => handleStarMessage(message.id)}
        onPin={() => handlePinMessage(message.id)}
        onReaction={(emoji) => addReaction(message.id, emoji)}
        showHoverActions={hoveredMessageId === message.id}
        onOpenMenu={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setContextMenu({
            isOpen: true,
            position: { x: rect.left, y: rect.bottom + 5 },
            message,
          });
        }}
      />
    </div>
  )
}

const TextMessageDisplay = ({ message, hoveredMessageId, isOwn, setContextMenu, user, otherUser, messages, scrollToMessage, setReplyToMessage }: any) => {
  return (
    <div className={`relative px-3 py-2 rounded-2xl ${isOwn ? 'bg-[#787add] text-white rounded-br-none' : 'bg-bg-surface text-text-primary rounded-bl-none'}`}>
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
      {message.reply_to_id && (() => {
        const replyMessage = messages.find((m: Message) => m.id === message.reply_to_id)
        if (replyMessage) {
          const replySenderName = replyMessage.sender_id === user?.id
            ? 'Vous'
            : otherUser?.display_name || otherUser?.username || 'Utilisateur'
          return (
            <div onClick={(e) => { e.stopPropagation(); scrollToMessage(replyMessage.id); }}>
              <MessageReply
                replyToMessage={{
                  id: replyMessage.id,
                  content: replyMessage.content,
                  sender_id: replyMessage.sender_id,
                  senderName: replySenderName,
                  mediaUrl: replyMessage.media_url || replyMessage.file_url,
                  mediaType: replyMessage.media_type || replyMessage.type,
                  fileName: replyMessage.file_name
                }}
                isPreview={false}
              />
            </div>
          )
        }
        return null
      })()}
      {message.type === 'audio' && (message.media_url || message.file_url) && (
        message.file_name?.startsWith('voice-') ? (
          <VoiceMessage url={message.media_url || message.file_url || ''} duration={message.ephemeral_duration || 0} isOwn={isOwn} />
        ) : (
          <AudioFilePlayer
            url={message.media_url || message.file_url || ''}
            fileName={message.file_name || undefined}
            duration={message.ephemeral_duration || undefined}
            isOwn={isOwn}
          />
        )
      )}
      {(!(message.media_url || message.file_url) && message.content) && (
        <>
          {(() => {
            let displayContent = message.content
            if ((message as any).link_preview) {
              try {
                const previewData = typeof (message as any).link_preview === 'string'
                  ? JSON.parse((message as any).link_preview)
                  : (message as any).link_preview
                if (previewData.url) {
                  displayContent = message.content.replace(previewData.url, '').trim()
                  displayContent = displayContent.replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '').trim()
                }
              } catch {
              }
            }
            return displayContent ? <p className="text-sm whitespace-pre-wrap break-words">{displayContent}</p> : null
          })()}
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
      {!(message.media_url && (message.media_type === 'image' || message.media_type === 'video') && message.type !== 'audio') && (
      <div className={`flex items-center justify-end gap-1 mt-1 text-xs ${isOwn ? 'text-[#2d2f6e]' : 'text-text-secondary'}`}>
        {message.is_starred && (
          <Star size={12} className="fill-current" />
        )}
        <span>{formatTime(message.created_at)}</span>
        {isOwn && (
          <MessageStatusIcons status={message.status} />
        )}
      </div>
      )}
    </div>
  )
}

const MessageContent = (props: any) => {
  const { message } = props
  const typeInfo = getMessageTypeInfo(message)
  
  if (typeInfo.isEmojiOnlyMessage) return <EmojiMessageDisplay {...props} typeInfo={typeInfo} />
  if (typeInfo.isGifOrStickerMessage) return <GifStickerMessageDisplay {...props} typeInfo={typeInfo} />
  if (typeInfo.isMediaMessage) return <MediaMessageDisplay {...props} typeInfo={typeInfo} />
  if (typeInfo.isDocumentMessage) return <DocumentMessageDisplay {...props} typeInfo={typeInfo} />
  return <TextMessageDisplay {...props} />
}

const MessageSideActions = ({ isOwn, hoveredMessageId, message, isSelectionMode, setReplyToMessage, handleForwardMessage, setQuickReactionBar }: any) => {
  if (isOwn && hoveredMessageId === message.id && !isSelectionMode) {
    return (
      <div className="flex items-center gap-0.5 md:gap-1 mr-1 md:mr-2">
        <button
          onClick={() => setReplyToMessage(message)}
          className="md:hidden w-8 h-8 rounded-full bg-[#3b4a54] hover:bg-[#4a5c68] flex items-center justify-center transition-colors shadow-md"
          title="Répondre"
        >
          <Reply size={16} className="text-[#8696a0]" />
        </button>
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
    )
  }
  
  if (!isOwn && hoveredMessageId === message.id && !isSelectionMode) {
    return (
      <div className="flex items-center gap-0.5 md:gap-1 pb-4 ml-1 md:ml-2">
        <button
          onClick={() => setReplyToMessage(message)}
          className="md:hidden w-8 h-8 rounded-full bg-[#3b4a54] hover:bg-[#4a5c68] flex items-center justify-center transition-colors shadow-md"
          title="Répondre"
        >
          <Reply size={16} className="text-[#8696a0]" />
        </button>
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
    )
  }
  
  return null
}

const TimelineItemComponent: React.FC<TimelineItemComponentProps> = ({
  item,
  user,
  reactions,
  selectedMessages,
  hoveredMessageId,
  setHoveredMessageId,
  handleTouchStart,
  handleTouchEnd,
  handleTouchMove,
  handleSelectMessage,
  isSelectionMode,
  isMobile,
  setReplyToMessage,
  handleForwardMessage,
  setQuickReactionBar,
  handleContextMenu,
  setContextMenu,
  getSenderInfo,
  setGifStickerViewer,
  handlePinMessage,
  addReaction,
  removeReaction,
  handleStarMessage,
  allMediaItems,
  getMediaIndexForMessage,
  handleMediaNavigate,
  scrollToMessage,
  handleStartVideoCall,
  handleStartAudioCall,
  otherUser,
  messages
}) => {
  if (item.type === 'call') {
    const call = item.data as CallLog
    const isOutgoing = call.caller_id === user?.id
    const isGroupCall = call.caller_id === call.callee_id
    
    return (
      <CallMessage
        key={`call-${call.id}`}
        type={call.type}
        status={call.status}
        isOutgoing={isOutgoing}
        duration={call.duration}
        timestamp={call.started_at}
        isGroupCall={isGroupCall}
        participantCount={call.participant_count ?? undefined}
        isOwn={isOutgoing}
        onClick={() => {
          if (call.type === 'video') {
            handleStartVideoCall()
          } else {
            handleStartAudioCall()
          }
        }}
      />
    )
  }
  
  const message = item.data as Message
  const isOwn = message.sender_id === user?.id
  const messageReactions = reactions.filter(r => r.message_id === message.id)
  const isSelected = selectedMessages.has(message.id)
  
  const isSystemMessage = message.type === 'text' && message.content?.startsWith('[SYSTEM]')
  const systemMessageContent = isSystemMessage ? message.content.replace('[SYSTEM]', '') : ''
  
  if (isSystemMessage) {
    return (
      <SystemMessageItem
        key={message.id}
        messageId={message.id}
        content={systemMessageContent}
      />
    )
  }
  
  return (
    <div
      key={message.id}
      id={`message-${message.id}`}
      className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-1 ${isSelected ? 'bg-[#787add]/10' : ''} transition-colors duration-500`}
      onMouseEnter={() => setHoveredMessageId(message.id)}
      onMouseLeave={() => setHoveredMessageId(null)}
      onTouchStart={() => handleTouchStart(message)}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onClick={() => {
        if (isSelectionMode) {
          handleSelectMessage(message.id)
        }
      }}
    >
      <MessageSideActions
        isOwn={isOwn}
        hoveredMessageId={hoveredMessageId}
        message={message}
        isSelectionMode={isSelectionMode}
        setReplyToMessage={setReplyToMessage}
        handleForwardMessage={handleForwardMessage}
        setQuickReactionBar={setQuickReactionBar}
      />
      
      <div
        className={`max-w-[85%] sm:max-w-[75%] md:max-w-[70%] lg:max-w-[65%] relative group`}
        data-message-id={message.id}
        onContextMenu={(e) => {
          if (isMobile) {
            e.preventDefault()
            return
          }
          handleContextMenu(e, message)
        }}
      >
        <MessageContent
          message={message}
          hoveredMessageId={hoveredMessageId}
          isOwn={isOwn}
          setContextMenu={setContextMenu}
          getSenderInfo={getSenderInfo}
          setGifStickerViewer={setGifStickerViewer}
          user={user}
          handleForwardMessage={handleForwardMessage}
          handleStarMessage={handleStarMessage}
          handlePinMessage={handlePinMessage}
          addReaction={addReaction}
          allMediaItems={allMediaItems}
          getMediaIndexForMessage={getMediaIndexForMessage}
          handleMediaNavigate={handleMediaNavigate}
          scrollToMessage={scrollToMessage}
          messages={messages}
          otherUser={otherUser}
          setReplyToMessage={setReplyToMessage}
        />

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
                ? 'bg-[#787add] text-white'
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
      
      {!isOwn && (
        <MessageSideActions
          isOwn={isOwn}
          hoveredMessageId={hoveredMessageId}
          message={message}
          isSelectionMode={isSelectionMode}
          setReplyToMessage={setReplyToMessage}
          handleForwardMessage={handleForwardMessage}
          setQuickReactionBar={setQuickReactionBar}
        />
      )}
    </div>
  )
}

interface MessageListProps {
  loading: boolean
  messages: Message[]
  timelineItems: TimelineItem[]
  user: any
  reactions: any[]
  selectedMessages: Set<string>
  hoveredMessageId: string | null
  setHoveredMessageId: (id: string | null) => void
  handleTouchStart: (msg: Message) => void
  handleTouchEnd: () => void
  handleTouchMove: () => void
  handleSelectMessage: (id: string) => void
  isSelectionMode: boolean
  isMobile: boolean
  setReplyToMessage: (msg: Message) => void
  handleForwardMessage: (msg: Message) => void
  setQuickReactionBar: (data: any) => void
  handleContextMenu: (e: React.MouseEvent, msg: Message) => void
  setContextMenu: (data: any) => void
  getSenderInfo: (id: string) => { name: string; avatar?: string }
  setGifStickerViewer: (data: any) => void
  handlePinMessage: (id: string) => void
  addReaction: (id: string, emoji: string) => void
  removeReaction: (id: string, emoji: string) => void
  handleStarMessage: (id: string) => void
  allMediaItems: any[]
  getMediaIndexForMessage: (id: string) => number
  handleMediaNavigate: (index: number) => void
  scrollToMessage: (id: string) => void
  handleStartVideoCall: () => void
  handleStartAudioCall: () => void
  messagesEndRef: React.RefObject<HTMLDivElement>
  messagesContainerRef: React.RefObject<HTMLDivElement>
  getWallpaperStyle: () => React.CSSProperties
  handleBackgroundContextMenu: (e: React.MouseEvent) => void
  linkPreview: any
  replyToMessage: Message | null
  isLoadingPreview: boolean
  otherUser: Profile | null
  // Infinite scroll props
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void
  isLoadingMore?: boolean
  hasMoreMessages?: boolean
  messagesContentRef?: React.RefObject<HTMLDivElement>
}

export const MessageList: React.FC<MessageListProps> = ({
  loading,
  messages,
  timelineItems,
  user,
  reactions,
  selectedMessages,
  hoveredMessageId,
  setHoveredMessageId,
  handleTouchStart,
  handleTouchEnd,
  handleTouchMove,
  handleSelectMessage,
  isSelectionMode,
  isMobile,
  setReplyToMessage,
  handleForwardMessage,
  setQuickReactionBar,
  handleContextMenu,
  setContextMenu,
  getSenderInfo,
  setGifStickerViewer,
  handlePinMessage,
  addReaction,
  removeReaction,
  handleStarMessage,
  allMediaItems,
  getMediaIndexForMessage,
  handleMediaNavigate,
  scrollToMessage,
  handleStartVideoCall,
  handleStartAudioCall,
  messagesEndRef,
  messagesContainerRef,
  getWallpaperStyle,
  handleBackgroundContextMenu,
  linkPreview,
  replyToMessage,
  isLoadingPreview,
  otherUser,
  onScroll,
  isLoadingMore,
  hasMoreMessages,
  messagesContentRef
}) => {
  return (
    <div
      ref={messagesContainerRef}
      className={`flex-1 overflow-y-auto p-2 sm:p-3 md:p-4 space-y-2 md:pb-4 md:messages-container-mobile-reset ${
        (linkPreview || replyToMessage || isLoadingPreview)
          ? 'pb-[calc(56px+56px+env(safe-area-inset-bottom,0px)+100px)]'
          : 'pb-[calc(56px+56px+env(safe-area-inset-bottom,0px)+16px)]'
      }`}
      style={getWallpaperStyle()}
      onContextMenu={handleBackgroundContextMenu}
      onScroll={onScroll}
    >
      <div ref={messagesContentRef} className="flex flex-col min-h-full">
      {/* Loading indicator for infinite scroll */}
      {isLoadingMore && (
        <div className="flex justify-center py-2">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {/* "Load more" hint */}
      {!isLoadingMore && hasMoreMessages && messages.length > 0 && (
        <div className="flex justify-center py-2 opacity-50">
          <span className="text-xs text-text-secondary">↓ Faire défiler vers le haut pour charger plus</span>
        </div>
      )}
      {loading ? (
        <MessageListSkeleton count={8} />
      ) : messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center space-y-3 px-8 my-auto">
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
          <div>
          {timelineItems.map((item) => (
            <TimelineItemComponent
              key={item.type === 'call' ? `call-${item.data.id}` : `message-${item.data.id}`}
              item={item}
              user={user}
              reactions={reactions}
              selectedMessages={selectedMessages}
              hoveredMessageId={hoveredMessageId}
              setHoveredMessageId={setHoveredMessageId}
              handleTouchStart={handleTouchStart}
              handleTouchEnd={handleTouchEnd}
              handleTouchMove={handleTouchMove}
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
              otherUser={otherUser}
              messages={messages}
            />
          ))}
          </div>
          {/* Spacer element to ensure scroll goes past the last message */}
          <div ref={messagesEndRef} className="h-1 md:h-4" />
        </>
      )}
      </div>
    </div>
  )
}
