// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useRef, useState, useCallback } from 'react'
import { useCall } from '@/context/CallContext'
import { useAuth } from '@/context/AuthContext'
import { 
  Phone, 
  Video, 
  Mic, 
  MicOff, 
  VideoOff, 
  PhoneOff, 
  Users, 
  Volume2, 
  VolumeX,
  Maximize2,
  Minimize2
} from 'lucide-react'

// Helper component for call duration
function CallDuration({ isActive }: { isActive: boolean }) {
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    if (!isActive) {
      setDuration(0)
      return
    }

    const startTime = Date.now()
    const interval = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    return () => clearInterval(interval)
  }, [isActive])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return <span className="font-mono text-white/80 text-sm tracking-wider">{formatTime(duration)}</span>
}

// Component for rendering a single participant's video in group call
function ParticipantVideo({
  participant,
  isLocal = false
}: {
  participant: { id: string; name: string; avatar?: string; stream?: MediaStream; audioEnabled: boolean; videoEnabled: boolean }
  isLocal?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream
    }
  }, [participant.stream])

  useEffect(() => {
    if (!isLocal && audioRef.current && participant.stream) {
      audioRef.current.srcObject = participant.stream
      audioRef.current.volume = 1.0
    }
  }, [participant.stream, isLocal])

  const hasVideo = participant.stream?.getVideoTracks().some(t => t.enabled) && participant.videoEnabled

  return (
    <div className="relative bg-gray-800 rounded-2xl overflow-hidden aspect-[3/4] md:aspect-video flex items-center justify-center shadow-lg border border-white/10">
      {!isLocal && (
        <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />
      )}
      
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`w-full h-full object-cover ${isLocal ? 'transform scale-x-[-1]' : ''}`}
        />
      ) : (
        <div className="flex flex-col items-center justify-center p-4">
          {participant.avatar ? (
            <img
              src={participant.avatar}
              alt={participant.name}
              className="w-16 h-16 md:w-20 md:h-20 rounded-full object-cover border-2 border-white/20 shadow-md mb-2"
            />
          ) : (
            <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-2xl mb-2 shadow-md">
              {participant.name[0]?.toUpperCase() || '?'}
            </div>
          )}
          <span className="text-white text-sm font-medium truncate max-w-[120px]">{participant.name}</span>
        </div>
      )}
      
      <div className="absolute bottom-2 left-2 bg-black/40 backdrop-blur-sm px-2 py-1 rounded-lg text-white text-xs flex items-center gap-2 border border-white/10">
        {!participant.audioEnabled && <MicOff size={12} className="text-red-400" />}
        {!participant.videoEnabled && <VideoOff size={12} className="text-red-400" />}
        <span className="font-medium">{isLocal ? 'Vous' : participant.name}</span>
      </div>
    </div>
  )
}

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
    incomingCall,
    answerCall,
    rejectCall,
    endCall,
    toggleAudio,
    toggleVideo,
    isGroupCall,
    groupParticipants,
  } = useCall()

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const [isSpeakerOn, setIsSpeakerOn] = useState(true)

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

  // Handle drag start
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!pipRef.current) return
    
    setIsDragging(true)
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    
    setDragOffset({
      x: clientX - pipPosition.x,
      y: clientY - pipPosition.y,
    })
  }, [pipPosition])

  // Handle drag move
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

  // Handle drag end
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

  // Handle local stream attachment
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream, isCalling, isInCall])

  // Handle remote stream attachment
  useEffect(() => {
    if (remoteStream) {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream
        remoteAudioRef.current.volume = 1.0
      }
    }
  }, [remoteStream])

  // Toggle speaker (simulated for now as setSinkId is experimental/limited)
  const toggleSpeaker = () => {
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

  const callerName = incomingCall?.callerName || 'Utilisateur'
  const callerAvatar = incomingCall?.callerAvatar
  const isVideoCall =
    incomingCall?.isVideo ||
    (localStream?.getVideoTracks().length ?? 0) > 0 ||
    (remoteStream?.getVideoTracks().length ?? 0) > 0

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
      <div className="fixed inset-0 z-[100] bg-gray-900 flex flex-col">
        {/* Header */}
        <div className="safe-area-top px-4 py-4 bg-gray-900/90 backdrop-blur-md flex items-center justify-between z-10 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-400">
              <Users size={20} />
            </div>
            <div>
              <h2 className="text-white font-semibold text-lg leading-tight">{callerName}</h2>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <CallDuration isActive={isInCall} />
              </div>
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 auto-rows-fr">
            {allParticipants.map((participant, index) => (
              <ParticipantVideo
                key={participant.id}
                participant={participant}
                isLocal={index === 0}
              />
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="safe-area-bottom pt-6 px-6 bg-gray-900/90 backdrop-blur-md border-t border-white/5">
          <div className="flex items-center justify-center gap-6 mb-8">
            <button
              onClick={toggleAudio}
              className={`p-4 rounded-full transition-all duration-200 ${
                audioEnabled ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-white text-black'
              }`}
            >
              {audioEnabled ? <Mic size={24} /> : <MicOff size={24} />}
            </button>

            <button
              onClick={toggleVideo}
              className={`p-4 rounded-full transition-all duration-200 ${
                videoEnabled ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-white text-black'
              }`}
            >
              {videoEnabled ? <Video size={24} /> : <VideoOff size={24} />}
            </button>

            <button
              onClick={() => endCall()}
              className="p-4 rounded-full bg-red-500 hover:bg-red-600 text-white transition-all duration-200 shadow-lg shadow-red-500/20"
            >
              <PhoneOff size={28} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // --- 1-TO-1 CALL UI ---
  const hasRemoteVideo = isVideoCall && remoteStream && remoteStream.getVideoTracks().length > 0 && remoteStream.getVideoTracks()[0].enabled

  return (
    <div className="fixed inset-0 z-[100] bg-gray-900 flex flex-col overflow-hidden">
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

      {/* Background Layer */}
      <div className="absolute inset-0 z-0">
        {hasRemoteVideo ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-contain bg-black"
          />
        ) : (
          <>
            {/* Blurred Avatar Background */}
            {callerAvatar ? (
              <div 
                className="absolute inset-0 bg-cover bg-center blur-3xl opacity-30 scale-110"
                style={{ backgroundImage: `url(${callerAvatar})` }}
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900" />
            )}
            <div className="absolute inset-0 bg-black/20" />
          </>
        )}
      </div>

      {/* Content Layer */}
      <div className="relative z-10 flex-1 flex flex-col h-full">
        
        {/* Top Bar */}
        <div className="safe-area-top mt-4 flex flex-col items-center justify-center text-center px-4">
          <div className="flex flex-col items-center gap-1">
            <h2 className="text-white text-2xl md:text-3xl font-semibold tracking-tight drop-shadow-md">
              {callerName}
            </h2>
            <div className="flex items-center gap-2 text-white/80 text-sm md:text-base font-medium drop-shadow-md bg-black/20 px-3 py-1 rounded-full backdrop-blur-sm">
              {isRinging ? (
                <span className="animate-pulse">Appel entrant...</span>
              ) : isCalling ? (
                <span className="animate-pulse">Appel en cours...</span>
              ) : (
                <CallDuration isActive={isInCall} />
              )}
            </div>
          </div>
        </div>

        {/* Main Center Area (Avatar when no video) */}
        <div className="flex-1 flex items-center justify-center p-8">
          {!hasRemoteVideo && (
            <div className="relative">
              {/* Pulsing rings for incoming call */}
              {isRinging && (
                <>
                  <div className="absolute inset-0 rounded-full bg-white/20 animate-ping" />
                  <div className="absolute inset-0 rounded-full bg-white/10 animate-ping delay-150" />
                </>
              )}
              
              {/* Avatar */}
              <div className="relative w-32 h-32 md:w-48 md:h-48 rounded-full overflow-hidden border-4 border-white/10 shadow-2xl">
                {callerAvatar ? (
                  <img
                    src={callerAvatar}
                    alt={callerName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-gray-700 to-gray-600 flex items-center justify-center">
                    <span className="text-4xl md:text-6xl font-bold text-white/50">
                      {callerName[0]?.toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Self View (PIP) */}
        {isVideoCall && localStream && (isCalling || isInCall) && (
          <div
            ref={pipRef}
            className={`absolute w-28 h-40 md:w-36 md:h-52 bg-black rounded-2xl overflow-hidden shadow-2xl border border-white/20 transition-shadow ${
              isDragging ? 'cursor-grabbing shadow-white/10' : 'cursor-grab hover:scale-105'
            }`}
            style={{
              left: pipPosition.x,
              top: pipPosition.y,
              zIndex: 50,
              touchAction: 'none' // Prevent scrolling while dragging
            }}
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
          >
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover transform scale-x-[-1] pointer-events-none"
            />
            <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/60 to-transparent pointer-events-none">
              <p className="text-white text-[10px] font-medium text-center">Vous</p>
            </div>
          </div>
        )}

        {/* Bottom Controls */}
        <div className="safe-area-bottom mb-8 px-6">
          <div className="max-w-md mx-auto bg-black/40 backdrop-blur-xl rounded-[2rem] p-4 border border-white/10 shadow-2xl">
            {isRinging ? (
              <div className="flex items-center justify-around">
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={rejectCall}
                    className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all shadow-lg shadow-red-500/30 active:scale-95"
                  >
                    <PhoneOff size={28} className="text-white" />
                  </button>
                  <span className="text-white/80 text-xs font-medium">Refuser</span>
                </div>
                
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={answerCall}
                    className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center transition-all shadow-lg shadow-green-500/30 animate-pulse active:scale-95"
                  >
                    <Phone size={28} className="text-white" />
                  </button>
                  <span className="text-white/80 text-xs font-medium">Accepter</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between px-2">
                {/* Mute Toggle */}
                <button
                  onClick={toggleAudio}
                  className={`flex flex-col items-center gap-1 group`}
                >
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${
                    audioEnabled 
                      ? 'bg-white/10 group-hover:bg-white/20 text-white' 
                      : 'bg-white text-black'
                  }`}>
                    {audioEnabled ? <Mic size={20} /> : <MicOff size={20} />}
                  </div>
                  <span className="text-white/60 text-[10px] font-medium">Micro</span>
                </button>

                {/* Video Toggle */}
                {isVideoCall && (
                  <button
                    onClick={toggleVideo}
                    className={`flex flex-col items-center gap-1 group`}
                  >
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${
                      videoEnabled 
                        ? 'bg-white/10 group-hover:bg-white/20 text-white' 
                        : 'bg-white text-black'
                    }`}>
                      {videoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
                    </div>
                    <span className="text-white/60 text-[10px] font-medium">Caméra</span>
                  </button>
                )}

                {/* Speaker Toggle (Visual only for now) */}
                <button
                  onClick={toggleSpeaker}
                  className={`flex flex-col items-center gap-1 group`}
                >
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${
                    isSpeakerOn 
                      ? 'bg-white/10 group-hover:bg-white/20 text-white' 
                      : 'bg-white/5 text-white/50'
                  }`}>
                    {isSpeakerOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
                  </div>
                  <span className="text-white/60 text-[10px] font-medium">Haut-parleur</span>
                </button>

                {/* End Call */}
                <button
                  onClick={() => endCall()}
                  className="flex flex-col items-center gap-1 group"
                >
                  <div className="w-14 h-14 rounded-full bg-red-500 group-hover:bg-red-600 flex items-center justify-center transition-all shadow-lg shadow-red-500/30 active:scale-95">
                    <PhoneOff size={24} className="text-white" />
                  </div>
                  <span className="text-white/60 text-[10px] font-medium">Raccrocher</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
