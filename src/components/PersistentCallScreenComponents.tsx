import React, { useEffect, useRef, useState, RefObject } from 'react'
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
  UserPlus
} from 'lucide-react'
import { CallParticipantSelector } from './CallParticipantSelector'

// Helper component for call duration
export function CallDuration({ isActive }: { isActive: boolean }) {
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
export function ParticipantVideo({
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
      audioRef.current.play().catch(err => console.warn('Group audio play failed:', err))
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
          key={`${participant.stream?.id}-${participant.videoEnabled}`} // Force recreation when stream or state changes
          ref={videoRef}
          autoPlay
          playsInline
          muted={true}
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

// Component for top bar in 1-to-1 call UI
function OneToOneCallTopBar({
  isRinging,
  isInCall,
  isCalling,
  callerName,
  onAddParticipant,
}: {
  isRinging: boolean;
  isInCall: boolean;
  isCalling: boolean;
  callerName: string;
  onAddParticipant: () => void;
}) {
  return (
    <div className="safe-area-top mt-4 px-4 relative">
      {!isRinging && (isInCall || isCalling) && (
        <div className="absolute right-4 top-0 z-20">
          <button
            onClick={onAddParticipant}
            className="w-10 h-10 rounded-full bg-black/20 backdrop-blur-md border border-white/10 flex items-center justify-center text-white hover:bg-black/40 transition-colors"
          >
            <UserPlus size={20} />
          </button>
        </div>
      )}

      <div className="flex flex-col items-center justify-center text-center">
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
    </div>
  )
}

// Component for bottom controls in 1-to-1 call UI
function OneToOneCallControls({
  isRinging,
  isVideoCall,
  isCalling,
  isInCall,
  audioEnabled,
  videoEnabled,
  isSpeakerOn,
  onToggleAudio,
  onToggleVideo,
  onToggleSpeaker,
  onEndCall,
  onAnswerCall,
  onRejectCall,
}: {
  isRinging: boolean;
  isVideoCall: boolean;
  isCalling: boolean;
  isInCall: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  isSpeakerOn: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleSpeaker: () => void;
  onEndCall: () => void;
  onAnswerCall: () => void;
  onRejectCall: () => void;
}) {
  if (isRinging) {
    return (
      <div className="flex items-center justify-around">
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onRejectCall}
            className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all shadow-lg shadow-red-500/30 active:scale-95"
          >
            <PhoneOff size={28} className="text-white" />
          </button>
          <span className="text-white/80 text-xs font-medium">Refuser</span>
        </div>
        
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onAnswerCall}
            className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center transition-all shadow-lg shadow-green-500/30 animate-pulse active:scale-95"
          >
            <Phone size={28} className="text-white" />
          </button>
          <span className="text-white/80 text-xs font-medium">Accepter</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between px-2">
      {/* Mute Toggle */}
      <button
        onClick={onToggleAudio}
        className="flex flex-col items-center gap-1 group"
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
          onClick={onToggleVideo}
          className="flex flex-col items-center gap-1 group"
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

      {/* Speaker Toggle */}
      <button
        onClick={onToggleSpeaker}
        className="flex flex-col items-center gap-1 group"
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
        onClick={onEndCall}
        className="flex flex-col items-center gap-1 group"
      >
        <div className="w-14 h-14 rounded-full bg-red-500 group-hover:bg-red-600 flex items-center justify-center transition-all shadow-lg shadow-red-500/30 active:scale-95">
          <PhoneOff size={24} className="text-white" />
        </div>
        <span className="text-white/60 text-[10px] font-medium">Raccrocher</span>
      </button>
    </div>
  )
}

// Component for 1-to-1 call UI
export function OneToOneCallUI({
  callerName,
  callerAvatar,
  hasRemoteVideo,
  remoteStream,
  remoteVideoEnabled,
  localStream,
  profile,
  isRinging,
  isCalling,
  isInCall,
  isVideoCall,
  videoEnabled,
  audioEnabled,
  isSpeakerOn,
  isDragging,
  pipPosition,
  showAddParticipant,
  onToggleAudio,
  onToggleVideo,
  onToggleSpeaker,
  onEndCall,
  onAnswerCall,
  onRejectCall,
  onAddParticipant,
  localVideoRef,
  remoteVideoRef,
}: {
  callerName: string;
  callerAvatar?: string;
  hasRemoteVideo: boolean;
  remoteStream: MediaStream | null;
  remoteVideoEnabled: boolean;
  localStream: MediaStream | null;
  profile: any;
  isRinging: boolean;
  isCalling: boolean;
  isInCall: boolean;
  isVideoCall: boolean;
  videoEnabled: boolean;
  audioEnabled: boolean;
  isSpeakerOn: boolean;
  isDragging: boolean;
  pipPosition: { x: number; y: number };
  showAddParticipant: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleSpeaker: () => void;
  onEndCall: () => void;
  onAnswerCall: () => void;
  onRejectCall: () => void;
  onAddParticipant: () => void;
  onCloseAddParticipant: () => void;
  localVideoRef: RefObject<HTMLVideoElement>;
  remoteVideoRef: RefObject<HTMLVideoElement>;
}) {
  return (
    <div className="fixed inset-0 z-[100] bg-gray-900 flex flex-col overflow-hidden">
      <audio ref={(el) => { if (el && el.srcObject !== remoteStream) el.srcObject = remoteStream }} autoPlay playsInline style={{ display: 'none' }} />

      {/* Background Layer */}
      <div className="absolute inset-0 z-0">
        {hasRemoteVideo ? (
          <video
            key={`${remoteStream?.id}-${remoteVideoEnabled}`}
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted={true}
            className="w-full h-full object-contain bg-black"
          />
        ) : (
          <>
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
        <OneToOneCallTopBar
          isRinging={isRinging}
          isInCall={isInCall}
          isCalling={isCalling}
          callerName={callerName}
          onAddParticipant={onAddParticipant}
        />

        {/* Main Center Area (Avatar when no video) */}
        <div className="flex-1 flex items-center justify-center p-8">
          {!hasRemoteVideo && (
            <div className="relative">
              {isRinging && (
                <>
                  <div className="absolute inset-0 rounded-full bg-white/20 animate-ping" />
                  <div className="absolute inset-0 rounded-full bg-white/10 animate-ping delay-150" />
                </>
              )}
              
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
            className={`absolute w-28 h-40 md:w-36 md:h-52 bg-black rounded-2xl overflow-hidden shadow-2xl border border-white/20 transition-shadow ${
              isDragging ? 'cursor-grabbing shadow-white/10' : 'cursor-grab hover:scale-105'
            }`}
            style={{
              left: pipPosition.x,
              top: pipPosition.y,
              zIndex: 50,
              touchAction: 'none'
            }}
          >
            {videoEnabled ? (
              <video
                key={`${localStream.id}-${videoEnabled}`}
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform scale-x-[-1] pointer-events-none"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-800">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt="Vous"
                    className="w-16 h-16 md:w-20 md:h-20 rounded-full object-cover border-2 border-white/20"
                  />
                ) : (
                  <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-2xl">
                    {profile?.display_name?.[0]?.toUpperCase() || profile?.username?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
              </div>
            )}
            <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/60 to-transparent pointer-events-none">
              <p className="text-white text-[10px] font-medium text-center">Vous</p>
            </div>
          </div>
        )}

        {/* Bottom Controls */}
        <div className="safe-area-bottom mb-8 px-6">
          <div className="max-w-md mx-auto bg-black/40 backdrop-blur-xl rounded-[2rem] p-4 border border-white/10 shadow-2xl">
            <OneToOneCallControls
              isRinging={isRinging}
              isVideoCall={isVideoCall}
              isCalling={isCalling}
              isInCall={isInCall}
              audioEnabled={audioEnabled}
              videoEnabled={videoEnabled}
              isSpeakerOn={isSpeakerOn}
              onToggleAudio={onToggleAudio}
              onToggleVideo={onToggleVideo}
              onToggleSpeaker={onToggleSpeaker}
              onEndCall={onEndCall}
              onAnswerCall={onAnswerCall}
              onRejectCall={onRejectCall}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// Component for Group Call UI
export function GroupCallUI({
  callerName,
  isInCall,
  allParticipants,
  audioEnabled,
  videoEnabled,
  toggleAudio,
  toggleVideo,
  endCall,
  showAddParticipant,
  setShowAddParticipant,
  addParticipant,
}: {
  callerName: string;
  isInCall: boolean;
  allParticipants: any[];
  audioEnabled: boolean;
  videoEnabled: boolean;
  toggleAudio: () => void;
  toggleVideo: () => void;
  endCall: () => void;
  showAddParticipant: boolean;
  setShowAddParticipant: (show: boolean) => void;
  addParticipant: (id: string) => void;
}) {
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
        
        <button
          onClick={() => setShowAddParticipant(true)}
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
        >
          <UserPlus size={20} />
        </button>
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

      {showAddParticipant && (
        <CallParticipantSelector
          onClose={() => setShowAddParticipant(false)}
          onSelect={(contactId) => {
            addParticipant(contactId)
            // Don't close the modal - let user add multiple participants
          }}
          currentParticipants={allParticipants.map(p => p.id)}
        />
      )}
    </div>
  )
}
