import React from 'react'
import { ArrowLeft, Pin, Volume2, VolumeX, Archive, Trash2, Plus, UserPlus, Users, MoreVertical, Check, Search, MessageCircle, BellOff } from 'lucide-react'
import { Conversation, Profile, Message } from '@/lib/supabase'

export interface ConversationWithDetails extends Omit<Conversation, 'is_pinned'> {
  otherUserProfile?: Profile
  lastMessage?: Message
  unreadCount?: number
  is_pinned?: boolean
  is_muted?: boolean
}

// Helper function to get platform display name for URLs
const getPlatformDisplayName = (hostname: string): string | null => {
  const map: Record<string, string> = {
    'youtube.com': '📹 youtube.com',
    'youtu.be': '📹 youtube.com',
    'instagram.com': '📷 instagram.com',
    'twitter.com': '🐦 x.com',
    'x.com': '🐦 x.com',
    'facebook.com': '📘 facebook.com',
    'fb.com': '📘 facebook.com',
    'tiktok.com': '🎵 tiktok.com',
    'spotify.com': '🎧 spotify.com',
    'linkedin.com': '💼 linkedin.com',
    'github.com': '💻 github.com'
  }

  for (const key in map) {
    if (hostname.includes(key)) return map[key]
  }
  return null
}

// Helper function to process URL and return display text
const processUrlDisplay = (url: string): string => {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.replaceAll('www.', '')
    const platformDisplay = getPlatformDisplayName(hostname)
    if (platformDisplay) return platformDisplay
    return `🔗 ${hostname}`
  } catch {
    return '🔗 Lien'
  }
}

// Helper function to extract GIF/Sticker caption
const extractMediaCaption = (content: string, mediaType: 'GIF' | 'STICKER'): string | null => {
  const regex = new RegExp(`^(?:[\\s\\S]*?\\n)?\\[${mediaType}\\]\\(https?:\\/\\/[^)]+\\)$`)
  const match = content.match(regex)
  if (!match) return null

  const captionRegex = new RegExp(`^([\\s\\S]*?)\\n\\[${mediaType}\\]`)
  const captionMatch = content.match(captionRegex)
  return captionMatch ? captionMatch[1].trim() : ''
}

// Helper function to get message preview text
const getTextPreview = (msg: Message): string => {
  const { content } = msg

  const gifCaption = extractMediaCaption(content, 'GIF')
  if (gifCaption !== null) {
    return gifCaption ? `GIF • ${gifCaption}` : 'GIF'
  }

  const stickerCaption = extractMediaCaption(content, 'STICKER')
  if (stickerCaption !== null) {
    return stickerCaption ? `Sticker • ${stickerCaption}` : 'Sticker'
  }

  const urlRegex = /https?:\/\/[^\s]+/gi
  const urls = content.match(urlRegex)
  if (urls && urls.length > 0) {
    return processUrlDisplay(urls[0])
  }

  return content
}

export const getLastMessagePreview = (lastMessage: Message | undefined): string => {
  if (!lastMessage) return 'Aucun message'

  const { type, content } = lastMessage

  if (type === 'text' && content) {
    return getTextPreview(lastMessage)
  }

  if (type === 'image') return '📷 Photo'
  if (type === 'video') return '🎬 Vidéo'
  if (type === 'audio') return '🎤 Message vocal'
  if (type === 'file') return `📎 ${lastMessage.file_name || 'Document'}`

  return content || '📎 Fichier'
}

// Helper to determine row background color
const getConversationRowClass = (isSelected: boolean, hasUnread: boolean): string => {
  if (isSelected) return 'bg-accent/20'
  if (hasUnread) return 'bg-bg-surface'
  return 'hover:bg-bg-surface'
}

