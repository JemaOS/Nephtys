import { useCall } from '@/context/CallContext'
import { CallScreen } from './CallScreen'

export function GlobalCallScreen() {
  const {
    isInCall,
    isRinging,
    isCalling,
    localStream,
    remoteStream,
    audioEnabled,
    videoEnabled,
    incomingCall,
    answerCall,
    rejectCall,
    endCall,
    toggleAudio,
    toggleVideo,
  } = useCall()

  // N'afficher que si un appel est actif
  if (!isInCall && !isRinging && !isCalling) {
    return null
  }

  const callerName = incomingCall?.callerName || 'Utilisateur'
  const isVideoCall = incomingCall?.isVideo || localStream?.getVideoTracks().length > 0 || false

  return (
    <CallScreen
      isInCall={isInCall}
      isRinging={isRinging}
      isCalling={isCalling}
      localStream={localStream}
      remoteStream={remoteStream}
      audioEnabled={audioEnabled}
      videoEnabled={videoEnabled}
      callerName={callerName}
      isVideoCall={isVideoCall}
      onAnswer={answerCall}
      onReject={rejectCall}
      onEnd={endCall}
      onToggleAudio={toggleAudio}
      onToggleVideo={toggleVideo}
    />
  )
}