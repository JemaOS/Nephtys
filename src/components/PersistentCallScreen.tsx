// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useRef, useState, useCallback, RefObject } from 'react'
import { useCall } from '@/context/CallContext'
import { useAuth } from '@/context/AuthContext'
import { CallParticipantSelector } from './CallParticipantSelector'
import {
  CallDuration,
  ParticipantVideo,
  OneToOneCallUI,
  GroupCallUI
} from './PersistentCallScreenComponents'

export function PersistentCallScreen() {
  const { profile } = useAuth()
  const {
    isInCall,
    isRinging,
    isCalling,
    localStream,
    remoteStream,
    audioEnabled,
    videoEnabled,
    remoteVideoEnabled,
    incomingCall,
    answerCall,
    rejectCall,
    endCall,
    toggleAudio,
    toggleVideo,
    isGroupCall,
    groupParticipants,
    addParticipant,
  } = useCall()

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const [isSpeakerOn, setIsSpeakerOn] = useState(true)
  const [showAddParticipant, setShowAddParticipant] = useState(false)

  // Draggable self-view state
  const [pipPosition, setPipPosition] = useState<{ x: number; y: number }>(() => {
    if (typeof window !== 'undefined') {
      const width = window.innerWidth < 768 ? 112 : 144 // w-28 (112px) or md:w-36 (144px)
      return {
        x: window.innerWidth - width - 16, // right-4
        y: 80 // top-20
      }
    }
    return { x: 0, y: 0 }
  })
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const pipRef = useRef<HTMLDivElement>(null)

  // Helper: Get caller info - extracted to reduce complexity
  const getCallerInfo = useCallback(() => {
    return {
      name: incomingCall?.callerName || 'Utilisateur',
      avatar: incomingCall?.callerAvatar
    };
  }, [incomingCall?.callerName, incomingCall?.callerAvatar]);

  // Helper: Check if it's a video call - extracted
  const checkIsVideoCall = useCallback((): boolean => {
    return (
      incomingCall?.isVideo ||
      (localStream?.getVideoTracks().length ?? 0) > 0 ||
      (remoteStream?.getVideoTracks().length ?? 0) > 0
    );
  }, [incomingCall?.isVideo, localStream, remoteStream]);

  // Helper: Check if remote video should be displayed - extracted
  const checkHasRemoteVideo = useCallback((): boolean => {
    const isVideo = checkIsVideoCall();
    return isVideo &&
      remoteStream &&
      remoteStream.getVideoTracks().length > 0 &&
      remoteVideoEnabled;
  }, [checkIsVideoCall, remoteStream, remoteVideoEnabled]);

  // Helper: Handle drag start - extracted
  const handleDragStartCallback = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!pipRef.current) return
    
    setIsDragging(true)
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    
    setDragOffset({
      x: clientX - pipPosition.x,
      y: clientY - pipPosition.y,
    })
  }, [pipPosition])

  // Helper: Handle drag move - extracted
  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDragging) return
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    
    const width = window.innerWidth < 768 ? 112 : 144
    const height = window.innerWidth < 768 ? 160 : 208 // h-40 (160px) or md:h-52 (208px)
    const windowWidth = window.innerWidth
    const windowHeight = window.innerHeight
    
    // Calculate new position with bounds checking
    let newX = clientX - dragOffset.x
    let newY = clientY - dragOffset.y
    
    // Keep within screen bounds (with some padding)
    newX = Math.max(16, Math.min(windowWidth - width - 16, newX))
    newY = Math.max(16, Math.min(windowHeight - height - 100, newY)) // Bottom padding for controls
    
    setPipPosition({ x: newX, y: newY })
  }, [isDragging, dragOffset])

  // Helper: Handle drag end - extracted
  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Add/remove drag event listeners
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove)
      window.addEventListener('mouseup', handleDragEnd)
      window.addEventListener('touchmove', handleDragMove)
      window.addEventListener('touchend', handleDragEnd)
    }
    
    return () => {
      window.removeEventListener('mousemove', handleDragMove)
      window.removeEventListener('mouseup', handleDragEnd)
      window.removeEventListener('touchmove', handleDragMove)
      window.removeEventListener('touchend', handleDragEnd)
    }
  }, [isDragging, handleDragMove, handleDragEnd])

  // Handle local stream attachment - re-attach when stream changes or video is toggled
  useEffect(() => {
    if (localVideoRef.current && localStream && videoEnabled) {
      console.log('PersistentCallScreen: Attaching local stream to video element');
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(err => {
        console.warn('Local video play failed:', err);
      });
    }
  }, [localStream, isCalling, isInCall, videoEnabled])

  // Handle remote stream attachment
  // Re-attach when remoteStream changes OR when local videoEnabled changes (to ensure remote video stays attached)
  useEffect(() => {
    if (remoteStream) {
      console.log('PersistentCallScreen: Attaching remote stream', {
        audioTracks: remoteStream.getAudioTracks().length,
        videoTracks: remoteStream.getVideoTracks().length,
        videoEnabled,
        remoteVideoEnabled
      });

      // Ensure all tracks are enabled
      remoteStream.getTracks().forEach(track => {
        if (!track.enabled) {
          console.log(`PersistentCallScreen: Enabling ${track.kind} track`);
          track.enabled = true;
        }
      });
      
      if (remoteVideoRef.current) {
        // Always re-attach the stream to ensure video displays correctly
        remoteVideoRef.current.srcObject = remoteStream
        remoteVideoRef.current.play().catch(err => {
          console.warn('Video play failed:', err);
        });
      }
      
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream
        remoteAudioRef.current.volume = 1.0
        remoteAudioRef.current.play().catch(err => {
          console.warn('Audio play failed:', err);
        });
      }
    }
  }, [remoteStream, videoEnabled, remoteVideoEnabled])

  // Toggle speaker (simulated for now as setSinkId is experimental/limited)
  const toggleSpeaker = (...args: any[]) => {
    setIsSpeakerOn(!isSpeakerOn)
    // In a real implementation with supported browser, we would use:
    // const audio = remoteAudioRef.current as any
    // if (audio && audio.setSinkId) {
    //   audio.setSinkId(isSpeakerOn ? 'earpiece-id' : 'speaker-id')
    // }
  }

  if (!isInCall && !isRinging && !isCalling) {
    return null
  }

  const callerInfo = getCallerInfo();
  const callerName = callerInfo.name;
  const callerAvatar = callerInfo.avatar;
  const isVideoCall = checkIsVideoCall();

  // --- GROUP CALL UI ---
  if (isGroupCall && (isInCall || isCalling)) {
    const allParticipants = [
      {
        id: 'local',
        name: 'Vous',
        avatar: profile?.avatar_url || undefined,
        stream: localStream || undefined,
        audioEnabled,
        videoEnabled,
      },
      ...groupParticipants
    ]

    return (
      <GroupCallUI
        callerName={callerName}
        isInCall={isInCall}
        allParticipants={allParticipants}
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        toggleAudio={toggleAudio}
        toggleVideo={toggleVideo}
        endCall={endCall}
        showAddParticipant={showAddParticipant}
        setShowAddParticipant={setShowAddParticipant}
        addParticipant={(contactId) => {
          addParticipant(contactId)
          // Don't close the modal - let user add multiple participants
        }}
      />
    )
  }

  // --- 1-TO-1 CALL UI ---
  // Check if remote video should be displayed
  // We show video only if: it's a video call, we have a stream, AND the remote has video enabled
  const hasRemoteVideo = checkHasRemoteVideo();
  
  return (
    <OneToOneCallUI
      callerName={callerName}
      callerAvatar={callerAvatar}
      hasRemoteVideo={hasRemoteVideo}
      remoteStream={remoteStream}
      remoteVideoEnabled={remoteVideoEnabled}
      localStream={localStream}
      profile={profile}
      isRinging={isRinging}
      isCalling={isCalling}
      isInCall={isInCall}
      isVideoCall={isVideoCall}
      videoEnabled={videoEnabled}
      audioEnabled={audioEnabled}
      isSpeakerOn={isSpeakerOn}
      isDragging={isDragging}
      pipPosition={pipPosition}
      showAddParticipant={showAddParticipant}
      onToggleAudio={toggleAudio}
      onToggleVideo={toggleVideo}
      onToggleSpeaker={toggleSpeaker}
      onEndCall={endCall}
      onAnswerCall={answerCall}
      onRejectCall={rejectCall}
      onAddParticipant={() => setShowAddParticipant(true)}
      onCloseAddParticipant={() => setShowAddParticipant(false)}
      localVideoRef={localVideoRef}
      remoteVideoRef={remoteVideoRef}
    />
  )
}
