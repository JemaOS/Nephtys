// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React from 'react'
import { Message, Profile } from '@/lib/supabase'
import { MessageReactions } from '@/components/MessageReactions'
import { MessageHoverActions } from '@/components/MessageHoverActions'
import { MediaMessage } from '@/components/MediaMessage'
import { VoiceMessage } from '@/components/VoiceMessage'
import { AudioFilePlayer } from '@/components/AudioFilePlayer'
import { Star } from 'lucide-react'
import {
  MessageStatusIcons,
  MessageContent,
  ReplyQuote,
  MessageQuickActions,
  MessageSelectionCheckbox,
  MessageTimestamp,
  formatTime
} from './MessageItemComponents'

// Pre-compiled regex patterns for better performance
// Emoji pattern using Unicode properties - this is the correct way to detect emojis in JS
const EMOJI_PATTERN = String.raw`(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F?|\p{Regional_Indicator}{2}|[\u0023\u002A\u0030-\u0039]\uFE0F?\u20E3)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F?))*(?:\p{Emoji_Modifier})?`;
const EMOJI_REGEX = new RegExp(EMOJI_PATTERN, 'gu');

// Prefix pattern for transferred messages
const TRANSFERRED_PREFIX_PATTERN = /^(?:\[Transféré\]\s*)?/

