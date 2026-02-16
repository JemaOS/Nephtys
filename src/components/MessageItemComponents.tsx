import React from 'react'
import { Message } from '@/lib/supabase'
import { cleanLinkPreviewContent } from '@/lib/utils'
import { MessageReactions } from '@/components/MessageReactions'
import { MessageReply } from '@/components/MessageReply'
import { MessageHoverActions } from '@/components/MessageHoverActions'
import { LinkPreview } from '@/components/LinkPreview'
import { Reply, Forward, Smile, Star } from 'lucide-react'

// Helper to format time
export const formatTime = (timestamp: string): string => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// Helper component for rendering message status icons
export const MessageStatusIcons: React.FC<{ status?: string; isOwn: boolean }> = ({ status, isOwn }) => {
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
export const MessageContent: React.FC<{ message: Message; isOwn: boolean }> = ({ message, isOwn }) => {
  let displayContent = message.content
  
  if ((message as any).link_preview) {
    try {
      const previewData = typeof (message as any).link_preview === 'string'
        ? JSON.parse((message as any).link_preview)
        : (message as any).link_preview
      if (previewData.url) {
        displayContent = cleanLinkPreviewContent(message.content, previewData.url)
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
export const ReplyQuote: React.FC<{
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
    <div
      onClick={(e) => { e.stopPropagation(); onScrollToMessage(replyMessage.id); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation();
          onScrollToMessage(replyMessage.id);
        }
      }}
      role="button"
      tabIndex={0}
    >
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

// Quick actions component
export const MessageQuickActions: React.FC<{
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

// Selection checkbox component
export const MessageSelectionCheckbox: React.FC<{
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

// Timestamp component
export const MessageTimestamp: React.FC<{
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
