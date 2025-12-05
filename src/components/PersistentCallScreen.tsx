// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useRef, useState } from 'react'
import { useCall } from '@/context/CallContext'
import { useAuth } from '@/context/AuthContext'
import { Phone, Video, Mic, MicOff, VideoOff, PhoneOff, Users } from 'lucide-react'

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
      console.log(`🎥 ParticipantVideo: Attaching stream for ${participant.name} (${participant.id})`)
      videoRef.current.srcObject = participant.stream
    }
  }, [participant.stream, participant.name, participant.id])

  useEffect(() => {
    // For remote participants, also attach audio
    if (!isLocal && audioRef.current && participant.stream) {
      audioRef.current.srcObject = participant.stream
      audioRef.current.volume = 1.0
    }
  }, [participant.stream, isLocal])

  const hasVideo = participant.stream?.getVideoTracks().some(t => t.enabled) && participant.videoEnabled

  return (
    <div className="relative bg-gray-800 rounded-xl overflow-hidden aspect-video flex items-center justify-center">
      {/* Audio element for remote participants */}
      {!isLocal && (
        <audio
          ref={audioRef}
          autoPlay
          playsInline
          style={{ display: 'none' }}
        />
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
        <div className="flex flex-col items-center justify-center">
          {participant.avatar ? (
            <img
              src={participant.avatar}
              alt={participant.name}
              className="w-16 h-16 rounded-full object-cover border-2 border-white/20"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-2xl">
              {participant.name[0]?.toUpperCase() || '?'}
            </div>
          )}
          <span className="mt-2 text-white text-sm font-medium">{participant.name}</span>
        </div>
      )}
      
      {/* Participant name overlay */}
      <div className="absolute bottom-2 left-2 bg-black/50 px-2 py-1 rounded text-white text-xs flex items-center gap-1">
        {!participant.audioEnabled && <MicOff size={12} className="text-red-400" />}
        {!participant.videoEnabled && <VideoOff size={12} className="text-red-400" />}
        <span>{isLocal ? 'Vous' : participant.name}</span>
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
  const containerRef = useRef<HTMLDivElement>(null)

  // Attacher localStream
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      console.log('🎥 Attaching local stream')
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream])

  // Attacher remoteStream
  useEffect(() => {
    if (remoteStream) {
      console.log('🎥 Attaching remote stream with', remoteStream.getTracks().length, 'tracks')
      
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream
        console.log('📹 Remote video element updated')
      }
      
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream
        remoteAudioRef.current.volume = 1.0
        console.log('🔊 Remote audio element updated')
      }
    }
  }, [remoteStream])

  // N'afficher que si un appel est actif
  if (!isInCall && !isRinging && !isCalling) {
    return null
  }

  const callerName = incomingCall?.callerName || 'Utilisateur'
  const callerAvatar = incomingCall?.callerAvatar
  const isVideoCall =
    incomingCall?.isVideo ||
    (localStream?.getVideoTracks().length ?? 0) > 0 ||
    (remoteStream?.getVideoTracks().length ?? 0) > 0

  console.log('📹 PersistentCallScreen render - isInCall:', isInCall, 'isRinging:', isRinging, 'isCalling:', isCalling, 'isVideoCall:', isVideoCall, 'hasRemoteStream:', !!remoteStream, 'incomingCall:', !!incomingCall, 'callerAvatar:', callerAvatar, 'isGroupCall:', isGroupCall, 'groupParticipants:', groupParticipants.length)

  // Calculate grid layout for group calls
  const getGridClass = (count: number) => {
    if (count <= 1) return 'grid-cols-1'
    if (count <= 2) return 'grid-cols-2'
    if (count <= 4) return 'grid-cols-2 grid-rows-2'
    if (count <= 6) return 'grid-cols-3 grid-rows-2'
    return 'grid-cols-3 grid-rows-3'
  }

  // Render group call UI
  if (isGroupCall && (isInCall || isCalling)) {
    const allParticipants = [
      // Add local user first with their avatar from profile
      {
        id: 'local',
        name: 'Vous',
        avatar: profile?.avatar_url || undefined,
        stream: localStream || undefined,
        audioEnabled,
        videoEnabled,
      },
      // Then add remote participants
      ...groupParticipants
    ]

    return (
      <div ref={containerRef} className="fixed inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 z-[100] flex flex-col overflow-hidden">
        {/* Header with group info */}
        <div className="flex-shrink-0 p-4 flex items-center gap-3 bg-black/30">
          {callerAvatar ? (
            <img
              src={callerAvatar}
              alt={callerName}
              className="w-10 h-10 rounded-full object-cover border-2 border-white/20"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-primary-500 flex items-center justify-center">
              <Users size={20} className="text-white" />
            </div>
          )}
          <div>
            <h2 className="text-white font-semibold">{callerName}</h2>
            <p className="text-white/60 text-sm">
              {isCalling ? 'Connexion...' : `${allParticipants.length} participant${allParticipants.length > 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {/* Video Grid - use min-h-0 to allow shrinking and overflow-auto for scrolling if needed */}
        <div className={`flex-1 min-h-0 p-2 grid gap-2 overflow-auto ${getGridClass(allParticipants.length)}`}>
          {allParticipants.map((participant, index) => (
            <ParticipantVideo
              key={participant.id}
              participant={participant}
              isLocal={index === 0}
            />
          ))}
        </div>

        {/* Controls - always visible at bottom */}
        <div className="flex-shrink-0 p-4 pb-safe bg-gradient-to-t from-black/80 to-black/30">
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={toggleAudio}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg ${
                audioEnabled ? 'bg-white/20 hover:bg-white/30' : 'bg-red-500 hover:bg-red-600'
              }`}
            >
              {audioEnabled ? <Mic size={24} className="text-white" /> : <MicOff size={24} className="text-white" />}
            </button>

            {isVideoCall && (
              <button
                onClick={toggleVideo}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg ${
                  videoEnabled ? 'bg-white/20 hover:bg-white/30' : 'bg-red-500 hover:bg-red-600'
                }`}
              >
                {videoEnabled ? <Video size={24} className="text-white" /> : <VideoOff size={24} className="text-white" />}
              </button>
            )}

            <button
              onClick={() => endCall()}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all shadow-lg"
            >
              <PhoneOff size={28} className="text-white" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Render 1-to-1 call UI (existing code)
  return (
    <div ref={containerRef} className="fixed inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 z-[100] flex flex-col">
      {/* Éléments audio/vidéo TOUJOURS présents dans le DOM */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        style={{ display: 'none' }}
      />
      
      {/* Remote Video */}
      <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
        {isVideoCall && remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted={false}
            className="max-w-full max-h-full object-contain"
            style={{
              // Ensure the video maintains its natural aspect ratio
              // Portrait videos from phones will show with black bars on sides (pillarbox)
              // Landscape videos will show with black bars on top/bottom (letterbox)
              width: 'auto',
              height: 'auto',
            }}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center">
            {callerAvatar ? (
              <img
                src={callerAvatar}
                alt={callerName}
                className="w-32 h-32 rounded-full object-cover mb-6 border-4 border-white/20 shadow-2xl"
              />
            ) : (
              <div className="w-32 h-32 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-5xl mb-6">
                {callerName[0]?.toUpperCase() || '?'}
              </div>
            )}
            <h2 className="text-3xl font-bold text-white mb-2">{callerName}</h2>
            <p className="text-lg text-white/70">
              {isRinging ? 'Appel entrant...' : isCalling ? 'Appel en cours...' : 'En appel'}
            </p>
          </div>
        )}

        {/* Local Video (Picture-in-Picture) */}
        {isVideoCall && localStream && (isCalling || isInCall) && (
          <div className="absolute top-4 right-4 w-32 h-48 rounded-xl overflow-hidden shadow-2xl border-2 border-white/20 bg-gray-900">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover transform scale-x-[-1]"
            />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="p-4 sm:p-8 pb-safe bg-gradient-to-t from-black/50 to-transparent">
        {isRinging ? (
          <div className="flex items-center justify-center gap-8">
            <button
              onClick={rejectCall}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all shadow-lg"
            >
              <PhoneOff size={28} className="text-white" />
            </button>
            <button
              onClick={answerCall}
              className="w-20 h-20 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center transition-all shadow-lg animate-pulse"
            >
              <Phone size={32} className="text-white" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={toggleAudio}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg ${
                audioEnabled ? 'bg-white/20' : 'bg-red-500'
              }`}
            >
              {audioEnabled ? <Mic size={24} className="text-white" /> : <MicOff size={24} className="text-white" />}
            </button>

            {isVideoCall && (
              <button
                onClick={toggleVideo}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg ${
                  videoEnabled ? 'bg-white/20' : 'bg-red-500'
                }`}
              >
                {videoEnabled ? <Video size={24} className="text-white" /> : <VideoOff size={24} className="text-white" />}
              </button>
            )}

            <button
              onClick={() => endCall()}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all shadow-lg"
            >
              <PhoneOff size={28} className="text-white" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}