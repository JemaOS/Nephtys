// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React from 'react'
import { Message, Profile } from '@/lib/supabase'
import { MessageReactions } from '@/components/MessageReactions'
import { MessageReply } from '@/components/MessageReply'
import { MessageHoverActions } from '@/components/MessageHoverActions'
import { LinkPreview } from '@/components/LinkPreview'
import { MediaMessage } from '@/components/MediaMessage'
import { VoiceMessage } from '@/components/VoiceMessage'
import { AudioFilePlayer } from '@/components/AudioFilePlayer'
import { CallMessage } from '@/components/CallMessage'
import { Smile, Reply, Forward, Star } from 'lucide-react'

// Utility function to detect emoji-only messages
const isEmojiOnly = (text: string): { isEmoji: boolean; emojiCount: number } => {
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

// Helper function to get sender info
const getSenderInfoForMessage = (
  senderId: string,
  userId: string | undefined,
  profile: Profile | null,
  otherUser: Profile | null,
  groupMemberProfiles: Map<string, Profile>,
  conversationType: string | undefined
): { name: string; avatar?: string } => {
  if (senderId === userId) {
    return {
      name: profile?.display_name || profile?.username || 'Vous',
      avatar: profile?.avatar_url
    }
  }
  
  if (conversationType === 'group') {
    const memberProfile = groupMemberProfiles.get(senderId)
    if (memberProfile) {
      return {
        name: memberProfile.display_name || memberProfile.username || 'Utilisateur',
        avatar: memberProfile.avatar_url
      }
    }
  }
  
  if (otherUser) {
    return {
      name: otherUser.display_name || otherUser.username || 'Utilisateur',
      avatar: otherUser.avatar_url
    }
  }
  
  return { name: 'Utilisateur', avatar: undefined }
}

// Helper to format time
const formatTime = (timestamp: string): string => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// Message type properties interface
interface MessageTypeProps {
  mediaUrl: string | false
  mediaType: string
  isGifMessage: boolean
  isStickerMessage: boolean
  isSystemMessage: boolean
  isEmojiOnlyMessage: boolean
  emojiCount: number
  isMediaMessage: boolean
  isDocumentMessage: boolean
}

// Helper function to determine message type properties - extracted to reduce complexity
const getMessageType = (message: Message): MessageTypeProps => {
  const mediaUrl = message.media_url || message.file_url || ''
  const mediaType = message.media_type || message.type
  
  // Check for GIF
  const gifMatch = message.type === 'text' && message.content && !mediaUrl
    ? message.content.match(/^(?:\[Transféré\]\s*)?([\s\S]*?)\[GIF\]\((https?:\/\/[^\)]+)\)$/)
    : null
  const isGifMessage = !!gifMatch
  
  // Check for sticker
  const stickerMatch = message.type === 'text' && message.content && !mediaUrl
    ? message.content.match(/^(?:\[Transféré\]\s*)?([\s\S]*?)\[STICKER\]\((https?:\/\/[^\)]+)\)$/)
    : null
  const isStickerMessage = !!stickerMatch
  
  // Check for system message
  const isSystemMessage = message.type === 'text' && message.content?.startsWith('[SYSTEM]')
  
  // Check for emoji-only
  let isEmojiOnlyMessage = false
  let emojiCount = 0
  if (message.type === 'text' && message.content && !mediaUrl) {
    const emojiCheck = isEmojiOnly(message.content)
    isEmojiOnlyMessage = emojiCheck.isEmoji
    emojiCount = emojiCheck.emojiCount
  }
  
  const isMediaMessage = mediaUrl && (mediaType === 'image' || mediaType === 'video') && message.type !== 'audio'
  const isDocumentMessage = mediaUrl && mediaType === 'file'
  
  return {
    mediaUrl: mediaUrl || false,
    mediaType,
    isGifMessage,
    isStickerMessage: isStickerMessage || isGifMessage,
    isSystemMessage,
    isEmojiOnlyMessage,
    emojiCount,
    isMediaMessage,
    isDocumentMessage
  }
}

