import React, { useEffect, useRef, useState } from 'react';
import { Phone, Video, Mic, MicOff, VideoOff, PhoneOff } from 'lucide-react';

interface CallScreenProps {
  isInCall: boolean;
  isRinging: boolean;
  isCalling: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
  callerName: string;
  isVideoCall: boolean;
  onAnswer: () => Promise<void>;
  onReject: () => void;
  onEnd: () => void;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
}

export const CallScreen: React.FC<CallScreenProps> = ({
  isInCall,
  isRinging,
  isCalling,
  localStream,
  remoteStream,
  audioEnabled,
  videoEnabled,
  callerName,
  isVideoCall,
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
  const [remoteVideoFit, setRemoteVideoFit] = useState<'contain' | 'cover'>('contain');
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
      
      // Forcer la lecture de la vidéo
      remoteVideoRef.current.play().catch(err => {
        console.error('Error playing remote video:', err);
      });
      
      // Détecter le ratio de la vidéo pour ajuster l'affichage
      remoteVideoRef.current.onloadedmetadata = () => {
        console.log('📹 CallScreen: Remote video metadata loaded');
        if (remoteVideoRef.current) {
          const videoRatio = remoteVideoRef.current.videoWidth / remoteVideoRef.current.videoHeight;
          const screenRatio = window.innerWidth / window.innerHeight;
          
          console.log('📹 Video ratio:', videoRatio, 'Screen ratio:', screenRatio);
          
          // Toujours utiliser 'contain' pour éviter le zoom excessif
          // Cela garantit que toute la vidéo est visible sans être coupée
          setRemoteVideoFit('contain');
        }
      };
    }
    
    // Attacher également le stream audio à un élément audio pour les appels audio
    if (remoteAudioRef.current && remoteStream) {
      console.log('🔊 CallScreen: Attaching remote stream to audio element');
      remoteAudioRef.current.srcObject = remoteStream;
      // S'assurer que l'audio est activé
      remoteAudioRef.current.volume = 1.0;
      remoteAudioRef.current.play().catch(err => {
        console.error('Error playing remote audio:', err);
      });
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

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 z-[100] flex flex-col">
      {/* Audio element caché pour le stream distant (appels audio) */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        style={{ display: 'none' }}
      />
      
      {/* Remote Video (or avatar) */}
      <div className="flex-1 relative">
        {isVideoCall && remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`w-full h-full bg-black ${remoteVideoFit === 'contain' ? 'object-contain' : 'object-cover'}`}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center">
            <div className="w-32 h-32 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-5xl mb-6">
              {callerName[0].toUpperCase()}
            </div>
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

        {/* Local Video (Picture-in-Picture) - Toujours visible pendant l'appel vidéo */}
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
        {isInCall && (
          <div className="text-center mt-4 text-white/70 text-sm">
            {isVideoCall ? 'Appel vidéo' : 'Appel audio'} • {formatDuration(callDuration)}
          </div>
        )}
      </div>
    </div>
  );
};