import React from 'react'
import { ArrowLeft, CheckCheck, Trash2, UserPlus, Search, Phone, Video, PhoneIncoming, PhoneOutgoing, PhoneMissed, Users, Check, Star, MessageCircle } from 'lucide-react'
import { formatCallDuration, formatCallDate } from './CallsPage'

// CallLog type from CallsPage
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
  caller_profile?: any
  callee_profile?: any
  is_group_call?: boolean
  conversation_name?: string
  conversation_avatar?: string
}

// Helper to get display name and avatar
const getCallDisplayInfo = (call: any, user: any) => {
  const isGroupCall = call.is_group_call
  const isOutgoing = call.caller_id === user?.id
  
  let displayName: string
  let avatarUrl: string | null | undefined

  if (isGroupCall) {
    displayName = call.conversation_name || 'Groupe'
    avatarUrl = call.conversation_avatar
  } else {
    const otherProfile = isOutgoing ? call.callee_profile : call.caller_profile
    displayName = otherProfile?.display_name || otherProfile?.username || 'Utilisateur'
    avatarUrl = otherProfile?.avatar_url
  }
  
  return { displayName, avatarUrl, isGroupCall, isOutgoing }
}

// Helper to check call status
const getCallStatus = (call: any) => {
  const isMissed = call.status === 'missed' || call.status === 'rejected'
  const isAnswered = call.status === 'answered' || call.status === 'ended'
  return { isMissed, isAnswered }
}

// Helper to render avatar
const renderCallAvatar = (avatarUrl: string | null | undefined, isGroupCall: boolean, displayName: string) => {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={displayName}
        className="w-12 h-12 rounded-full object-cover flex-shrink-0"
      />
    )
  }
  if (isGroupCall) {
    return (
      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent to-primary-600 flex items-center justify-center text-white flex-shrink-0">
        <Users size={24} />
      </div>
    )
  }
  return (
    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold text-lg flex-shrink-0">
      {displayName[0]?.toUpperCase()}
    </div>
  )
}

// Helper to render status icon
const renderStatusIcon = (isMissed: boolean, isOutgoing: boolean) => {
  if (isMissed) {
    return <PhoneMissed size={14} className="text-[#ea4335]" />
  }
  if (isOutgoing) {
    return <PhoneOutgoing size={14} />
  }
  return <PhoneIncoming size={14} />
}

// Helper to get status text
const getStatusText = (call: any, isMissed: boolean, isAnswered: boolean): string => {
  if (isMissed) return 'Manqué'
  if (isAnswered && call.duration) return formatCallDuration(call.duration)
  return 'Non répondu'
}