export const ChatsSelectionHeader = ({
  selectedCount,
  exitSelectionMode,
  handleBulkPin,
  handleBulkMute,
  handleBulkArchive,
  handleBulkDelete,
  anySelectedPinned,
  anySelectedMuted
}: {
  selectedCount: number;
  exitSelectionMode: () => void;
  handleBulkPin: () => void;
  handleBulkMute: () => void;
  handleBulkArchive: () => void;
  handleBulkDelete: () => void;
  anySelectedPinned: boolean;
  anySelectedMuted: boolean;
}) => (
  <div
    className="fixed top-0 left-0 right-0 z-50 bg-bg-surface border-b border-bg-hover shadow-lg"
    style={{ willChange: 'transform' }}
  >
    <div className="flex items-center justify-between h-14 px-2">
      <div className="flex items-center gap-3">
        <button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            exitSelectionMode()
          }}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => {
            e.preventDefault()
            e.stopPropagation()
            exitSelectionMode()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              exitSelectionMode()
            }
          }}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover active:bg-bg-hover transition-colors touch-manipulation select-none"
          type="button"
          aria-label="Quitter le mode sélection"
        >
          <ArrowLeft size={24} className="text-text-primary" />
        </button>
        <span className="text-lg font-medium text-text-primary">
          {selectedCount}
        </span>
      </div>
      
      <div className="flex items-center gap-1">
        <button
          onClick={handleBulkPin}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
          title={anySelectedPinned ? 'Désépingler' : 'Épingler'}
        >
          <Pin size={20} className={anySelectedPinned ? 'text-accent' : 'text-text-primary'} />
        </button>
        
        <button
          onClick={handleBulkMute}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
          title={anySelectedMuted ? 'Réactiver le son' : 'Désactiver les notifications'}
        >
          {anySelectedMuted ? (
            <Volume2 size={20} className="text-text-primary" />
          ) : (
            <VolumeX size={20} className="text-text-primary" />
          )}
        </button>
        
        <button
          onClick={handleBulkArchive}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
          title="Archiver"
        >
          <Archive size={20} className="text-text-primary" />
        </button>
        
        <button
          onClick={handleBulkDelete}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
          title="Supprimer"
        >
          <Trash2 size={20} className="text-red-500" />
        </button>
      </div>
    </div>
  </div>
)

