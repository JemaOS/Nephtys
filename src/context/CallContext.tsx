// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { createContext, useContext, useEffect, useState, useRef, useMemo, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { resolveMediaUrl } from '@/lib/mediaUrl'
import { webrtcManager, CallConfig } from '@/lib/webrtc'
import { groupCallManager, GroupCallConfig } from '@/lib/groupWebRTC'
import { useAuth } from './AuthContext'

interface CallSignal {
  type: 'offer' | 'answer' | 'ice-candidate' | 'call-end' | 'group-call-invite' | 'media-state-update'
  from: string
  to: string
  data: any
  conversation_id: string
}

interface QueuedIceCandidate {
  candidate: RTCIceCandidateInit
  timestamp: number
}

interface IncomingCall {
  from: string
  conversationId: string
  isVideo: boolean
  callerName: string
  callerAvatar?: string
  isGroupCall?: boolean
}

interface GroupCallParticipant {
  id: string
  name: string
  avatar?: string
  stream?: MediaStream
  audioEnabled: boolean
  videoEnabled: boolean
}

interface CallContextType {
  isInCall: boolean
  isRinging: boolean
  isCalling: boolean
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  audioEnabled: boolean
  videoEnabled: boolean
  remoteVideoEnabled: boolean
  incomingCall: IncomingCall | null
  // Group call specific
  isGroupCall: boolean
  groupParticipants: GroupCallParticipant[]
  // ID of the remote peer in a 1-on-1 call (null otherwise). Exposed so the
  // call UI can pre-populate the "add participant" selector with the peer
  // already in the call (avoid showing them as selectable / re-inviting).
  currentCallUserId: string | null
  // Methods
  startCall: (userId: string, conversationId: string, config: CallConfig) => Promise<void>
  startGroupCall: (conversationId: string, config: GroupCallConfig) => Promise<void>
  answerCall: () => Promise<void>
  endCall: (sendEndSignal?: boolean) => void
  toggleAudio: () => void
  toggleVideo: () => void
  rejectCall: () => void
  addParticipant: (contactId: string) => Promise<void>
}

const CallContext = createContext<CallContextType | undefined>(undefined)

/**
 * Contexte secondaire qui n'expose QUE les méthodes (références stables
 * tant que le provider est monté). Permet aux pages qui ne lisent pas le
 * state d'appel (ChatViewPage, CallsPage) de NE PAS re-render quand
 * `localStream`, `audioEnabled`, etc. changent — ce qui arrive très
 * fréquemment pendant un appel actif.
 *
 * Pattern :
 *   - useCall() : renvoie tout (state + actions). Utilisé par
 *                 PersistentCallScreen qui doit re-render à chaque tick.
 *   - useCallActions() : renvoie uniquement les méthodes stables.
 *                       Utilisé par ChatViewPage et CallsPage.
 */
interface CallActions {
  startCall: CallContextType['startCall']
  startGroupCall: CallContextType['startGroupCall']
  answerCall: CallContextType['answerCall']
  endCall: CallContextType['endCall']
  toggleAudio: CallContextType['toggleAudio']
  toggleVideo: CallContextType['toggleVideo']
  rejectCall: CallContextType['rejectCall']
  addParticipant: CallContextType['addParticipant']
}

const CallActionsContext = createContext<CallActions | undefined>(undefined)