// Helper component for rendering a single call item
export const CallItem = ({
  call,
  user,
  isSelected,
  selectedCall,
  isSelectionMode,
  onClick,
  onContextMenu,
  onTouchStart,
  onTouchEnd,
  onTouchMove,
  isMobile
}: {
  call: any;
  user: any;
  isSelected: boolean;
  selectedCall: {
    id: string;
    conversation_id: string;
    caller_id: string;
    callee_id: string | null;
    type: 'audio' | 'video';
    status: 'initiated' | 'answered' | 'missed' | 'rejected' | 'ended';
    started_at: string;
    ended_at: string | null;
    duration: number | null;
  } | null;
  isSelectionMode: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onTouchStart: () => void;
  onTouchEnd: () => void;
  onTouchMove: () => void;
  isMobile: boolean;
}) => {
  const { displayName, avatarUrl, isGroupCall, isOutgoing } = getCallDisplayInfo(call, user)
  const { isMissed, isAnswered } = getCallStatus(call)
  
  const getContainerClass = () => {
    if (isSelected) {
      return 'bg-accent/20'
    }
    if (selectedCall?.id === call.id) {
      return 'bg-bg-surface'
    }
    return 'hover:bg-bg-surface'
  }
  
  const containerClass = getContainerClass()

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isMobile && e.button === 0) {
      onTouchStart()
    }
  }

  return (
    <button
      type="button"
      className={`w-full px-4 py-3 transition-colors cursor-pointer text-left ${containerClass}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick();
        }
      }}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchMove}
      onMouseDown={handleMouseDown}
      onMouseUp={onTouchEnd}
      onMouseLeave={onTouchEnd}
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
        
        {renderCallAvatar(avatarUrl, isGroupCall, displayName)}
        
        <div className="flex-1 min-w-0 border-b border-bg-hover pb-3">
          <div className="flex items-center gap-2 mb-1">
            {isGroupCall && <Users size={14} className="text-text-secondary flex-shrink-0" />}
            <h3 className={`truncate ${isMissed ? 'text-[#ea4335]' : 'text-text-primary'}`}>
              {displayName}
            </h3>
          </div>
          
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            {renderStatusIcon(isMissed, isOutgoing)}
            
            {call.type === 'video' && <Video size={14} />}
            
            {isGroupCall && <span className="text-xs">Groupe</span>}
            
            <span>
              {getStatusText(call, isMissed, isAnswered)}
            </span>
          </div>
        </div>

        <div className="text-xs text-text-secondary flex-shrink-0">
          {formatCallDate(call.started_at)}
        </div>
      </div>
    </button>
  )
}

export const CallsSelectionHeader = ({
  selectedCount,
  allCallsSelected,
  exitSelectionMode,
  selectAllCalls,
  handleBulkDelete
}: {
  selectedCount: number;
  allCallsSelected: boolean;
  exitSelectionMode: () => void;
  selectAllCalls: () => void;
  handleBulkDelete: () => void;
}) => (
  <div className="fixed top-0 left-0 right-0 z-50 bg-bg-surface border-b border-bg-hover shadow-lg animate-in slide-in-from-top duration-200">
    <div className="flex items-center justify-between h-14 px-2">
      {/* Left side: Back arrow + count */}
      <div className="flex items-center gap-3">
        <button
          onClick={(e) => {
            e.stopPropagation()
            exitSelectionMode()
          }}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
        >
          <ArrowLeft size={24} className="text-text-primary" />
        </button>
        <span className="text-lg font-medium text-text-primary">
          {selectedCount}
        </span>
      </div>
      
      {/* Right side: Select All + Delete icons */}
      <div className="flex items-center gap-1">
        {/* Select All */}
        <button
          onClick={selectAllCalls}
          className={`w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors ${
            allCallsSelected ? 'text-accent' : 'text-text-primary'
          }`}
          title={allCallsSelected ? 'Tout sélectionné' : 'Tout sélectionner'}
        >
          <CheckCheck size={20} />
        </button>
        
        {/* Delete */}
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

export const CallsHeader = ({
  searchQuery,
  setSearchQuery,
  handleAddContact
}: {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  handleAddContact: () => void;
}) => (
  <div className="bg-bg-surface px-4 py-3">
    <div className="flex items-center justify-between mb-4">
      <h1 className="text-xl font-semibold text-text-primary">Appels</h1>
      <button
        onClick={handleAddContact}
        className="w-10 h-10 rounded-full bg-accent hover:bg-[#5a5ec9] flex items-center justify-center transition-colors"
        title="Ajouter un contact"
      >
        <UserPlus size={20} className="text-white" />
      </button>
    </div>
    
    <div className="relative">
      <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
      <input
        type="text"
        placeholder="Rechercher ou démarrer un appel"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full h-9 pl-10 pr-3 bg-bg-surface text-text-primary text-sm rounded-xl border-none outline-none placeholder:text-text-secondary focus:bg-bg-hover"
      />
    </div>
  </div>
)

export const CallsList = ({
  loading,
  filteredCalls,
  selectedCalls,
  selectedCall,
  isSelectionMode,
  handleCallClick,
  handleCallContextMenu,
  handleTouchStart,
  handleTouchEnd,
  handleTouchMove,
  isMobile,
  user
}: {
  loading: boolean;
  filteredCalls: CallLog[];
  selectedCalls: Set<string>;
  selectedCall: CallLog | null;
  isSelectionMode: boolean;
  handleCallClick: (call: CallLog) => void;
  handleCallContextMenu: (e: React.MouseEvent, call: CallLog) => void;
  handleTouchStart: (callId: string) => void;
  handleTouchEnd: () => void;
  handleTouchMove: () => void;
  isMobile: boolean;
  user: any;
}) => (
  <div className="flex-1 overflow-y-auto pb-2">
    {(() => {
      if (loading) {
        return (
          <div className="flex justify-center items-center h-full">
            <div className="w-8 h-8 rounded-full border-4 border-accent border-t-transparent animate-spin" />
          </div>
        )
      }
      if (filteredCalls.length === 0) {
        return (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <Phone size={64} className="text-[#3b4a54] mb-4" />
            <h3 className="text-lg font-medium text-text-secondary mb-2">Aucun appel</h3>
            <p className="text-sm text-text-secondary">Votre historique d'appels apparaîtra ici</p>
          </div>
        )
      }
      return (
        filteredCalls.map((call) => {
          const isSelected = selectedCalls.has(call.id)
          
          return (
            <CallItem
              key={call.id}
              call={call}
              user={user}
              isSelected={isSelected}
              selectedCall={selectedCall}
              isSelectionMode={isSelectionMode}
              onClick={() => handleCallClick(call)}
              onContextMenu={(e) => handleCallContextMenu(e, call)}
              onTouchStart={() => handleTouchStart(call.id)}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
              isMobile={isMobile}
            />
          )
        })
      )
    })()}
  </div>
)

export const CallContextMenu = ({
  contextMenuCall,
  contextMenuPosition,
  handleCloseContextMenu,
  enterSelectionMode,
  handleDeleteCall,
  handleCallFromContextMenu
}: {
  contextMenuCall: CallLog | null;
  contextMenuPosition: { x: number; y: number } | null;
  handleCloseContextMenu: () => void;
  enterSelectionMode: (callId: string) => void;
  handleDeleteCall: (callId: string) => void;
  handleCallFromContextMenu: (isVideo: boolean) => void;
}) => {
  if (!contextMenuCall || !contextMenuPosition) return null;

  return (
    <>
      {/* Overlay pour fermer le menu */}
      <div
        className="fixed inset-0 z-40"
        onClick={handleCloseContextMenu}
        onKeyDown={(e) => e.stopPropagation()}
        aria-hidden="true"
      />
      
      {/* Menu contextuel */}
      <div
        className="fixed z-50 bg-bg-hover rounded-lg shadow-xl py-2 min-w-[200px]"
        style={{
          left: `${contextMenuPosition.x}px`,
          top: `${contextMenuPosition.y}px`,
        }}
      >
        {/* Option Sélectionner */}
        <button
          onClick={() => {
            enterSelectionMode(contextMenuCall.id)
          }}
          className="w-full px-4 py-3 text-left hover:bg-bg-surface flex items-center gap-3 text-text-primary transition-colors"
        >
          <Check size={20} />
          <span>Sélectionner</span>
        </button>
        
        {/* Séparateur */}
        <div className="h-px bg-bg-surface my-1" />
        
        {/* Option Effacer */}
        <button
          onClick={() => handleDeleteCall(contextMenuCall.id)}
          className="w-full px-4 py-3 text-left hover:bg-bg-surface flex items-center gap-3 text-text-primary transition-colors"
        >
          <Trash2 size={20} />
          <span>Effacer</span>
        </button>
        
        {/* Séparateur */}
        <div className="h-px bg-bg-surface my-1" />
        
        {/* Option Appel vocal */}
        <button
          onClick={() => handleCallFromContextMenu(false)}
          className="w-full px-4 py-3 text-left hover:bg-bg-surface flex items-center gap-3 text-text-primary transition-colors"
        >
          <Phone size={20} />
          <span>Appel vocal</span>
        </button>
        
        {/* Option Appel vidéo */}
        <button
          onClick={() => handleCallFromContextMenu(true)}
          className="w-full px-4 py-3 text-left hover:bg-bg-surface flex items-center gap-3 text-text-primary transition-colors"
        >
          <Video size={20} />
          <span>Appel vidéo</span>
        </button>
      </div>
    </>
  )
}

// CallDetailsContent component - extracted from CallsPage to avoid nested component definition
export interface CallDetailsContentProps {
  call: CallLog;
  userId: string | undefined;
  favorites: string[];
  navigate: (path: string) => void;
  setSelectedCall: (call: CallLog | null) => void;
  handleCallBack: (call: CallLog) => void;
  formatCallDuration: (seconds: number | null) => string;
  getCallDisplayName: (call: CallLog, userId: string | undefined) => string;
  getCallAvatarUrl: (call: CallLog, userId: string | undefined) => string | null | undefined;
  getCallStatusText: (call: CallLog, userId: string | undefined) => string;
  getCallTypeText: (call: CallLog) => string;
  renderCallStatus: (call: CallLog) => string;
  renderCallAvatar: (avatarUrl: string | null | undefined, isGroupCall: boolean, displayName: string) => React.ReactNode;
  isCallFavorite: (call: CallLog, userId: string | undefined, favs: string[]) => boolean;
  handleCallFavoriteToggle: (call: CallLog, userId: string | undefined) => void;
}

export const CallDetailsContent: React.FC<CallDetailsContentProps> = ({
  call,
  userId,
  favorites,
  navigate,
  setSelectedCall,
  handleCallBack,
  formatCallDuration,
  getCallDisplayName,
  getCallAvatarUrl,
  getCallStatusText,
  getCallTypeText,
  renderCallStatus,
  renderCallAvatar,
  isCallFavorite,
  handleCallFavoriteToggle
}) => {
  const isGroupCall = call.is_group_call
  
  const displayName = getCallDisplayName(call, userId)
  const avatarUrl = getCallAvatarUrl(call, userId)
  const isCallMissedOrRejected = call.status === 'missed' || call.status === 'rejected'
  const statusClass = isCallMissedOrRejected ? 'text-[#ea4335]' : 'text-primary-600 dark:text-primary-400'
  const isFavorite = isCallFavorite(call, userId, favorites)
  
  const handleFavoriteClick = () => {
    handleCallFavoriteToggle(call, userId)
  }
  
  return (
    <>
      {/* Contact Section */}
      <div className="bg-bg-hover rounded-2xl p-6">
        <div className="flex flex-col items-center gap-4">
          {renderCallAvatar(avatarUrl, isGroupCall, displayName)}
          <div className="text-center">
            <h3 className="text-lg font-medium text-text-primary mb-1 flex items-center justify-center gap-2">
              {isGroupCall && <Users size={18} className="text-text-secondary" />}
              {displayName}
            </h3>
            <p className="text-sm text-text-secondary">
              {getCallStatusText(call, userId)}
            </p>
          </div>
        </div>
      </div>

      {/* Details Section */}
      <div className="bg-bg-hover rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-text-secondary">Type</span>
          <div className="flex items-center gap-2">
            {isGroupCall && <Users size={16} className="text-accent" />}
            {call.type === 'video' ? <Video size={16} className="text-accent" /> : <Phone size={16} className="text-accent" />}
            <span className="text-gray-800 dark:text-white">
              {getCallTypeText(call)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-text-secondary">Date</span>
          <span className="text-gray-800 dark:text-white text-sm">{new Date(call.started_at).toLocaleString('fr-FR')}</span>
        </div>

        {call.duration !== null && (
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Durée</span>
            <span className="text-gray-800 dark:text-white">{formatCallDuration(call.duration)}</span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-text-secondary">Statut</span>
          <span className={statusClass}>
            {renderCallStatus(call)}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        {/* Favoris */}
        <button
          onClick={handleFavoriteClick}
          className="w-full py-3 rounded-xl bg-bg-hover hover:bg-bg-surface text-text-primary font-medium flex items-center justify-center gap-2"
        >
          <Star size={20} className={isFavorite ? 'fill-[#6b6fdb] text-accent' : ''} />
          {isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        </button>
        <button
          onClick={() => {
            navigate(`/chat/${call.conversation_id}`)
            setSelectedCall(null)
          }}
          className="w-full py-3 rounded-xl bg-accent hover:bg-[#5a5ec9] text-white font-medium flex items-center justify-center gap-2"
        >
          <MessageCircle size={20} />
          Ouvrir la conversation
        </button>
        {/* Rappeler */}
        <button
          onClick={() => handleCallBack(call)}
          className="w-full py-3 rounded-xl bg-bg-hover hover:bg-bg-surface text-text-primary font-medium flex items-center justify-center gap-2"
        >
          <Phone size={20} />
          Rappeler
        </button>
      </div>
    </>
  )
}
