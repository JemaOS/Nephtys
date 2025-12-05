// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useEffect, useRef, useState } from 'react';
import { Phone, Video, Mic, MicOff, VideoOff, PhoneOff, Users } from 'lucide-react';

interface GroupParticipant {
  id: string;
  name: string;
  avatar?: string;
  stream?: MediaStream;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

interface CallScreenProps {
  isInCall: boolean;
  isRinging: boolean;
  isCalling: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
  callerName: string;
  callerAvatar?: string;
  isVideoCall: boolean;
  // Group call props
  isGroupCall?: boolean;
  groupParticipants?: GroupParticipant[];
  onAnswer: () => Promise<void>;
  onReject: () => void;
  onEnd: () => void;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
}

// Component for rendering a single participant's video tile
const ParticipantTile: React.FC<{
  participant: GroupParticipant;
  isLarge?: boolean;
}> = ({ participant, isLarge = false }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream;
    }
  }, [participant.stream]);

  const sizeClasses = isLarge
    ? 'w-full h-full'
    : 'w-full h-full min-h-[120px]';

  return (
    <div className={`relative ${sizeClasses} bg-gray-800 rounded-xl overflow-hidden`}>
      {participant.stream && participant.videoEnabled ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={false}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center">
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
      
      {/* Participant info overlay */}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
        <span className="text-white text-xs bg-black/50 px-2 py-1 rounded-full truncate max-w-[70%]">
          {participant.name}
        </span>
        <div className="flex gap-1">
          {!participant.audioEnabled && (
            <div className="w-6 h-6 rounded-full bg-red-500/80 flex items-center justify-center">
              <MicOff size={12} className="text-white" />
            </div>
          )}
          {!participant.videoEnabled && (
            <div className="w-6 h-6 rounded-full bg-red-500/80 flex items-center justify-center">
              <VideoOff size={12} className="text-white" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const CallScreen: React.FC<CallScreenProps> = ({
  isInCall,
  isRinging,
  isCalling,
  localStream,
  remoteStream,
  audioEnabled,
  videoEnabled,
  callerName,
  callerAvatar,
  isVideoCall,
  isGroupCall = false,
  groupParticipants = [],
  onAnswer,
  onReject,
  onEnd,
  onToggleAudio,
  onToggleVideo,
}) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isAnswering, setIsAnswering] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const handleAnswer = async () => {
    setIsAnswering(true);
    try {
      // Demander les permissions AVANT de répondre
      const constraints = {
        audio: true,
        video: isVideoCall
      };
      
      const testStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Arrêter le stream de test
      testStream.getTracks().forEach(track => track.stop());
      
      // Maintenant répondre à l'appel
      await onAnswer();
    } catch (error: any) {
      console.error('Error requesting permissions:', error);
      
      let errorMessage = '❌ Erreur\n\nImpossible de répondre à l\'appel.';
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage = '❌ Permissions refusées\n\nVeuillez autoriser l\'accès à votre ' +
          (isVideoCall ? 'caméra et microphone' : 'microphone') +
          ' dans les paramètres de votre navigateur pour répondre à l\'appel.\n\n' +
          'Sur Chrome Android:\n1. Appuyez sur l\'icône 🔒 dans la barre d\'adresse\n2. Activez les permissions Micro' +
          (isVideoCall ? ' et Caméra' : '');
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMessage = '❌ Aucun appareil trouvé\n\nAucun' +
          (isVideoCall ? 'e caméra ou' : '') +
          ' microphone n\'a été détecté sur votre appareil.';
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        errorMessage = '❌ Appareil occupé\n\nVotre ' +
          (isVideoCall ? 'caméra ou ' : '') +
          'microphone est déjà utilisé par une autre application.';
      }
      
      alert(errorMessage);
      setIsAnswering(false);
    }
  };

  // State to track if remote video is enabled
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState(false);

  // Attacher les streams aux éléments vidéo
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    console.log('📹 CallScreen: remoteStream changed:', remoteStream);
    console.log('📹 CallScreen: remoteStream tracks:', remoteStream?.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, readyState: t.readyState })));
    
    if (remoteVideoRef.current && remoteStream) {
      console.log('📹 CallScreen: Attaching remote stream to video element');
      remoteVideoRef.current.srcObject = remoteStream;
      
      // NE PAS appeler play() manuellement - laisser autoPlay faire son travail
      // Cela évite l'AbortError quand le composant se re-rend
      
      // Log video metadata when loaded
      remoteVideoRef.current.onloadedmetadata = () => {
        console.log('📹 CallScreen: Remote video metadata loaded');
        if (remoteVideoRef.current) {
          console.log('📹 Video dimensions:', remoteVideoRef.current.videoWidth, 'x', remoteVideoRef.current.videoHeight);
        }
      };

      // Listen for video track enabled/disabled changes
      const videoTracks = remoteStream.getVideoTracks();
      const checkVideoEnabled = () => {
        const hasActiveVideo = videoTracks.some(track => track.enabled && track.readyState === 'live');
        setRemoteVideoEnabled(hasActiveVideo);
      };
      
      // Initial check
      checkVideoEnabled();
      
      // Listen for track mute/unmute events
      videoTracks.forEach(track => {
        track.onmute = () => {
          console.log('📹 CallScreen: Remote video track muted');
          setRemoteVideoEnabled(false);
        };
        track.onunmute = () => {
          console.log('📹 CallScreen: Remote video track unmuted');
          setRemoteVideoEnabled(true);
        };
        track.onended = () => {
          console.log('📹 CallScreen: Remote video track ended');
          setRemoteVideoEnabled(false);
        };
      });
    } else {
      setRemoteVideoEnabled(false);
    }
    
    // Attacher également le stream audio à un élément audio pour les appels audio
    if (remoteAudioRef.current && remoteStream) {
      console.log('🔊 CallScreen: Attaching remote stream to audio element');
      remoteAudioRef.current.srcObject = remoteStream;
      // S'assurer que l'audio est activé
      remoteAudioRef.current.volume = 1.0;
      // NE PAS appeler play() manuellement - laisser autoPlay faire son travail
    }
  }, [remoteStream]);

  // Timer d'appel
  useEffect(() => {
    if (isInCall) {
      timerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setCallDuration(0);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isInCall]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate grid layout based on participant count
  const getGridLayout = (count: number) => {
    if (count <= 1) return 'grid-cols-1';
    if (count === 2) return 'grid-cols-2';
    if (count <= 4) return 'grid-cols-2 grid-rows-2';
    if (count <= 6) return 'grid-cols-3 grid-rows-2';
    if (count <= 9) return 'grid-cols-3 grid-rows-3';
    return 'grid-cols-4 grid-rows-3'; // Max 12 participants visible
  };

  // Render group call UI
  const renderGroupCallUI = () => {
    const totalParticipants = groupParticipants.length + 1; // +1 for self
    const gridLayout = getGridLayout(totalParticipants);

    return (
      <div className="flex-1 relative p-2">
        {/* Participant count badge */}
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2 bg-black/50 px-3 py-1.5 rounded-full">
          <Users size={16} className="text-white" />
          <span className="text-white text-sm font-medium">{totalParticipants} participants</span>
        </div>

        {/* Participants grid */}
        <div className={`grid ${gridLayout} gap-2 h-full`}>
          {/* Local video (self) */}
          <div className="relative bg-gray-800 rounded-xl overflow-hidden">
            {localStream && videoEnabled ? (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform scale-x-[-1]"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-2xl">
                  Vous
                </div>
              </div>
            )}
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
              <span className="text-white text-xs bg-black/50 px-2 py-1 rounded-full">
                Vous
              </span>
              <div className="flex gap-1">
                {!audioEnabled && (
                  <div className="w-6 h-6 rounded-full bg-red-500/80 flex items-center justify-center">
                    <MicOff size={12} className="text-white" />
                  </div>
                )}
                {!videoEnabled && (
                  <div className="w-6 h-6 rounded-full bg-red-500/80 flex items-center justify-center">
                    <VideoOff size={12} className="text-white" />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Other participants */}
          {groupParticipants.map((participant) => (
            <ParticipantTile key={participant.id} participant={participant} />
          ))}
        </div>

        {/* Call duration */}
        {isInCall && (
          <div className="absolute top-4 right-4 bg-black/50 px-3 py-1.5 rounded-full">
            <span className="text-white text-sm font-medium">{formatDuration(callDuration)}</span>
          </div>
        )}
      </div>
    );
  };

  // Render 1-to-1 call UI
  const renderOneToOneCallUI = () => {
    return (
      <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
        {/* Show video only if it's a video call AND remote stream has active video */}
        {isVideoCall && remoteStream && remoteVideoEnabled ? (
          <>
            {/* Remote video with proper aspect ratio preservation (pillarbox/letterbox) */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted={false}
              className="w-auto h-auto max-w-full max-h-full object-contain"
              style={{
                // Ensure the video maintains its natural aspect ratio
                // and doesn't get stretched or cropped
                objectFit: 'contain',
              }}
            />
            {console.log('📹 CallScreen: Rendering remote video element')}
          </>
        ) : (
          /* Show avatar when: not a video call, OR no remote stream, OR remote video is disabled */
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
            <h2 className="text-3xl font-bold text-text-primary mb-2">{callerName}</h2>
            <p className="text-lg text-white/70">
              {isRinging
                ? 'Appel entrant...'
                : isCalling
                  ? 'Appel en cours...'
                  : isInCall
                    ? formatDuration(callDuration)
                    : 'Connexion...'}
            </p>
          </div>
        )}

        {/* Local Video (Picture-in-Picture) - Show when video is enabled */}
        {isVideoCall && localStream && (isCalling || isInCall) && (
          <div className="absolute top-4 right-4 w-32 h-48 rounded-xl overflow-hidden shadow-2xl border-2 border-white/20 bg-gray-900">
            {videoEnabled ? (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-contain transform scale-x-[-1]"
              />
            ) : (
              /* Show avatar when local video is disabled */
              <div className="w-full h-full flex items-center justify-center bg-gray-800">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-xl">
                  Vous
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 z-[100] flex flex-col">
      {/* Audio element caché pour le stream distant (appels audio) */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        style={{ display: 'none' }}
      />
      
      {/* Main content - Group or 1-to-1 */}
      {isGroupCall ? renderGroupCallUI() : renderOneToOneCallUI()}

      {/* Controls */}
      <div className="p-4 sm:p-8 pb-safe bg-gradient-to-t from-black/50 to-transparent">
        {isRinging ? (
          // Appel entrant - Boutons Répondre/Rejeter
          <div className="flex items-center justify-center gap-8">
            <button
              onClick={onReject}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all shadow-lg hover:shadow-xl active:scale-95"
              aria-label="Rejeter l'appel"
            >
              <PhoneOff size={28} className="text-white" />
            </button>
            
            <button
              onClick={handleAnswer}
              disabled={isAnswering}
              className="w-20 h-20 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center transition-all shadow-lg hover:shadow-xl active:scale-95 animate-pulse disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Répondre"
            >
              {isAnswering ? (
                <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Phone size={32} className="text-white" />
              )}
            </button>
          </div>
        ) : (
          // En appel - Contrôles
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={onToggleAudio}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg ${
                audioEnabled
                  ? 'bg-white/20 hover:bg-white/30'
                  : 'bg-red-500 hover:bg-red-600'
              }`}
              aria-label={audioEnabled ? 'Couper le micro' : 'Activer le micro'}
            >
              {audioEnabled ? (
                <Mic size={24} className="text-white" />
              ) : (
                <MicOff size={24} className="text-white" />
              )}
            </button>

            {isVideoCall && (
              <button
                onClick={onToggleVideo}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg ${
                  videoEnabled
                    ? 'bg-white/20 hover:bg-white/30'
                    : 'bg-red-500 hover:bg-red-600'
                }`}
                aria-label={videoEnabled ? 'Couper la vidéo' : 'Activer la vidéo'}
              >
                {videoEnabled ? (
                  <Video size={24} className="text-white" />
                ) : (
                  <VideoOff size={24} className="text-white" />
                )}
              </button>
            )}

            <button
              onClick={onEnd}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all shadow-lg hover:shadow-xl active:scale-95"
              aria-label="Raccrocher"
            >
              <PhoneOff size={28} className="text-white" />
            </button>
          </div>
        )}

        {/* Call info */}
        {isInCall && !isGroupCall && (
          <div className="text-center mt-4 text-white/70 text-sm">
            {isVideoCall ? 'Appel vidéo' : 'Appel audio'} • {formatDuration(callDuration)}
          </div>
        )}
        {isInCall && isGroupCall && (
          <div className="text-center mt-4 text-white/70 text-sm">
            {isVideoCall ? 'Appel vidéo de groupe' : 'Appel audio de groupe'} • {groupParticipants.length + 1} participants
          </div>
        )}
      </div>
    </div>
  );
};