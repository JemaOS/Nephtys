import { useCall } from '@/context/CallContext'
import { CallScreen } from './CallScreen'
import { useEffect, useState } from 'react'

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

  const [isVideoCall, setIsVideoCall] = useState(false)

  // Détecter si c'est un appel vidéo
  useEffect(() => {
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
    
    setIsVideoCall(hasVideo)
  }, [incomingCall?.isVideo, localStream, remoteStream])

  // N'afficher que si un appel est actif
  if (!isInCall && !isRinging && !isCalling) {
    return null
  }

  const callerName = incomingCall?.callerName || 'Utilisateur'

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
      isVideoCall={isVideoCall}
      onAnswer={answerCall}
      onReject={rejectCall}
      onEnd={endCall}
      onToggleAudio={toggleAudio}
      onToggleVideo={toggleVideo}
    />
  )
}