// Props for MessageItem component
interface MessageItemProps {
  message: Message
  isOwn: boolean
  userId: string | undefined
  profile: Profile | null
  otherUser: Profile | null
  groupMemberProfiles: Map<string, Profile>
  conversationType: string | undefined
  otherUserDisplayName?: string
  reactions: any[]
  currentUserId: string
  onAddReaction: (messageId: string, emoji: string) => void
  onRemoveReaction: (messageId: string, emoji: string) => void
  onReply: (message: Message) => void
  onForward: (message: Message) => void
  onStar: (messageId: string) => void
  onPin: (messageId: string) => void
  onSelectMessage: (messageId: string) => void
  onScrollToMessage: (messageId: string) => void
  hoveredMessageId: string | null
  setHoveredMessageId: (id: string | null) => void
  isSelected: boolean
  isSelectionMode: boolean
  isMobile: boolean
  messages: Message[]
}

// Helper component for rendering message status icons
const MessageStatusIcons: React.FC<{ status?: string; isOwn: boolean }> = ({ status, isOwn }) => {
  if (!isOwn) return null
  
  if (status === 'sent') {
    return (
      <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
        <path d="M10.5 1L4.5 7L2 4.5" stroke="#8696a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  }
  if (status === 'delivered') {
    return (
      <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
        <path d="M1.5 5.5L4.5 8.5L10.5 2.5" stroke="#8696a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5.5 5.5L8.5 8.5L14.5 2.5" stroke="#8696a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  }
  if (status === 'read') {
    return (
      <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
        <path d="M1.5 5.5L4.5 8.5L10.5 2.5" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5.5 5.5L8.5 8.5L14.5 2.5" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  }
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
      <path d="M10.5 1L4.5 7L2 4.5" stroke="#8696a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// Helper to render message content with link preview handling
const MessageContent: React.FC<{ message: Message; isOwn: boolean }> = ({ message, isOwn }) => {
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
      // Keep original content
    }
  }
  
  const hasLinkPreview = !!(message as any).link_preview
  
  return (
    <>
      {displayContent ? (
        <p className="text-sm whitespace-pre-wrap break-words">{displayContent}</p>
      ) : null}
      {hasLinkPreview && (() => {
        try {
          const previewData = typeof (message as any).link_preview === 'string'
            ? JSON.parse((message as any).link_preview)
            : (message as any).link_preview
          return (
            <LinkPreview preview={previewData} isInMessage={true} isOwn={isOwn} />
          )
        } catch {
          return null
        }
      })()}
    </>
  )
}

// Helper to render reply quote
const ReplyQuote: React.FC<{
  replyToId: string | null
  messages: Message[]
  userId: string | undefined
  otherUserDisplayName?: string
  onScrollToMessage: (messageId: string) => void
}> = ({ replyToId, messages, userId, otherUserDisplayName, onScrollToMessage }) => {
  if (!replyToId) return null
  
  const replyMessage = messages.find(m => m.id === replyToId)
  if (!replyMessage) return null
  
  const replySenderName = replyMessage.sender_id === userId
    ? 'Vous'
    : otherUserDisplayName || 'Utilisateur'
  
  return (
    <div onClick={(e) => { e.stopPropagation(); onScrollToMessage(replyMessage.id); }}>
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

// Quick actions component - extracted to reduce complexity
const MessageQuickActions: React.FC<{
  position: 'left' | 'right'
  isOwn: boolean
  isHovered: boolean
  isSelectionMode: boolean
  messageId: string
  onReply: (message: Message) => void
  onForward: (message: Message) => void
}> = ({ position, isOwn, isHovered, isSelectionMode, messageId, onReply, onForward }) => {
  const showOnLeft = isOwn && position === 'left'
  const showOnRight = !isOwn && position === 'right'
  
  if (!isHovered || isSelectionMode) return null
  if (position === 'left' && !showOnLeft) return null
  if (position === 'right' && !showOnRight) return null
  
  return (
    <div className={`flex items-center gap-0.5 md:gap-1 ${position === 'left' ? 'mr-1 md:mr-2' : 'ml-1 md:ml-2 pb-4'}`}>
      <button
        onClick={() => onReply({ id: messageId } as Message)}
        className="md:hidden w-8 h-8 rounded-full bg-[#3b4a54] hover:bg-[#4a5c68] flex items-center justify-center transition-colors shadow-md"
        title="Répondre"
      >
        <Reply size={16} className="text-[#8696a0]" />
      </button>
      <button
        onClick={() => onForward({ id: messageId } as Message)}
        className="hidden md:flex w-8 h-8 rounded-full bg-[#3b4a54] hover:bg-[#4a5c68] items-center justify-center transition-colors shadow-md"
        title="Transférer"
      >
        <Forward size={16} className="text-[#8696a0]" />
      </button>
      <button
        className="hidden md:flex w-8 h-8 rounded-full bg-[#3b4a54] hover:bg-[#4a5c68] items-center justify-center transition-colors shadow-md"
        title="Réagir"
      >
        <Smile size={16} className="text-[#8696a0]" />
      </button>
      <button
        onClick={() => onReply({ id: messageId } as Message)}
        className="hidden md:flex w-8 h-8 rounded-full bg-[#3b4a54] hover:bg-[#4a5c68] items-center justify-center transition-colors shadow-md"
        title="Répondre"
      >
        <Reply size={16} className="text-[#8696a0]" />
      </button>
    </div>
  )
}

// Selection checkbox component - extracted to reduce complexity
const MessageSelectionCheckbox: React.FC<{
  isOwn: boolean
  isSelected: boolean
  isSelectionMode: boolean
  messageId: string
  onSelectMessage: (messageId: string) => void
}> = ({ isOwn, isSelected, isSelectionMode, messageId, onSelectMessage }) => {
  if (!isSelectionMode) return null
  
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onSelectMessage(messageId);
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
  )
}

// Timestamp component - extracted to reduce complexity
const MessageTimestamp: React.FC<{
  message: Message
  isOwn: boolean
  mediaUrl: string | false
  mediaType: string
}> = ({ message, isOwn, mediaUrl, mediaType }) => {
  const showInBubble = !(mediaUrl && (mediaType === 'image' || mediaType === 'video') && message.type !== 'audio')
  if (!showInBubble) return null
  
  return (
    <div className={`flex items-center justify-end gap-1 mt-1 text-xs ${isOwn ? 'text-[#2d2f6e]' : 'text-text-secondary'}`}>
      {message.is_starred && (
        <Star size={12} className="fill-current" />
      )}
      <span>{formatTime(message.created_at)}</span>
      <MessageStatusIcons status={message.status} isOwn={isOwn} />
    </div>
  )
}

// Main MessageItem component
export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  isOwn,
  userId,
  profile,
  otherUser,
  groupMemberProfiles,
  conversationType,
  otherUserDisplayName,
  reactions,
  currentUserId,
  onAddReaction,
  onRemoveReaction,
  onReply,
  onForward,
  onStar,
  onPin,
  onSelectMessage,
  onScrollToMessage,
  hoveredMessageId,
  setHoveredMessageId,
  isSelected,
  isSelectionMode,
  isMobile,
  messages
}) => {
  // Extract all message type properties at once - reduces cognitive complexity
  const msgType = getMessageType(message)
  const messageReactions = reactions.filter(r => r.message_id === message.id)
  const systemMessageContent = msgType.isSystemMessage ? message.content.replace('[SYSTEM]', '') : ''
  
  const senderInfo = getSenderInfoForMessage(
    message.sender_id,
    userId,
    profile,
    otherUser,
    groupMemberProfiles,
    conversationType
  )
  
  // Quick action handlers
  const handleReply = () => onReply(message)
  const handleForward = () => onForward(message)
  
  // Check if message is hovered
  const isHovered = hoveredMessageId === message.id && !isSelectionMode
  
  // Handle click for selection mode
  const handleClick = () => {
    if (isSelectionMode) {
      onSelectMessage(message.id)
    }
  }
  
  // System message rendering
  if (msgType.isSystemMessage) {
    return (
      <div
        id={`message-${message.id}`}
        className="flex justify-center my-4 px-4"
      >
        <div className="relative bg-white/10 dark:bg-white/5 backdrop-blur-xl px-5 py-3 rounded-2xl max-w-[85%] sm:max-w-[70%] text-center border border-white/20 dark:border-white/10 shadow-lg">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-accent/10 to-transparent pointer-events-none" />
          <div className="flex justify-center mb-2">
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
          </div>
          <p className="text-xs sm:text-sm text-text-secondary leading-relaxed relative z-10">
            {systemMessageContent}
          </p>
        </div>
      </div>
    )
  }
  
  // Emoji-only message rendering
  if (msgType.isEmojiOnlyMessage) {
    return (
      <div
        id={`message-${message.id}`}
        className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-1 ${isSelected ? 'bg-[#787add]/10' : ''} transition-colors duration-500`}
        onMouseEnter={() => setHoveredMessageId(message.id)}
        onMouseLeave={() => setHoveredMessageId(null)}
        onClick={handleClick}
      >
        <MessageQuickActions position="left" isOwn={isOwn} isHovered={isHovered} isSelectionMode={isSelectionMode} messageId={message.id} onReply={handleReply} onForward={handleForward} />
        <div className="max-w-[85%] sm:max-w-[75%] md:max-w-[70%] lg:max-w-[65%] relative group">
          <MessageHoverActions
            isVisible={hoveredMessageId === message.id}
            isOwn={isOwn}
            onOpenMenu={() => {}}
          />
          <div className={`${
            msgType.emojiCount === 1 ? 'text-7xl' : msgType.emojiCount === 2 ? 'text-6xl' : 'text-5xl'
          } leading-none py-1`}>
            {message.content}
          </div>
          <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mt-1`}>
            <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs ${
              isOwn ? 'bg-[#787add]/80' : 'bg-bg-surface/80'
            }`}>
              {message.is_starred && (
                <Star size={10} className="fill-current text-text-secondary" />
              )}
              <span className="text-text-secondary">{formatTime(message.created_at)}</span>
              <MessageStatusIcons status={message.status} isOwn={isOwn} />
            </div>
          </div>
        </div>
        <MessageSelectionCheckbox isOwn={isOwn} isSelected={isSelected} isSelectionMode={isSelectionMode} messageId={message.id} onSelectMessage={onSelectMessage} />
        {messageReactions.length > 0 && (
          <MessageReactions reactions={messageReactions} currentUserId={currentUserId} onReactionClick={onAddReaction} onReactionRemove={onRemoveReaction} />
        )}
      </div>
    )
  }
  
  // Media message rendering
  if (msgType.isMediaMessage) {
    return (
      <div
        id={`message-${message.id}`}
        className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-1 ${isSelected ? 'bg-[#787add]/10' : ''} transition-colors duration-500`}
        onMouseEnter={() => setHoveredMessageId(message.id)}
        onMouseLeave={() => setHoveredMessageId(null)}
        onClick={handleClick}
      >
        <MessageQuickActions position="left" isOwn={isOwn} isHovered={isHovered} isSelectionMode={isSelectionMode} messageId={message.id} onReply={handleReply} onForward={handleForward} />
        <div className="max-w-[85%] sm:max-w-[75%] md:max-w-[70%] lg:max-w-[65%] relative">
          <MediaMessage
            url={msgType.mediaUrl as string}
            type={msgType.mediaType as 'image' | 'video' | 'file'}
            fileName={message.file_name}
            fileSize={message.file_size}
            caption={message.content}
            width={message.media_width ?? undefined}
            height={message.media_height ?? undefined}
            thumbnail={message.media_thumbnail ?? undefined}
            senderName={senderInfo.name}
            senderAvatar={senderInfo.avatar}
            timestamp={message.created_at}
            isOwn={isOwn}
            isStarred={message.is_starred || false}
            messageId={message.id}
            status={message.status as 'sent' | 'delivered' | 'read' | undefined}
            onForward={() => onForward(message)}
            onStar={() => onStar(message.id)}
            onPin={() => onPin(message.id)}
            onReaction={(emoji) => onAddReaction(message.id, emoji)}
            showHoverActions={hoveredMessageId === message.id}
            onOpenMenu={() => {}}
            allMedia={[]}
            currentIndex={-1}
            onNavigate={() => {}}
          />
        </div>
        <MessageSelectionCheckbox isOwn={isOwn} isSelected={isSelected} isSelectionMode={isSelectionMode} messageId={message.id} onSelectMessage={onSelectMessage} />
        {messageReactions.length > 0 && (
          <MessageReactions reactions={messageReactions} currentUserId={currentUserId} onReactionClick={onAddReaction} onReactionRemove={onRemoveReaction} />
        )}
      </div>
    )
  }
  
  // Document message rendering
  if (msgType.isDocumentMessage) {
    return (
      <div
        id={`message-${message.id}`}
        className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-1 ${isSelected ? 'bg-[#787add]/10' : ''} transition-colors duration-500`}
        onMouseEnter={() => setHoveredMessageId(message.id)}
        onMouseLeave={() => setHoveredMessageId(null)}
        onClick={handleClick}
      >
        <MessageQuickActions position="left" isOwn={isOwn} isHovered={isHovered} isSelectionMode={isSelectionMode} messageId={message.id} onReply={handleReply} onForward={handleForward} />
        <div className="max-w-[85%] sm:max-w-[75%] md:max-w-[70%] lg:max-w-[65%] relative">
          <MessageHoverActions
            isVisible={hoveredMessageId === message.id}
            isOwn={isOwn}
            onOpenMenu={() => {}}
          />
          <MediaMessage
            url={msgType.mediaUrl as string}
            type="file"
            fileName={message.file_name}
            fileSize={message.file_size}
            caption={message.content}
            thumbnail={message.media_thumbnail ?? undefined}
            senderName={senderInfo.name}
            timestamp={message.created_at}
            isOwn={isOwn}
            isStarred={message.is_starred || false}
            messageId={message.id}
            status={message.status as 'sent' | 'delivered' | 'read' | undefined}
            onForward={() => onForward(message)}
            onStar={() => onStar(message.id)}
            onPin={() => onPin(message.id)}
            onReaction={(emoji) => onAddReaction(message.id, emoji)}
            showHoverActions={hoveredMessageId === message.id}
            onOpenMenu={() => {}}
          />
        </div>
        <MessageSelectionCheckbox isOwn={isOwn} isSelected={isSelected} isSelectionMode={isSelectionMode} messageId={message.id} onSelectMessage={onSelectMessage} />
        {messageReactions.length > 0 && (
          <MessageReactions reactions={messageReactions} currentUserId={currentUserId} onReactionClick={onAddReaction} onReactionRemove={onRemoveReaction} />
        )}
      </div>
    )
  }
  
  // Regular text message
  return (
    <div
      id={`message-${message.id}`}
      className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-1 ${isSelected ? 'bg-[#787add]/10' : ''} transition-colors duration-500`}
      onMouseEnter={() => setHoveredMessageId(message.id)}
      onMouseLeave={() => setHoveredMessageId(null)}
      onClick={handleClick}
    >
      <MessageQuickActions position="left" isOwn={isOwn} isHovered={isHovered} isSelectionMode={isSelectionMode} messageId={message.id} onReply={handleReply} onForward={handleForward} />
      <div className={`max-w-[85%] sm:max-w-[75%] md:max-w-[70%] lg:max-w-[65%] relative px-3 py-2 rounded-2xl ${isOwn ? 'bg-[#787add] text-white rounded-br-none' : 'bg-bg-surface text-text-primary rounded-bl-none'}`}>
        <MessageHoverActions
          isVisible={hoveredMessageId === message.id}
          isOwn={isOwn}
          onOpenMenu={() => {}}
        />
        <ReplyQuote
          replyToId={message.reply_to_id}
          messages={messages}
          userId={userId}
          otherUserDisplayName={otherUserDisplayName}
          onScrollToMessage={onScrollToMessage}
        />
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
        {!(message.media_url || message.file_url) && message.content && (
          <MessageContent message={message} isOwn={isOwn} />
        )}
        <MessageTimestamp message={message} isOwn={isOwn} mediaUrl={msgType.mediaUrl} mediaType={msgType.mediaType} />
      </div>
      <MessageQuickActions position="right" isOwn={isOwn} isHovered={isHovered} isSelectionMode={isSelectionMode} messageId={message.id} onReply={handleReply} onForward={handleForward} />
      <MessageSelectionCheckbox isOwn={isOwn} isSelected={isSelected} isSelectionMode={isSelectionMode} messageId={message.id} onSelectMessage={onSelectMessage} />
      {messageReactions.length > 0 && (
        <MessageReactions reactions={messageReactions} currentUserId={currentUserId} onReactionClick={onAddReaction} onReactionRemove={onRemoveReaction} />
      )}
    </div>
  )
}

export default MessageItem
