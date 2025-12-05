// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useRef, useState } from 'react'
import { useCall } from '@/context/CallContext'
import { CallScreen } from './CallScreen'

export function CallScreenWrapper() {
  const callContext = useCall()
  
  // États locaux qui ne changent que quand nécessaire
  const [localStreamState, setLocalStreamState] = useState<MediaStream | null>(null)
  const [remoteStreamState, setRemoteStreamState] = useState<MediaStream | null>(null)
  const renderCountRef = useRef(0)

  // Mettre à jour localStream seulement quand il change vraiment
  useEffect(() => {
    if (callContext.localStream !== localStreamState) {
      console.log('🎥 Local stream changed')
      setLocalStreamState(callContext.localStream)
    }
  }, [callContext.localStream])

  // Mettre à jour remoteStream seulement quand il change vraiment
  useEffect(() => {
    if (callContext.remoteStream !== remoteStreamState) {
      console.log('🎥 Remote stream changed')
      setRemoteStreamState(callContext.remoteStream)
    }
  }, [callContext.remoteStream])

  // N'afficher que si un appel est actif
  if (!callContext.isInCall && !callContext.isRinging && !callContext.isCalling) {
    return null
  }

  renderCountRef.current++
  console.log(`📹 CallScreenWrapper render #${renderCountRef.current}`)

  const callerName = callContext.incomingCall?.callerName || 'Utilisateur'
  const callerAvatar = callContext.incomingCall?.callerAvatar
  const isVideoCall =
    callContext.incomingCall?.isVideo ||
    (localStreamState?.getVideoTracks().length ?? 0) > 0 ||
    (remoteStreamState?.getVideoTracks().length ?? 0) > 0

  return (
    <CallScreen
      isInCall={callContext.isInCall}
      isRinging={callContext.isRinging}
      isCalling={callContext.isCalling}
      localStream={localStreamState}
      remoteStream={remoteStreamState}
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
  )
}