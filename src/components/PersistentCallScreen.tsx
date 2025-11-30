import { useEffect, useRef } from 'react'
import { useCall } from '@/context/CallContext'
import { Phone, Video, Mic, MicOff, VideoOff, PhoneOff } from 'lucide-react'

export function PersistentCallScreen() {
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
  const isVideoCall = 
    incomingCall?.isVideo || 
    (localStream?.getVideoTracks().length ?? 0) > 0 ||
    (remoteStream?.getVideoTracks().length ?? 0) > 0

  console.log('📹 PersistentCallScreen render - isVideoCall:', isVideoCall, 'hasRemoteStream:', !!remoteStream)

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
      <div className="flex-1 relative">
        {isVideoCall && remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full bg-black object-contain"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center">
            <div className="w-32 h-32 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-5xl mb-6">
              {callerName[0]?.toUpperCase()}
            </div>
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
              onClick={endCall}
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