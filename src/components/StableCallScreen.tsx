import { useEffect, useRef } from 'react'
import { useCall } from '@/context/CallContext'
import { CallScreen } from './CallScreen'

export function StableCallScreen() {
  const callContext = useCall()
  const callScreenRef = useRef<HTMLDivElement>(null)

  // N'afficher que si un appel est actif
  if (!callContext.isInCall && !callContext.isRinging && !callContext.isCalling) {
    return null
  }

  const callerName = callContext.incomingCall?.callerName || 'Utilisateur'
  const callerAvatar = callContext.incomingCall?.callerAvatar
  const isVideoCall =
    callContext.incomingCall?.isVideo ||
    (callContext.localStream?.getVideoTracks().length ?? 0) > 0 ||
    (callContext.remoteStream?.getVideoTracks().length ?? 0) > 0

  console.log('📹 StableCallScreen render:', {
    isInCall: callContext.isInCall,
    isRinging: callContext.isRinging,
    isCalling: callContext.isCalling,
    callerName,
    callerAvatar,
    isVideoCall,
    hasLocalStream: !!callContext.localStream,
    hasRemoteStream: !!callContext.remoteStream,
    remoteStreamTracks: callContext.remoteStream?.getTracks().length
  })

  return (
    <div ref={callScreenRef}>
      <CallScreen
        isInCall={callContext.isInCall}
        isRinging={callContext.isRinging}
        isCalling={callContext.isCalling}
        localStream={callContext.localStream}
        remoteStream={callContext.remoteStream}
        audioEnabled={callContext.audioEnabled}
        videoEnabled={callContext.videoEnabled}
        callerName={callerName}
        callerAvatar={callerAvatar}
        isVideoCall={isVideoCall}
        onAnswer={callContext.answerCall}
        onReject={callContext.rejectCall}
        onEnd={callContext.endCall}
        onToggleAudio={callContext.toggleAudio}
        onToggleVideo={callContext.toggleVideo}
      />
    </div>
  )
}