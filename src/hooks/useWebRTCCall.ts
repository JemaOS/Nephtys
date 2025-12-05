// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { webrtcManager, CallConfig } from '@/lib/webrtc';

interface CallSignal {
  type: 'offer' | 'answer' | 'ice-candidate' | 'call-end';
  from: string;
  to: string;
  data: any;
  conversation_id: string;
}

interface QueuedIceCandidate {
  candidate: RTCIceCandidateInit;
  timestamp: number;
}

interface UseWebRTCCallReturn {
  isInCall: boolean;
  isRinging: boolean;
  isCalling: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
  startCall: (userId: string, conversationId: string, config: CallConfig) => Promise<void>;
  answerCall: () => Promise<void>;
  endCall: () => void;
  toggleAudio: () => void;
  toggleVideo: () => void;
  rejectCall: () => void;
}

export const useWebRTCCall = (currentUserId: string): UseWebRTCCallReturn => {
  const [isInCall, setIsInCall] = useState(false);
  const [isRinging, setIsRinging] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [incomingCall, setIncomingCall] = useState<CallSignal | null>(null);
  const [currentCallUserId, setCurrentCallUserId] = useState<string | null>(null);
  const [currentCallConversationId, setCurrentCallConversationId] = useState<string | null>(null);
  const channelRef = useRef<any>(null);
  const iceCandidateQueue = useRef<QueuedIceCandidate[]>([]);
  const isPeerConnectionReady = useRef(false);

  useEffect(() => {
    // S'abonner aux signaux d'appel
    const channel = supabase
      .channel('webrtc-signals')
      .on('broadcast', { event: 'call-signal' }, async (payload) => {
        const signal = payload.payload as CallSignal;
        
        // Ignorer nos propres signaux
        if (signal.from === currentUserId) return;
        
        // Traiter uniquement les signaux qui nous sont destinés
        if (signal.to !== currentUserId) return;

        handleIncomingSignal(signal);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  const handleIncomingSignal = async (signal: CallSignal) => {
    switch (signal.type) {
      case 'offer':
        // Appel entrant
        setIncomingCall(signal);
        setIsRinging(true);
        
        // Envoyer une notification d'appel entrant
        if ('Notification' in window && Notification.permission === 'granted') {
          const isVideoCall = signal.data?.video || false;
          const callType = isVideoCall ? '📹 Appel vidéo' : '📞 Appel audio';
          
          // Récupérer le nom de l'appelant
          supabase
            .from('profiles')
            .select('display_name, username')
            .eq('id', signal.from)
            .maybeSingle()
            .then(({ data: profile }) => {
              const callerName = profile?.display_name || profile?.username || 'Quelqu\'un';
              
              if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.ready.then((registration) => {
                  registration.showNotification(`${callType} entrant`, {
                    body: `${callerName} vous appelle...`,
                    icon: '/icon-192.png',
                    badge: '/icon-192.png',
                    tag: 'incoming-call',
                    requireInteraction: true,
                    actions: [
                      { action: 'answer', title: 'Répondre' },
                      { action: 'reject', title: 'Refuser' },
                    ],
                    data: {
                      conversationId: signal.conversation_id,
                      callerId: signal.from,
                      url: `/chat/${signal.conversation_id}`,
                    },
                  } as any);
                  
                  // Vibration séparée
                  if ('vibrate' in navigator) {
                    navigator.vibrate([200, 100, 200, 100, 200]);
                  }
                });
              } else {
                // Fallback notification
                new Notification(`${callType} entrant`, {
                  body: `${callerName} vous appelle...`,
                  icon: '/icon-192.png',
                  tag: 'incoming-call',
                });
                
                // Vibration
                if ('vibrate' in navigator) {
                  navigator.vibrate([200, 100, 200, 100, 200]);
                }
              }
            });
        }
        break;

      case 'answer':
        // L'autre personne a répondu
        if (webrtcManager) {
          await webrtcManager.handleAnswer(signal.data);
          setIsCalling(false);
          setIsInCall(true);
        }
        break;

      case 'ice-candidate':
        // Nouveau candidat ICE
        if (signal.data) {
          if (isPeerConnectionReady.current) {
            // Si la connexion est prête, ajouter directement
            try {
              await webrtcManager.addIceCandidate(signal.data);
            } catch (error) {
              console.error('Error adding ICE candidate:', error);
            }
          } else {
            // Sinon, mettre en file d'attente
            iceCandidateQueue.current.push({
              candidate: signal.data,
              timestamp: Date.now()
            });
          }
        }
        break;

      case 'call-end':
        // L'autre personne a raccroché
        endCall();
        break;
    }
  };

  const sendSignal = async (signal: CallSignal) => {
    if (channelRef.current) {
      await channelRef.current.send({
        type: 'broadcast',
        event: 'call-signal',
        payload: signal,
      });
    }
  };

  const startCall = async (userId: string, conversationId: string, config: CallConfig) => {
    try {
      setIsCalling(true);
      isPeerConnectionReady.current = false;
      iceCandidateQueue.current = [];
      
      // Sauvegarder les infos de l'appel
      setCurrentCallUserId(userId);
      setCurrentCallConversationId(conversationId);

      // Initialiser WebRTC
      const stream = await webrtcManager.initializeCall(config);
      setLocalStream(stream);
      setAudioEnabled(config.audio);
      setVideoEnabled(config.video);

      // Marquer la connexion comme prête
      isPeerConnectionReady.current = true;

      // Créer l'offre
      const offer = await webrtcManager.createOffer();

      // Envoyer l'offre via Supabase Realtime
      await sendSignal({
        type: 'offer',
        from: currentUserId,
        to: userId,
        data: { ...offer, video: config.video },
        conversation_id: conversationId,
      });

      // Écouter les candidats ICE
      webrtcManager.onIceCandidate(async (candidate) => {
        await sendSignal({
          type: 'ice-candidate',
          from: currentUserId,
          to: userId,
          data: candidate,
          conversation_id: conversationId,
        });
      });

      // Écouter le stream distant
      webrtcManager.onRemoteStream((stream) => {
        setRemoteStream(stream);
      });

      // Écouter la fin d'appel
      webrtcManager.onCallEnd(() => {
        endCall();
      });

      // Enregistrer l'appel dans call_logs
      await supabase.from('call_logs').insert({
        conversation_id: conversationId,
        caller_id: currentUserId,
        callee_id: userId,
        type: config.video ? 'video' : 'audio',
        status: 'initiated',
      });
    } catch (error) {
      console.error('Error starting call:', error);
      setIsCalling(false);
      throw error;
    }
  };

  const answerCall = async () => {
    if (!incomingCall) return;

    try {
      setIsRinging(false);
      setIsInCall(true);
      isPeerConnectionReady.current = false;

      // Initialiser WebRTC
      const config: CallConfig = {
        audio: true,
        video: incomingCall.data.video || false,
      };
      
      const stream = await webrtcManager.initializeCall(config);
      setLocalStream(stream);

      // Créer la réponse
      const answer = await webrtcManager.createAnswer(incomingCall.data);

      // Marquer la connexion comme prête
      isPeerConnectionReady.current = true;

      // Traiter les candidats ICE en file d'attente
      if (iceCandidateQueue.current.length > 0) {
        console.log(`Processing ${iceCandidateQueue.current.length} queued ICE candidates`);
        for (const { candidate } of iceCandidateQueue.current) {
          try {
            await webrtcManager.addIceCandidate(candidate);
          } catch (error) {
            console.error('Error adding queued ICE candidate:', error);
          }
        }
        iceCandidateQueue.current = [];
      }

      // Envoyer la réponse
      await sendSignal({
        type: 'answer',
        from: currentUserId,
        to: incomingCall.from,
        data: answer,
        conversation_id: incomingCall.conversation_id,
      });

      // Écouter les candidats ICE
      webrtcManager.onIceCandidate(async (candidate) => {
        await sendSignal({
          type: 'ice-candidate',
          from: currentUserId,
          to: incomingCall.from,
          data: candidate,
          conversation_id: incomingCall.conversation_id,
        });
      });

      // Écouter le stream distant
      webrtcManager.onRemoteStream((stream) => {
        setRemoteStream(stream);
      });

      // Mettre à jour call_logs
      await supabase.from('call_logs').insert({
        conversation_id: incomingCall.conversation_id,
        caller_id: incomingCall.from,
        callee_id: currentUserId,
        type: config.video ? 'video' : 'audio',
        status: 'answered',
      });

      setIncomingCall(null);
    } catch (error) {
      console.error('Error answering call:', error);
      setIsRinging(false);
      throw error;
    }
  };

  const rejectCall = async () => {
    if (incomingCall) {
      await sendSignal({
        type: 'call-end',
        from: currentUserId,
        to: incomingCall.from,
        data: { reason: 'rejected' },
        conversation_id: incomingCall.conversation_id,
      });

      setIsRinging(false);
      setIncomingCall(null);
    }
  };

  const endCall = () => {
    // Envoyer signal de fin à l'autre personne
    const otherUserId = incomingCall?.from || currentCallUserId;
    const conversationId = incomingCall?.conversation_id || currentCallConversationId;
    
    if (otherUserId && conversationId) {
      sendSignal({
        type: 'call-end',
        from: currentUserId,
        to: otherUserId,
        data: { reason: 'ended' },
        conversation_id: conversationId,
      });
    }

    // Nettoyer WebRTC
    webrtcManager.endCall();

    // Reset états
    setIsInCall(false);
    setIsCalling(false);
    setIsRinging(false);
    setLocalStream(null);
    setRemoteStream(null);
    setIncomingCall(null);
    setCurrentCallUserId(null);
    setCurrentCallConversationId(null);
    isPeerConnectionReady.current = false;
    iceCandidateQueue.current = [];
  };

  const toggleAudio = () => {
    const newState = !audioEnabled;
    webrtcManager.toggleAudio(newState);
    setAudioEnabled(newState);
  };

  const toggleVideo = () => {
    const newState = !videoEnabled;
    webrtcManager.toggleVideo(newState);
    setVideoEnabled(newState);
  };

  return {
    isInCall,
    isRinging,
    isCalling,
    localStream,
    remoteStream,
    audioEnabled,
    videoEnabled,
    startCall,
    answerCall,
    endCall,
    toggleAudio,
    toggleVideo,
    rejectCall,
  };
};