// Utility function to detect emoji-only messages
const isEmojiOnly = (text: string): { isEmoji: boolean; emojiCount: number } => {
  if (!text || text.trim() === '') return { isEmoji: false, emojiCount: 0 }
  
  // Limit length to avoid ReDoS on long strings
  if (text.length > 100) return { isEmoji: false, emojiCount: 0 }
  
  const trimmed = text.trim()
  
  const emojis = EMOJI_REGEX.exec(trimmed)
  if (!emojis) return { isEmoji: false, emojiCount: 0 }
  
  const emojiString = emojis.join('')
  const textWithoutWhitespace = trimmed.replaceAll(/\s/g, '')
  
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

// Helper function to get emoji size class based on count
const getEmojiSizeClass = (emojiCount: number): string => {
  if (emojiCount === 1) return 'text-7xl';
  if (emojiCount === 2) return 'text-6xl';
  return 'text-5xl';
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

// Helper to parse special messages (GIF, Sticker) safely to avoid ReDoS
const parseSpecialMessage = (content: string, tag: string): RegExpMatchArray | null => {
  // Safe parsing to avoid ReDoS
  // Format: [Optional Prefix] [Content] [TAG](URL)
  
  // 1. Check if it ends with the tag
  // We use a simple regex anchored at the end
  const suffixRegex = new RegExp(String.raw`\[${tag}\]\((https?:\/\/[^\)]+)\)$`)
  const match = suffixRegex.exec(content)
  
  if (!match) return null
  
  // Ensure it's at the very end
  if (!content.endsWith(match[0])) return null
  
  const url = match[1]
  const beforeTag = content.substring(0, content.length - match[0].length)
  
  // 2. Handle prefix
  const prefixRegex = /^(?:\[Transféré\]\s*)?/
  const prefixMatch = prefixRegex.exec(beforeTag)
  const prefix = prefixMatch ? prefixMatch[0] : ''
  
  const realContent = beforeTag.substring(prefix.length)
  
  // Return in the format expected by the component: [fullMatch, content, url]
  const result = [content, realContent, url] as RegExpMatchArray
  result.index = 0
  result.input = content
  return result
}

// Helper function to determine message type properties - extracted to reduce complexity
const getMessageType = (message: Message): MessageTypeProps => {
  const mediaUrl = message.media_url || message.file_url || ''
  const mediaType = message.media_type || message.type
  
  // Check for GIF
  const gifMatch = message.type === 'text' && message.content && !mediaUrl
    ? parseSpecialMessage(message.content, 'GIF')
    : null
  const isGifMessage = !!gifMatch
  
  // Check for sticker
  const stickerMatch = message.type === 'text' && message.content && !mediaUrl
    ? parseSpecialMessage(message.content, 'STICKER')
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

// Helper to render text/audio content - extracted to reduce complexity
const renderTextContent = (message: Message, isOwn: boolean, msgType: MessageTypeProps) => {
  return (
    <>
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
    </>
  )
}

// Main MessageItem component - wrapped with React.memo for performance
export const MessageItem: React.FC<MessageItemProps> = React.memo(({
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
  const systemMessageContent = msgType.isSystemMessage ? message.content.replaceAll('[SYSTEM]', '') : ''
  
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

  // Helper to render timestamp bubble
  const renderTimestampBubble = () => (
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
  )

  // Helper to render reactions
  const renderReactions = () => {
    if (messageReactions.length > 0) {
      return (
        <MessageReactions 
          reactions={messageReactions} 
          currentUserId={currentUserId} 
          onReactionClick={(emoji: string) => onAddReaction(message.id, emoji)} 
          onReactionRemove={(emoji: string) => onRemoveReaction(message.id, emoji)} 
        />
      )
    }
    return null
  }

  // Common wrapper for message bubbles (non-system, non-emoji)
  const renderBubbleWrapper = (content: React.ReactNode, showReplyQuote: boolean = false) => (
    <button
      type="button"
      className={`flex w-full text-left ${isOwn ? 'justify-end' : 'justify-start'} mb-1 ${isSelected ? 'bg-[#787add]/10' : ''} transition-colors duration-500 border-none bg-transparent p-0`}
      onClick={handleClick}
    >
      <MessageQuickActions position="left" isOwn={isOwn} isHovered={isHovered} isSelectionMode={isSelectionMode} messageId={message.id} onReply={handleReply} onForward={handleForward} />
      <div className={`max-w-[85%] sm:max-w-[75%] md:max-w-[70%] lg:max-w-[65%] relative group`}>
        <MessageHoverActions
          isVisible={hoveredMessageId === message.id}
          isOwn={isOwn}
          onOpenMenu={() => {}}
        />
        {showReplyQuote && (
          <ReplyQuote
            replyToId={message.reply_to_id}
            messages={messages}
            userId={userId}
            otherUserDisplayName={otherUserDisplayName}
            onScrollToMessage={onScrollToMessage}
          />
        )}
        {content}
      </div>
      <MessageSelectionCheckbox isOwn={isOwn} isSelected={isSelected} isSelectionMode={isSelectionMode} messageId={message.id} onSelectMessage={onSelectMessage} />
      {renderReactions()}
    </button>
  )

  // Render based on message type
  if (msgType.isSystemMessage) {
    return (
      <div id={`message-${message.id}`} className="flex justify-center my-4 px-4">
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

  if (msgType.isEmojiOnlyMessage) {
    const emojiSize = getEmojiSizeClass(msgType.emojiCount);
    return renderBubbleWrapper(
      <>
        <div className={`${emojiSize} leading-none py-1`}>
          {message.content}
        </div>
        {renderTimestampBubble()}
      </>
    )
  }

  if (msgType.isMediaMessage) {
    return renderBubbleWrapper(
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
    )
  }

  if (msgType.isDocumentMessage) {
    return renderBubbleWrapper(
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
    )
  }

  // Regular text/audio message
  const textContent = renderTextContent(message, isOwn, msgType)

  return (
    <button
      type="button"
      id={`message-${message.id}`}
      className={`flex w-full text-left ${isOwn ? 'justify-end' : 'justify-start'} mb-1 ${isSelected ? 'bg-[#787add]/10' : ''} transition-colors duration-500 border-none bg-transparent p-0`}
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
        {textContent}
      </div>
      <MessageQuickActions position="right" isOwn={isOwn} isHovered={isHovered} isSelectionMode={isSelectionMode} messageId={message.id} onReply={handleReply} onForward={handleForward} />
      <MessageSelectionCheckbox isOwn={isOwn} isSelected={isSelected} isSelectionMode={isSelectionMode} messageId={message.id} onSelectMessage={onSelectMessage} />
      {renderReactions()}
    </button>
  )
})

export default MessageItem