export function CallProvider({ children }: { readonly children: ReactNode }) {
  const { user } = useAuth()
  const [isInCall, setIsInCall] = useState(false)
  const [isRinging, setIsRinging] = useState(false)
  const [isCalling, setIsCalling] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState(true)
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null)
  const [incomingCallSignal, setIncomingCallSignal] = useState<CallSignal | null>(null)
  const [currentCallUserId, setCurrentCallUserId] = useState<string | null>(null)
  const [currentCallConversationId, setCurrentCallConversationId] = useState<string | null>(null)
  const [channelRef, setChannelRef] = useState<any>(null)
  const iceCandidateQueueRef = useRef<QueuedIceCandidate[]>([])
  const [isPeerConnectionReady, setIsPeerConnectionReady] = useState(false)
  
  // Group call state
  const [isGroupCall, setIsGroupCall] = useState(false)
  const [groupParticipants, setGroupParticipants] = useState<GroupCallParticipant[]>([])

  // Cache local de l'id utilisateur résolu via fallback Supabase, utilisé
  // tout au long de l'appel courant (les helpers like sendSignal continuent
  // d'utiliser `user?.id` du contexte React, qui peut être désynchronisé).
  const resolvedUserIdRef = useRef<string | null>(null)

  /**
   * Renvoie l'ID de l'utilisateur connecté.
   * Priorité 1 : `user.id` du contexte React (instantané).
   * Priorité 2 : `resolvedUserIdRef.current` (cache de fallback précédent).
   * Priorité 3 : `supabase.auth.getSession()` (sync depuis le storage local
   *             de supabase-js, sans requête réseau).
   * Priorité 4 : `supabase.auth.getUser()` (requête réseau, dernier recours).
   *
   * Lance une erreur explicite seulement si AUCUNE de ces sources ne donne
   * d'utilisateur — i.e. l'utilisateur est réellement déconnecté.
   *
   * Corrige le bug "Vous devez être connecté pour démarrer un appel" qui
   * apparaissait quand le state `user` du AuthContext était temporairement
   * null (timeout de session, race condition au mount) alors que la session
   * Supabase était valide.
   */
  const resolveCurrentUserId = async (): Promise<string> => {
    if (user?.id) {
      resolvedUserIdRef.current = user.id
      return user.id
    }
    if (resolvedUserIdRef.current) {
      return resolvedUserIdRef.current
    }
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user?.id) {
        resolvedUserIdRef.current = session.user.id
        return session.user.id
      }
    } catch (e) {
      console.warn('[Call] getSession failed during resolveCurrentUserId', e)
    }
    try {
      const { data: { user: fetchedUser } } = await supabase.auth.getUser()
      if (fetchedUser?.id) {
        resolvedUserIdRef.current = fetchedUser.id
        return fetchedUser.id
      }
    } catch (e) {
      console.warn('[Call] getUser failed during resolveCurrentUserId', e)
    }
    throw new Error('Vous devez être connecté pour démarrer un appel.')
  }

  const processIceCandidateQueue = async () => {
    if (iceCandidateQueueRef.current.length === 0) return

    console.log(`Processing ${iceCandidateQueueRef.current.length} queued ICE candidates`)
    const remainingCandidates: QueuedIceCandidate[] = []
    
    for (const item of iceCandidateQueueRef.current) {
      try {
        // Only try to add if we have a remote description
        if (webrtcManager.hasRemoteDescription()) {
           await webrtcManager.addIceCandidate(item.candidate)
        } else {
           remainingCandidates.push(item)
        }
      } catch (error) {
        console.error('Error adding queued ICE candidate:', error)
        // If it failed, keep it in queue if it might work later?
        // For now, we assume if it fails with hasRemoteDescription=true, it's a permanent error or race condition we can't easily fix
        // But if the error is "Remote description not set", we should definitely keep it.
        if (error instanceof Error && error.message === 'Remote description not set') {
          remainingCandidates.push(item)
        }
      }
    }
    iceCandidateQueueRef.current = remainingCandidates
  }

  // Subscribe to call signals globally
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel('global-webrtc-signals')
      .on('broadcast', { event: 'call-signal' }, async (payload) => {
        const signal = payload.payload as CallSignal
        
        // Ignorer nos propres signaux
        if (signal.from === user?.id) {
          return
        }
        
        // Traiter uniquement les signaux qui nous sont destinés
        if (signal.to !== user?.id) {
          return
        }

        handleIncomingSignal(signal)
      })
      .subscribe()

    setChannelRef(channel)

    return () => {
      supabase.removeChannel(channel).catch(() => {})
    }
  }, [user])

  // Helper function to show incoming call notification
  const showIncomingCallNotification = (callerName: string, isVideo: boolean, conversationId: string, callerId: string) => {
    const callType = isVideo ? '📹 Appel vidéo' : '📞 Appel audio'
    
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
            conversationId,
            callerId,
            url: `/chat/${conversationId}`,
          },
        } as any)
        
        if ('vibrate' in navigator) {
          navigator.vibrate([200, 100, 200, 100, 200])
        }
      })
    } else {
      new Notification(`${callType} entrant`, {
        body: `${callerName} vous appelle...`,
        icon: '/icon-192.png',
        tag: 'incoming-call',
      })
      
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200, 100, 200])
      }
    }
  }

  // Helper function to show group call notification
  const showGroupCallNotification = (callerName: string, groupName: string, isVideo: boolean, conversationId: string, callerId: string) => {
    const callType = isVideo ? '📹 Appel vidéo de groupe' : '📞 Appel de groupe'
    
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((registration) => {
        registration.showNotification(`${callType} entrant`, {
          body: `${callerName} vous appelle dans ${groupName}...`,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: 'incoming-group-call',
          requireInteraction: true,
          actions: [
            { action: 'answer', title: 'Rejoindre' },
            { action: 'reject', title: 'Ignorer' },
          ],
          data: {
            conversationId,
            callerId,
            url: `/chat/${conversationId}`,
            isGroupCall: true,
          },
        } as any)
        
        if ('vibrate' in navigator) {
          navigator.vibrate([200, 100, 200, 100, 200])
        }
      })
    } else {
      new Notification(`${callType} entrant`, {
        body: `${callerName} vous appelle dans ${groupName}...`,
        icon: '/icon-192.png',
        tag: 'incoming-group-call',
      })
      
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200, 100, 200])
      }
    }
  }

  // Helper to fetch caller profile
  const fetchCallerProfile = async (userId: string) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, username, avatar_url')
      .eq('id', userId)
      .maybeSingle()
    if (profile?.avatar_url) {
      profile.avatar_url = (await resolveMediaUrl(profile.avatar_url)) ?? profile.avatar_url
    }
    return profile
  }

  // Helper to fetch group conversation info
  const fetchGroupConversation = async (conversationId: string) => {
    const { data: groupConversation } = await supabase
      .from('conversations')
      .select('name, avatar_url')
      .eq('id', conversationId)
      .maybeSingle()
    if (groupConversation?.avatar_url) {
      groupConversation.avatar_url = (await resolveMediaUrl(groupConversation.avatar_url)) ?? groupConversation.avatar_url
    }
    return groupConversation
  }

  const handleIncomingSignal = async (signal: CallSignal) => {
    switch (signal.type) {
      case 'offer':
        await handleOfferSignal(signal)
        break
      case 'group-call-invite':
        await handleGroupCallInviteSignal(signal)
        break
      case 'answer':
        await handleAnswerSignal(signal)
        break
      case 'ice-candidate':
        await handleIceCandidateSignal(signal)
        break
      case 'call-end':
        endCall(false)
        break
      case 'media-state-update':
        handleMediaStateUpdateSignal(signal)
        break
    }
  }

  // Handle offer signal
  const handleOfferSignal = async (signal: CallSignal) => {
    // Check if this is a renegotiation for the current call
    if (isInCall && (signal.conversation_id === currentCallConversationId || signal.from === currentCallUserId)) {
      console.log('📞 CallContext: Received renegotiation offer');
      if (webrtcManager) {
        const answer = await webrtcManager.createAnswer(signal.data);
        await sendSignal({
          type: 'answer',
          from: user?.id ?? "",
          to: signal.from,
          data: answer,
          conversation_id: signal.conversation_id,
        });
      }
      return;
    }

    // Appel entrant
    setIncomingCallSignal(signal)
    setIsRinging(true)
    
    // Récupérer le nom et l'avatar de l'appelant
    const profile = await fetchCallerProfile(signal.from)
    const callerName = profile?.display_name || profile?.username || 'Quelqu\'un'
    const callerAvatar = profile?.avatar_url || undefined
    const isVideo = signal.data?.video || false

    setIncomingCall({
      from: signal.from,
      conversationId: signal.conversation_id,
      isVideo,
      callerName,
      callerAvatar
    })

    // Envoyer une notification
    if ('Notification' in globalThis && Notification.permission === 'granted') {
      showIncomingCallNotification(callerName, isVideo, signal.conversation_id, signal.from)
    }
  }

  // Handle group call invite signal
  const handleGroupCallInviteSignal = async (signal: CallSignal) => {
    setIsRinging(true)
    
    // Récupérer le nom et l'avatar de l'appelant
    const callerProfile = await fetchCallerProfile(signal.from)

    // Récupérer les infos du groupe
    const groupConversation = await fetchGroupConversation(signal.conversation_id)

    const groupCallerName = callerProfile?.display_name || callerProfile?.username || 'Quelqu\'un'
    const groupName = groupConversation?.name || 'Groupe'
    const groupAvatar = groupConversation?.avatar_url || undefined
    const isGroupVideo = signal.data?.video || false

    // Store the group call info for joining
    setIncomingCallSignal(signal)
    setIncomingCall({
      from: signal.from,
      conversationId: signal.conversation_id,
      isVideo: isGroupVideo,
      callerName: `${groupCallerName} (${groupName})`,
      callerAvatar: groupAvatar,
      isGroupCall: true
    })

    // Envoyer une notification
    if ('Notification' in globalThis && Notification.permission === 'granted') {
      showGroupCallNotification(groupCallerName, groupName, isGroupVideo, signal.conversation_id, signal.from)
    }
  }

  // Handle answer signal
  const handleAnswerSignal = async (signal: CallSignal) => {
    if (webrtcManager) {
      await webrtcManager.handleAnswer(signal.data)
      setIsCalling(false)
      setIsInCall(true)
      await processIceCandidateQueue()
    }
  }

  // Handle ICE candidate signal
  const handleIceCandidateSignal = async (signal: CallSignal) => {
    if (!signal.data) return

    const canAddCandidate = isPeerConnectionReady && webrtcManager.hasRemoteDescription()
    
    if (canAddCandidate) {
      try {
        await webrtcManager.addIceCandidate(signal.data)
      } catch (error) {
        console.error('Error adding ICE candidate:', error)
        iceCandidateQueueRef.current.push({
          candidate: signal.data,
          timestamp: Date.now()
        })
      }
    } else {
      console.log('Queueing ICE candidate (PC not ready or no remote description)')
      iceCandidateQueueRef.current.push({
        candidate: signal.data,
        timestamp: Date.now()
      })
    }
  }

  // Handle media state update signal
  const handleMediaStateUpdateSignal = (signal: CallSignal) => {
    if (signal.data?.video !== undefined) {
      setRemoteVideoEnabled(signal.data.video)
    }
  }

  const sendSignal = async (signal: CallSignal) => {
    if (channelRef) {
      try {
        const status = await channelRef.send({
          type: 'broadcast',
          event: 'call-signal',
          payload: signal,
        })

        if (status !== 'ok') {
          console.error('❌ CallContext: Failed to send signal', signal.type, 'status:', status)
        }
      } catch (error) {
        console.error('❌ CallContext: Error sending signal:', error)
      }
    } else {
      console.warn('⚠️ CallContext: Cannot send signal, channel not initialized', signal.type)
    }
  }

  const startCall = async (userId: string, conversationId: string, config: CallConfig) => {
    // Résolution robuste de l'identité (fallback session Supabase si le
    // contexte React n'a pas encore hydraté le user — voir resolveCurrentUserId).
    const callerId = await resolveCurrentUserId()
    try {
      // DEMANDER EXPLICITEMENT les permissions sur mobile
      if (typeof globalThis !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          const testStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: config.video
          })
          
          // Arrêter le stream de test immédiatement
          testStream.getTracks().forEach(track => track.stop())
        } catch (permError: any) {
          console.error('Permission denied:', permError.name, permError.message)
          
          let errorMsg = '❌ Permissions requises\n\nPour appeler, vous devez autoriser :\n'
          
          if (permError.name === 'NotAllowedError') {
            errorMsg += '• Caméra et Microphone\n\nSur Chrome Mobile :\n1. Appuyez sur 🔒 à côté de l\'URL\n2. Activez "Caméra" et "Microphone"'
          } else {
            errorMsg += '• Caméra et/ou Microphone\n\nAutorisez l\'accès dans les paramètres de votre navigateur.'
          }
          
          alert(errorMsg)
          setIsCalling(false)
          return
        }
      }
      
      setIsCalling(true)
      setIsPeerConnectionReady(false)
      iceCandidateQueueRef.current = []
      
      setCurrentCallUserId(userId)
      setCurrentCallConversationId(conversationId)

      // Récupérer le nom et l'avatar de la personne qu'on appelle
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, username, avatar_url')
        .eq('id', userId)
        .maybeSingle()

      const calleeName = profile?.display_name || profile?.username || 'Utilisateur'
      const calleeAvatar = profile?.avatar_url
        ? ((await resolveMediaUrl(profile.avatar_url)) ?? profile.avatar_url)
        : undefined

      setIncomingCall({
        from: userId,
        conversationId: conversationId,
        isVideo: config.video,
        callerName: calleeName,
        callerAvatar: calleeAvatar
      })

      const stream = await webrtcManager.initializeCall(config)
      setLocalStream(stream)
      setAudioEnabled(config.audio)
      setVideoEnabled(config.video)
      setRemoteVideoEnabled(true) // Reset remote video state

      // Listen for local stream updates (e.g. when toggling video)
      webrtcManager.onLocalStream((updatedStream) => {
        setLocalStream(new MediaStream(updatedStream.getTracks()))
      })

      // Note: Renegotiation is no longer needed for video toggle
      // We use replaceTrack which doesn't require renegotiation

      setIsPeerConnectionReady(true)

      const offer = await webrtcManager.createOffer()

      await sendSignal({
        type: 'offer',
        from: callerId,
        to: userId,
        data: { ...offer, video: config.video },
        conversation_id: conversationId,
      })

      webrtcManager.onIceCandidate(async (candidate) => {
        await sendSignal({
          type: 'ice-candidate',
          from: callerId,
          to: userId,
          data: candidate,
          conversation_id: conversationId,
        })
      })

      webrtcManager.onRemoteStream((...args) => {
        // Create a new MediaStream object to force React to detect the change
        // This is crucial when tracks are added to an existing stream
        const stream = args[0];
        setRemoteStream(new MediaStream(stream.getTracks()));
      })

      // Add ICE restart handler for better stability
      webrtcManager.onIceConnectionStateChange(async (state) => {
        if (state === 'failed' || state === 'disconnected') {
           console.log('Attempting ICE restart...');
           try {
             const offer = await webrtcManager.restartIce();
             await sendSignal({
               type: 'offer',
               from: callerId,
               to: userId,
               data: { ...offer, video: config.video },
               conversation_id: conversationId,
             });
           } catch (e) {
             console.error('ICE restart failed:', e);
           }
        }
      })

      webrtcManager.onCallEnd(() => {
        endCall()
      })

      const { data: callLogData, error: callLogError } = await supabase.from('call_logs').insert({
        conversation_id: conversationId,
        caller_id: callerId,
        callee_id: userId,
        type: config.video ? 'video' : 'audio',
        status: 'initiated',
      }).select()
      
      if (!callLogError && callLogData) {
        // Dispatch a custom event to notify ChatViewPage to reload call logs
        globalThis.dispatchEvent(new CustomEvent('call-log-created', {
          detail: { conversationId, callLog: callLogData?.[0] }
        }))
      }
    } catch (error) {
      console.error('Error starting call:', error)
      setIsCalling(false)
      throw error
    }
  }

  const answerCall = async () => {
    if (!incomingCallSignal) return
    if (!user?.id) {
      console.warn('[Call] answerCall called without authenticated user')
      return
    }

    // If it's a group call, use the group call answer flow
    if (incomingCall?.isGroupCall) {
      await answerGroupCall()
      return
    }

    try {
      setIsRinging(false)
      setIsInCall(true)
      setIsPeerConnectionReady(false)
      
      // IMPORTANT: Save the caller info BEFORE clearing incomingCallSignal
      // This is needed so endCall() can send the call-end signal to the right person
      setCurrentCallUserId(incomingCallSignal.from)
      setCurrentCallConversationId(incomingCallSignal.conversation_id)

      const config: CallConfig = {
        audio: true,
        video: incomingCallSignal.data.video || false,
      }
      
      const stream = await webrtcManager.initializeCall(config)
      setLocalStream(stream)
      setVideoEnabled(config.video) // Sync video state with accepted call config
      setRemoteVideoEnabled(incomingCallSignal.data.video !== false)

      // Listen for local stream updates
      webrtcManager.onLocalStream((updatedStream) => {
        setLocalStream(new MediaStream(updatedStream.getTracks()))
      })

      // Note: Renegotiation is no longer needed for video toggle
      // We use replaceTrack which doesn't require renegotiation

      // FIX: Set up callbacks AFTER initializeCall to ensure they aren't cleared by internal cleanup
      webrtcManager.onRemoteStream((...args) => {
        const stream = args[0];
        // Create a new MediaStream object to force React to detect the change
        setRemoteStream(new MediaStream(stream.getTracks()));
      })

      webrtcManager.onCallEnd(() => {
        endCall()
      })

      // Add ICE restart handler for better stability
      webrtcManager.onIceConnectionStateChange(async (state) => {
        if (state === 'failed' || state === 'disconnected') {
           console.log('Attempting ICE restart...');
           try {
             const offer = await webrtcManager.restartIce();
             await sendSignal({
               type: 'offer',
               from: user?.id ?? "",
               to: incomingCallSignal.from,
               data: { ...offer, video: config.video },
               conversation_id: incomingCallSignal.conversation_id,
             });
           } catch (e) {
             console.error('ICE restart failed:', e);
           }
        }
      })

      webrtcManager.onIceCandidate(async (candidate) => {
        await sendSignal({
          type: 'ice-candidate',
          from: user?.id ?? "",
          to: incomingCallSignal.from,
          data: candidate,
          conversation_id: incomingCallSignal.conversation_id,
        })
      })

      // FIX: Set isPeerConnectionReady to true immediately after initializeCall
      // This ensures ICE candidates can be processed as soon as they arrive
      setIsPeerConnectionReady(true)

      // Note: We do NOT process the queue here yet because createAnswer hasn't been called,
      // so the remote description hasn't been set.

      const answer = await webrtcManager.createAnswer(incomingCallSignal.data)

      // Process any ICE candidates that arrived during initialization/createAnswer
      // Now that createAnswer has set the remote description, we can safely add candidates
      await processIceCandidateQueue()

      await sendSignal({
        type: 'answer',
        from: user?.id ?? "",
        to: incomingCallSignal.from,
        data: answer,
        conversation_id: incomingCallSignal.conversation_id,
      })

      const { data: answerCallLogData, error: answerCallLogError } = await supabase.from('call_logs').insert({
        conversation_id: incomingCallSignal.conversation_id,
        caller_id: incomingCallSignal.from,
        callee_id: user?.id ?? "",
        type: config.video ? 'video' : 'audio',
        status: 'answered',
      }).select()
      
      if (!answerCallLogError && answerCallLogData) {
        // Dispatch a custom event to notify ChatViewPage to reload call logs
        globalThis.dispatchEvent(new CustomEvent('call-log-created', {
          detail: { conversationId: incomingCallSignal.conversation_id, callLog: answerCallLogData?.[0] }
        }))
      }

      setIncomingCallSignal(null)
      // NE PAS effacer incomingCall - on en a besoin pour afficher le nom pendant l'appel
    } catch (error) {
      console.error('Error answering call:', error)
      setIsRinging(false)
      throw error
    }
  }

  const rejectCall = async () => {
    if (incomingCallSignal) {
      // For group calls, we just dismiss the notification without sending a signal
      if (!incomingCall?.isGroupCall && user?.id) {
        await sendSignal({
          type: 'call-end',
          from: user.id,
          to: incomingCallSignal.from,
          data: { reason: 'rejected' },
          conversation_id: incomingCallSignal.conversation_id,
        })
      }

      setIsRinging(false)
      setIncomingCallSignal(null)
      setIncomingCall(null)
    }
  }

  const addParticipant = async (contactId: string) => {
    if (!user) return

    try {
      console.log('📞 addParticipant called, contactId:', contactId)
      console.log('📞 Current state: isGroupCall:', isGroupCall, 'isInCall:', isInCall, 'currentCallUserId:', currentCallUserId)
      
      // Get the new participant's profile
      const { data: newProfile } = await supabase
        .from('profiles')
        .select('display_name, username, avatar_url')
        .eq('id', contactId)
        .single()
      
      const newName = newProfile?.display_name || newProfile?.username || 'Nouveau'

      if (isGroupCall && currentCallConversationId) {
        // --- SCENARIO 1: ALREADY IN GROUP CALL ---
        // Just send an invite to the new person
        console.log('📞 Adding participant to existing group call:', contactId)
        
        // Get conversation info for the invite
        const { data: conversation } = await supabase
          .from('conversations')
          .select('name, avatar_url')
          .eq('id', currentCallConversationId)
          .single()

        await sendSignal({
          type: 'group-call-invite',
          from: user.id,
          to: contactId,
          data: {
            video: videoEnabled,
            conversationName: conversation?.name || 'Appel de groupe',
            conversationAvatar: conversation?.avatar_url,
          },
          conversation_id: currentCallConversationId,
        })

        console.log('📞 Invite sent to:', contactId)

      } else if (isInCall && currentCallUserId && currentCallConversationId) {
        // --- SCENARIO 2: 1-ON-1 CALL -> INVITE NEW PERSON ---
        // DON'T end the current call! Just send an invite to the new person
        // They will join as a third participant
        console.log('📞 Inviting new participant to 1-on-1 call:', contactId)
        
        // Get current peer's profile for the invite message
        const { data: peerProfile } = await supabase
          .from('profiles')
          .select('display_name, username')
          .eq('id', currentCallUserId)
          .single()
        
        const peerName = peerProfile?.display_name || peerProfile?.username || 'Utilisateur'
        
        // Send a group call invite to the new person
        // Use the current conversation ID so they can join
        await sendSignal({
          type: 'group-call-invite',
          from: user.id,
          to: contactId,
          data: {
            video: videoEnabled,
            conversationName: `Appel avec ${peerName}`,
            existingCallPeer: currentCallUserId, // Let them know who else is in the call
          },
          conversation_id: currentCallConversationId,
        })

        console.log('📞 Invite sent to:', contactId, 'to join call with', peerName)
        
        // Update the UI to show we're now in a "group-like" call
        // But keep the existing WebRTC connection with the first peer
        setIncomingCall(prev => prev ? {
          ...prev,
          callerName: `${prev.callerName}, ${newName}`,
          isGroupCall: true
        } : null)
      }
    } catch (error) {
      console.error('Error adding participant:', error)
      alert('Impossible d\'ajouter le participant')
    }
  }

  // Answer a group call (join the existing call)
  const answerGroupCall = async () => {
    if (!incomingCallSignal || !incomingCall?.isGroupCall) return
    if (!user?.id) {
      console.warn('[Call] answerGroupCall called without authenticated user')
      return
    }

    try {
      setIsRinging(false)
      
      const config: GroupCallConfig = {
        audio: true,
        video: incomingCall.isVideo,
      }
      
      // Start the group call (which will join the existing one)
      await startGroupCall(incomingCallSignal.conversation_id, config)
      
      setIncomingCallSignal(null)
    } catch (error) {
      console.error('Error joining group call:', error)
      setIsRinging(false)
      throw error
    }
  }

  const toggleAudio = (...args: any[]) => {
    const newState = !audioEnabled
    if (isGroupCall) {
      groupCallManager.toggleAudio(newState)
    } else {
      webrtcManager.toggleAudio(newState)
    }
    setAudioEnabled(newState)
  }

  const toggleVideo = async (...args: any[]) => {
    const newState = !videoEnabled
    if (isGroupCall) {
      await groupCallManager.toggleVideo(newState)
      // Update local stream reference in case it was modified
      const updatedStream = groupCallManager.getLocalStream()
      if (updatedStream) {
        setLocalStream(updatedStream)
      }
    } else {
      await webrtcManager.toggleVideo(newState)
      
      // Send signal to remote peer
      if (currentCallUserId && currentCallConversationId) {
        await sendSignal({
          type: 'media-state-update',
          from: user?.id ?? "",
          to: currentCallUserId,
          data: { video: newState },
          conversation_id: currentCallConversationId,
        })
      }
    }
    setVideoEnabled(newState)
  }

  // Helper to request media permissions
  const requestMediaPermissions = async (video: boolean): Promise<boolean> => {
    if (typeof globalThis === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return true
    }
    
    try {
      const testStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video
      })
      testStream.getTracks().forEach(track => track.stop())
      return true
    } catch (permError: any) {
      console.error('Permission denied:', permError.name, permError.message)
      
      let errorMsg = '❌ Permissions requises\n\nPour appeler, vous devez autoriser :\n'
      
      if (permError.name === 'NotAllowedError') {
        errorMsg += '• Caméra et Microphone\n\nSur Chrome Mobile :\n1. Appuyez sur 🔒 à côté de l\'URL\n2. Activez "Caméra" et "Microphone"'
      } else {
        errorMsg += '• Caméra et/ou Microphone\n\nAutorisez l\'accès dans les paramètres de votre navigateur.'
      }
      
      alert(errorMsg)
      setIsCalling(false)
      return false
    }
  }

  // Helper to send invites to group members
  const sendInvitesToGroupMembers = async (
    members: { user_id: string }[],
    conversationId: string,
    conversationName: string | undefined,
    conversationAvatar: string | undefined,
    video: boolean,
    callerId: string
  ) => {
    if (!members || members.length === 0) return
    
    for (const member of members) {
      if (member.user_id !== callerId) {
        await sendSignal({
          type: 'group-call-invite',
          from: callerId,
          to: member.user_id,
          data: {
            video,
            conversationName: conversationName || 'Groupe',
            conversationAvatar,
          },
          conversation_id: conversationId,
        })
      }
    }
  }

  // Start a group call
  const startGroupCall = async (conversationId: string, config: GroupCallConfig) => {
    // Résolution robuste de l'identité (fallback session Supabase si le
    // contexte React n'a pas encore hydraté le user).
    const callerId = await resolveCurrentUserId()
    const hasPermissions = await requestMediaPermissions(config.video)
    if (!hasPermissions) return

    try {
      setIsCalling(true)
      setIsGroupCall(true)
      setCurrentCallConversationId(conversationId)

      // Get conversation info and members for the call
      const { data: conversation } = await supabase
        .from('conversations')
        .select('name, avatar_url')
        .eq('id', conversationId)
        .maybeSingle()

      // Get all members of the group to notify them
      const { data: members } = await supabase
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', conversationId)

      const groupCallerAvatar = conversation?.avatar_url
        ? ((await resolveMediaUrl(conversation.avatar_url)) ?? conversation.avatar_url)
        : undefined

      setIncomingCall({
        from: conversationId,
        conversationId: conversationId,
        isVideo: config.video,
        callerName: conversation?.name || 'Appel de groupe',
        callerAvatar: groupCallerAvatar,
        isGroupCall: true
      })

      // Initialize group call
      const stream = await groupCallManager.initializeGroupCall(
        callerId,
        conversationId,
        config
      )
      
      setLocalStream(stream)
      setAudioEnabled(config.audio)
      setVideoEnabled(config.video)

      // Listen for local stream updates
      groupCallManager.onLocalStream((updatedStream) => {
        setLocalStream(new MediaStream(updatedStream.getTracks()))
      })

      // Set up callbacks
      groupCallManager.onParticipantUpdate((...args) => {
        const participants = args[0]
        const participantArray: GroupCallParticipant[] = []
        participants.forEach((p: any) => {
          participantArray.push({
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            stream: p.stream,
            audioEnabled: p.audioEnabled,
            videoEnabled: p.videoEnabled,
          })
        })
        setGroupParticipants(participantArray)
      })

      groupCallManager.onCallEnd(() => {
        endCall()
      })

      // Join the group call
      await groupCallManager.joinGroupCall()
      
      setIsCalling(false)
      setIsInCall(true)

      // Send group call invite to all other members
      await sendInvitesToGroupMembers(
        members || [],
        conversationId,
        conversation?.name,
        conversation?.avatar_url,
        config.video,
        callerId
      )

      // Log the call
      await logGroupCall(conversationId, config.video, callerId)
    } catch (error) {
      console.error('Error starting group call:', error)
      setIsCalling(false)
      setIsGroupCall(false)
      throw error
    }
  }

  // Helper to log group call
  const logGroupCall = async (conversationId: string, isVideo: boolean, callerId: string) => {
    const { data: callLogData, error: callLogError } = await supabase.from('call_logs').insert({
      conversation_id: conversationId,
      caller_id: callerId,
      callee_id: callerId,
      type: isVideo ? 'video' : 'audio',
      status: 'initiated',
    }).select()
    
    if (callLogError) {
      console.error('Error creating group call log:', callLogError)
    } else if (callLogData) {
      globalThis.dispatchEvent(new CustomEvent('call-log-created', {
        detail: { conversationId, callLog: callLogData?.[0] }
      }))
    }
  }

  // Helper to end group call and update call log
  const endGroupCall = async (conversationId: string | null, userId: string | undefined) => {
    const participantCount = groupCallManager.getParticipantCount()
    
    groupCallManager.leaveCall()
    setGroupParticipants([])
    setIsGroupCall(false)
    
    if (conversationId && userId) {
      try {
        const { data: callLog } = await supabase
          .from('call_logs')
          .select('id')
          .eq('conversation_id', conversationId)
          .eq('caller_id', userId)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        
        if (callLog) {
          await supabase
            .from('call_logs')
            .update({
              status: 'ended',
              ended_at: new Date().toISOString(),
              participant_count: participantCount
            })
            .eq('id', callLog.id)
        }
      } catch (e) {
        console.log('Could not update group call log with participant count:', e)
      }
    }
  }

  // Helper to end 1-to-1 call
  const endOneToOneCall = async (
    sendEndSignal: boolean,
    otherUserId: string | null | undefined,
    conversationId: string | null | undefined,
    userId: string | undefined
  ) => {
    if (sendEndSignal && otherUserId && conversationId && userId) {
      try {
        console.log('📞 CallContext: Sending call-end signal');
        await sendSignal({
          type: 'call-end',
          from: userId,
          to: otherUserId,
          data: { reason: 'ended' },
          conversation_id: conversationId,
        })
      } catch (error) {
        console.error('Error sending call-end signal:', error)
      }
    }

    console.log('📞 CallContext: Calling webrtcManager.endCall()');
    webrtcManager.endCall()
  }

  // Reset call state to initial values
  const resetCallState = () => {
    console.log('📞 CallContext: Resetting state');
    setIsInCall(false)
    setIsCalling(false)
    setIsRinging(false)
    setLocalStream(null)
    setRemoteStream(null)
    setIncomingCallSignal(null)
    setIncomingCall(null)
    setCurrentCallUserId(null)
    setCurrentCallConversationId(null)
    setIsPeerConnectionReady(false)
    iceCandidateQueueRef.current = []
  }

  // End call - handles both group and 1-to-1 calls
  const endCall = async (sendEndSignal: boolean = true) => {
    console.log('📞 CallContext: endCall initiated', { isGroupCall, sendEndSignal });
    
    const conversationId = currentCallConversationId
    const otherUserId = incomingCallSignal?.from || currentCallUserId
    
    if (isGroupCall) {
      await endGroupCall(conversationId, user?.id)
    } else {
      await endOneToOneCall(
        sendEndSignal,
        otherUserId,
        incomingCallSignal?.conversation_id || currentCallConversationId,
        user?.id
      )
    }

    resetCallState()
  }

  const value = useMemo(() => ({
    isInCall,
    isRinging,
    isCalling,
    localStream,
    remoteStream,
    audioEnabled,
    videoEnabled,
    remoteVideoEnabled,
    incomingCall,
    isGroupCall,
    groupParticipants,
    currentCallUserId,
    startCall,
    startGroupCall,
    answerCall,
    endCall,
    toggleAudio,
    toggleVideo,
    rejectCall,
    addParticipant,
  }), [isInCall, isRinging, isCalling, localStream, remoteStream, audioEnabled, videoEnabled, remoteVideoEnabled, incomingCall, isGroupCall, groupParticipants, currentCallUserId]);

  // Actions séparées : référence stable pour toute la durée de vie du
  // provider. Les consommateurs de useCallActions() ne re-render jamais
  // à cause d'un changement de stream/state d'appel.
  // useRef pour figer la référence à la première frame.
  const actionsRef = useRef<CallActions | null>(null)
  if (!actionsRef.current) {
    actionsRef.current = {
      startCall,
      startGroupCall,
      answerCall,
      endCall,
      toggleAudio,
      toggleVideo,
      rejectCall,
      addParticipant,
    }
  } else {
    // Mutation in-place pour que les méthodes capturent toujours le
    // dernier closure (state à jour) sans changer la référence de l'objet.
    actionsRef.current.startCall = startCall
    actionsRef.current.startGroupCall = startGroupCall
    actionsRef.current.answerCall = answerCall
    actionsRef.current.endCall = endCall
    actionsRef.current.toggleAudio = toggleAudio
    actionsRef.current.toggleVideo = toggleVideo
    actionsRef.current.rejectCall = rejectCall
    actionsRef.current.addParticipant = addParticipant
  }

  return (
    <CallContext.Provider value={value}>
      <CallActionsContext.Provider value={actionsRef.current}>
        {children}
      </CallActionsContext.Provider>
    </CallContext.Provider>
  )
}

export function useCall() {
  const context = useContext(CallContext)
  if (context === undefined) {
    throw new Error('useCall must be used within a CallProvider')
  }
  return context
}

/**
 * Hook léger qui ne renvoie QUE les méthodes (références stables).
 * À utiliser quand on a besoin de déclencher des actions d'appel sans
 * lire le state — évite les re-renders inutiles à chaque tick d'appel.
 */
export function useCallActions(): CallActions {
  const context = useContext(CallActionsContext)
  if (context === undefined) {
    throw new Error('useCallActions must be used within a CallProvider')
  }
  return context
}