export const ChatsHeader = ({
  searchQuery,
  setSearchQuery,
  showNewMenu,
  setShowNewMenu,
  showFilterMenu,
  setShowFilterMenu,
  activeFilter,
  setActiveFilter,
  navigate
}: {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  showNewMenu: boolean;
  setShowNewMenu: (show: boolean) => void;
  showFilterMenu: boolean;
  setShowFilterMenu: (show: boolean) => void;
  activeFilter: 'all' | 'unread' | 'groups';
  setActiveFilter: (filter: 'all' | 'unread' | 'groups') => void;
  navigate: (path: string) => void;
}) => (
  <div className="bg-bg-surface p-4">
    <div className="flex items-center justify-between mb-4">
      <h1 className="text-xl font-semibold text-text-primary">Discussions</h1>
      <div className="flex gap-2">
        <div className="relative">
          <button
            onClick={() => setShowNewMenu(!showNewMenu)}
            className="w-10 h-10 rounded-full bg-accent hover:bg-[#5a5ec9] flex items-center justify-center transition-colors"
            title="Nouveau"
          >
            <Plus size={20} className="text-white" />
          </button>
          
          {showNewMenu && (
            <>
              <button
                className="fixed inset-0 z-40 bg-transparent border-none cursor-default"
                onClick={() => setShowNewMenu(false)}
                aria-label="Fermer le menu"
              />
              <div className="absolute right-0 top-12 z-50 min-w-[220px] bg-bg-surface rounded-2xl shadow-2xl py-2 border border-bg-hover">
                <button
                  onClick={() => { navigate('/contacts'); setShowNewMenu(false) }}
                  className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                >
                  <UserPlus size={18} />
                  <span>Nouveau contact</span>
                </button>
                <button
                  onClick={() => { navigate('/groups/new'); setShowNewMenu(false) }}
                  className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                >
                  <Users size={18} />
                  <span>Nouveau groupe</span>
                </button>
              </div>
            </>
          )}
        </div>
        <div className="relative">
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1]"
            title="Filtres"
          >
            <MoreVertical size={20} />
          </button>
          
          {showFilterMenu && (
            <>
              <button
                className="fixed inset-0 z-40 bg-transparent border-none cursor-default"
                onClick={() => setShowFilterMenu(false)}
                aria-label="Fermer le menu"
              />
              <div className="absolute right-0 top-12 z-50 min-w-[200px] bg-bg-surface rounded-2xl shadow-2xl py-2 border border-bg-hover">
                <button
                  onClick={() => { setActiveFilter('all'); setShowFilterMenu(false) }}
                  className="w-full px-4 py-2 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                >
                  {activeFilter === 'all' && <Check size={16} className="text-[#787add]" />}
                  <span className={activeFilter === 'all' ? 'ml-0' : 'ml-7'}>Toutes les discussions</span>
                </button>
                <button
                  onClick={() => { setActiveFilter('unread'); setShowFilterMenu(false) }}
                  className="w-full px-4 py-2 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                >
                  {activeFilter === 'unread' && <Check size={16} className="text-[#787add]" />}
                  <span className={activeFilter === 'unread' ? 'ml-0' : 'ml-7'}>Non lues</span>
                </button>
                <button
                  onClick={() => { setActiveFilter('groups'); setShowFilterMenu(false) }}
                  className="w-full px-4 py-2 text-left hover:bg-bg-hover transition-colors text-text-primary text-sm flex items-center gap-3"
                >
                  {activeFilter === 'groups' && <Check size={16} className="text-[#787add]" />}
                  <span className={activeFilter === 'groups' ? 'ml-0' : 'ml-7'}>Groupes</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    
    <div className="relative">
      <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
      <input
        type="text"
        placeholder="Rechercher ou démarrer une discussion"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full h-9 pl-10 pr-3 bg-bg-surface text-text-primary text-sm rounded-xl border-none outline-none placeholder:text-text-secondary focus:bg-bg-hover"
      />
    </div>
    
    <div className="flex gap-2 mt-3">
      <button
        onClick={() => setActiveFilter('all')}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
          activeFilter === 'all' ? 'bg-[#787add] text-white' : 'hover:bg-bg-hover text-text-secondary'
        }`}
      >
        Tous
      </button>
      <button
        onClick={() => setActiveFilter('unread')}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
          activeFilter === 'unread' ? 'bg-[#787add] text-white' : 'hover:bg-bg-hover text-text-secondary'
        }`}
      >
        Non lus
      </button>
      <button
        onClick={() => setActiveFilter('groups')}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
          activeFilter === 'groups' ? 'bg-[#787add] text-white' : 'hover:bg-bg-hover text-text-secondary'
        }`}
      >
        Groupes
      </button>
    </div>
  </div>
)

// Skeleton loader component for conversation items
export const ConversationSkeleton = () => (
  <div className="space-y-4 p-4">
    {[1, 2, 3, 4, 5].map((i) => (
      <div key={i} className="flex items-center gap-3 animate-pulse">
        <div className="w-12 h-12 rounded-full bg-bg-surface" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-bg-surface rounded w-1/3" />
          <div className="h-3 bg-bg-surface rounded w-2/3" />
        </div>
      </div>
    ))}
  </div>
)

// Helper to get display name
const getDisplayName = (conversation: ConversationWithDetails): string => {
  if (conversation.type === 'group') {
    return conversation.name || 'Groupe'
  }
  
  const isSavedMessagesConv = conversation.name === 'Messages enregistrés'
  if (isSavedMessagesConv) {
    return 'Moi'
  }
  
  return conversation.otherUserProfile?.display_name || conversation.otherUserProfile?.username || 'Utilisateur'
}

// Helper to render a single conversation item
// Helper to render a single conversation item in the list
const renderConversationItem = (
  conversation: ConversationWithDetails,
  selectedConversations: Set<string>,
  isSelectionMode: boolean,
  handleConversationClick: (id: string) => void,
  handleContextMenu: (e: React.MouseEvent, id: string) => void,
  formatDate: (date: string) => string
) => {
  const displayName = getDisplayName(conversation)
  const lastMessagePreview = getLastMessagePreview(conversation.lastMessage)
  const hasUnread = (conversation.unreadCount || 0) > 0
  const isSelected = selectedConversations.has(conversation.id)
  const rowClass = getConversationRowClass(isSelected, hasUnread)

  return (
    <ConversationItem
      key={conversation.id}
      conversation={conversation}
      displayName={displayName}
      lastMessagePreview={lastMessagePreview}
      hasUnread={hasUnread}
      isSelected={isSelected}
      isSelectionMode={isSelectionMode}
      selectedConversations={selectedConversations}
      handleConversationClick={handleConversationClick}
      handleContextMenu={handleContextMenu}
      formatDate={formatDate}
      rowClass={rowClass}
    />
  )
}

const ConversationItem = ({
  conversation,
  displayName,
  lastMessagePreview,
  hasUnread,
  isSelected,
  isSelectionMode,
  selectedConversations,
  handleConversationClick,
  handleContextMenu,
  formatDate,
  rowClass
}: {
  conversation: ConversationWithDetails;
  displayName: string;
  lastMessagePreview: string;
  hasUnread: boolean;
  isSelected: boolean;
  isSelectionMode: boolean;
  selectedConversations: Set<string>;
  handleConversationClick: (id: string) => void;
  handleContextMenu: (e: React.MouseEvent, id: string) => void;
  formatDate: (date: string) => string;
  rowClass: string;
}) => {
  return (
    <div
      className={`px-4 py-3 cursor-pointer transition-colors ${rowClass}`}
      onClick={() => handleConversationClick(conversation.id)}
      onContextMenu={(e) => {
        if (!isSelectionMode) {
          handleContextMenu(e, conversation.id)
        }
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleConversationClick(conversation.id)
        }
      }}
    >
      <div className="flex items-center gap-3">
        {isSelectionMode && (
          <div
            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
              isSelected
                ? 'bg-[#6063cf] border-[#6063cf]'
                : 'border-text-secondary'
            }`}
          >
            {isSelected && (
              <Check size={14} className="text-white" strokeWidth={3} />
            )}
          </div>
        )}
        
        <div className="relative">
          {conversation.type === 'direct' && conversation.otherUserProfile?.avatar_url ? (
            <img
              src={conversation.otherUserProfile.avatar_url}
              alt={displayName}
              className="w-12 h-12 rounded-full object-cover flex-shrink-0"
              key={conversation.otherUserProfile.avatar_url}
            />
          ) : conversation.avatar_url ? (
            <img
              src={conversation.avatar_url}
              alt={displayName}
              className="w-12 h-12 rounded-full object-cover flex-shrink-0"
              key={conversation.avatar_url}
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold text-lg flex-shrink-0">
              {displayName[0]?.toUpperCase()}
            </div>
          )}
          {!isSelectionMode && conversation.is_pinned && (
            <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
              <Pin size={12} className="text-white" />
            </div>
          )}
          {!isSelectionMode && conversation.is_muted && (
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#8696a0] flex items-center justify-center">
              <BellOff size={12} className="text-white" />
            </div>
          )}
        </div>
        
        <div className="flex-1 min-w-0 border-b border-bg-hover pb-3">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className={`truncate ${hasUnread ? 'text-white font-medium' : 'text-text-secondary'}`}>
              {displayName}
            </h3>
            {conversation.last_message_at && (
              <span className={`text-xs flex-shrink-0 ${hasUnread ? 'text-[#787add]' : 'text-text-secondary'}`}>
                {formatDate(conversation.last_message_at)}
              </span>
            )}
          </div>
          
          <div className="flex items-center justify-between gap-2">
            <p className={`text-sm truncate ${hasUnread ? 'text-text-secondary font-medium' : 'text-text-secondary'}`}>
              {lastMessagePreview}
            </p>
            {hasUnread && (
              <div className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#787add] flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-semibold text-text-primary">
                  {(conversation.unreadCount || 0) > 99 ? '99+' : conversation.unreadCount}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export const ChatsList = ({
  isLoading,
  filteredConversations,
  selectedConversations,
  isSelectionMode,
  handleConversationClick,
  handleContextMenu,
  handleTouchStart,
  handleTouchEnd,
  handleTouchMove,
  isMobile,
  formatDate
}: {
  isLoading: boolean;
  filteredConversations: ConversationWithDetails[];
  selectedConversations: Set<string>;
  isSelectionMode: boolean;
  handleConversationClick: (id: string) => void;
  handleContextMenu: (e: React.MouseEvent, id: string) => void;
  handleTouchStart: (id: string) => void;
  handleTouchEnd: () => void;
  handleTouchMove: () => void;
  isMobile: boolean;
  formatDate: (date: string) => string;
}) => (
  <div className="flex-1 overflow-y-auto pb-4">
    {isLoading ? (
      <ConversationSkeleton />
    ) : filteredConversations.length === 0 ? (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <MessageCircle size={64} className="text-[#3b4a54] mb-4" />
        <h3 className="text-lg font-medium text-text-secondary mb-2">Aucune conversation</h3>
        <p className="text-sm text-text-secondary">Commencez une nouvelle discussion</p>
      </div>
    ) : (
      filteredConversations.map((conversation) =>
        renderConversationItem(
          conversation,
          selectedConversations,
          isSelectionMode,
          handleConversationClick,
          handleContextMenu,
          formatDate
        )
      )
    )}
  </div>
)
