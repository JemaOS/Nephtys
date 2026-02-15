// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { Phone, Video, PhoneIncoming, PhoneOutgoing, PhoneMissed, Users } from 'lucide-react'

interface CallMessageProps {
  type: 'audio' | 'video'
  status: 'initiated' | 'answered' | 'missed' | 'rejected' | 'ended'
  duration: number | null
  isOutgoing: boolean
  isGroupCall: boolean
  participantCount?: number
  timestamp: string
  isOwn: boolean
  onClick?: () => void
}

export function CallMessage({
  type,
  status,
  duration,
  isOutgoing,
  isGroupCall,
  participantCount,
  timestamp,
  isOwn,
  onClick
}: CallMessageProps) {
  const isMissed = status === 'missed' || status === 'rejected'
  const isAnswered = status === 'answered' || status === 'ended'
  
  // Format duration
  const formatDuration = (seconds: number | null) => {
    if (!seconds) return ''
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (mins > 0) {
      return secs > 0 ? `${mins} min ${secs} s` : `${mins} min`
    }
    return `${secs} s`
  }
  
  // Format time
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  }
  
  // Get call label
  const getCallLabel = () => {
    const callType = type === 'video' ? 'Appel vidéo' : 'Appel vocal'
    
    if (isGroupCall) {
      if (isMissed) {
        return isOutgoing ? `${callType} de groupe` : `${callType} de groupe manqué`
      }
      return `${callType} de groupe`
    }
    
    if (isMissed) {
      // Caller sees "Appel vocal/vidéo" (outgoing that wasn't answered)
      // Receiver sees "Appel manqué" (incoming that they missed)
      return isOutgoing ? callType : `${callType} manqué`
    }
    
    return callType
  }
  
  // Get status text for group calls
  const getGroupCallStatus = () => {
    if (!isGroupCall) return null
    
    if (isAnswered && duration) {
      // Call was answered and has duration
      if (participantCount && participantCount > 0) {
        return `Rejoint par ${participantCount} personne${participantCount > 1 ? 's' : ''}`
      }
      // If no participant count, just show that the call happened
      return 'Appel terminé'
    }
    
    if (isMissed) {
      // For group calls, show appropriate message
      return isOutgoing ? 'Aucune réponse' : 'Vous avez manqué cet appel'
    }
    
    // Call initiated but not answered yet
    return 'En attente'
  }
  
  // Get icon based on call state
  const getIcon = () => {
    const iconSize = 16
    const iconClass = isMissed ? 'text-red-500' : 'text-text-secondary'
    
    if (isGroupCall) {
      return <Users size={iconSize} className={iconClass} />
    }
    
    if (isMissed) {
      return <PhoneMissed size={iconSize} className="text-red-500" />
    }
    
    if (isOutgoing) {
      return <PhoneOutgoing size={iconSize} className={iconClass} />
    }
    
    return <PhoneIncoming size={iconSize} className={iconClass} />
  }
  
  // Get call type icon
  const getTypeIcon = () => {
    const iconSize = 14
    if (type === 'video') {
      return <Video size={iconSize} className="text-text-secondary" />
    }
    return <Phone size={iconSize} className="text-text-secondary" />
  }
  
  // Helper to get call status text
  const getCallStatusText = (): React.ReactNode => {
    if (isGroupCall) {
      return (
        <span className={isMissed && !isOutgoing ? 'text-red-400' : ''}>
          {getGroupCallStatus()}
        </span>
      );
    }
    
    if (isAnswered && duration) {
      return <span>{formatDuration(duration)}</span>;
    }
    
    if (isMissed) {
      return <span className="text-red-400">{isOutgoing ? 'Non abouti' : 'Appel manqué'}</span>;
    }
    
    return <span>{isOutgoing ? 'Non abouti' : 'Appel manqué'}</span>;
  };

  // Helper to get callback button icon
  const getCallbackIcon = () => {
    const iconClass = isMissed ? 'text-red-500' : 'text-accent';
    if (type === 'video') {
      return <Video size={16} className={iconClass} />;
    }
    return <Phone size={16} className={iconClass} />;
  };

  return (
    <div className="flex justify-center my-3 px-4">
      <div
        className={`
          relative flex items-center gap-3 px-4 py-3 rounded-2xl
          bg-bg-surface/80 backdrop-blur-sm
          border border-bg-hover
          shadow-sm
          max-w-[85%] sm:max-w-[70%]
          ${onClick ? 'cursor-pointer hover:bg-bg-surface transition-colors' : ''}
        `}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
        onClick={onClick}
      >
        {/* Call direction/status icon */}
        <div className={`
          w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0
          ${isMissed ? 'bg-red-500/10' : 'bg-accent/10'}
        `}>
          {getIcon()}
        </div>
        
        {/* Call info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {getTypeIcon()}
            <span className={`text-sm font-medium ${isMissed ? 'text-red-500' : 'text-text-primary'}`}>
              {getCallLabel()}
            </span>
          </div>
          
          <div className="flex items-center gap-2 mt-0.5 text-xs text-text-secondary">
            {/* Duration or status */}
            {getCallStatusText()}
            
            {/* Separator */}
            <span>·</span>
            
            {/* Time */}
            <span>{formatTime(timestamp)}</span>
            
            {/* Group call duration (if answered and has participants) */}
            {Boolean(isGroupCall && isAnswered && duration && participantCount && participantCount > 0) && (
              <>
                <span>·</span>
                <span>{formatDuration(duration)}</span>
              </>
            )}
          </div>
        </div>
        
        {/* Callback button */}
        {onClick && (
          <div className={`
            w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
            ${isMissed ? 'bg-red-500/10 hover:bg-red-500/20' : 'bg-accent/10 hover:bg-accent/20'}
            transition-colors
          `}>
            {getCallbackIcon()}
          </div>
        )}
      </div>
    </div>
  );
}