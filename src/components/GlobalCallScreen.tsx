import { useCall } from '@/context/CallContext'
import { CallScreen } from './CallScreen'
import { useMemo, memo } from 'react'

export const GlobalCallScreen = memo(function GlobalCallScreen() {
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

  // Mémoriser isVideoCall pour éviter les re-renders
  const isVideoCall = useMemo(() => {
    const hasVideo =
      incomingCall?.isVideo ||
      (localStream?.getVideoTracks().length ?? 0) > 0 ||
      (remoteStream?.getVideoTracks().length ?? 0) > 0
    
    console.log('📹 GlobalCallScreen: Detecting video call:', {
      incomingCallIsVideo: incomingCall?.isVideo,
      localVideoTracks: localStream?.getVideoTracks().length,
      remoteVideoTracks: remoteStream?.getVideoTracks().length,
      result: hasVideo
    })
    
    return hasVideo
  }, [incomingCall?.isVideo, localStream, remoteStream])

  // N'afficher que si un appel est actif
  if (!isInCall && !isRinging && !isCalling) {
    return null
  }

  const callerName = incomingCall?.callerName || 'Utilisateur'
  const callerAvatar = incomingCall?.callerAvatar

  console.log('📹 GlobalCallScreen render:', {
    isInCall,
    isRinging,
    isCalling,
    callerName,
    isVideoCall,
    hasLocalStream: !!localStream,
    localStreamTracks: localStream?.getTracks().length,
    hasRemoteStream: !!remoteStream,
    remoteStreamTracks: remoteStream?.getTracks().length,
    remoteStreamId: remoteStream?.id
  })

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
      callerAvatar={callerAvatar}
      isVideoCall={isVideoCall}
      onAnswer={answerCall}
      onReject={rejectCall}
      onEnd={endCall}
      onToggleAudio={toggleAudio}
      onToggleVideo={toggleVideo}
    />
  )
})