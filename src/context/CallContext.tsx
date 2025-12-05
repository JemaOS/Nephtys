// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { webrtcManager, CallConfig } from '@/lib/webrtc'
import { groupCallManager, Participant, GroupCallConfig } from '@/lib/groupWebRTC'
import { useAuth } from './AuthContext'

interface CallSignal {
  type: 'offer' | 'answer' | 'ice-candidate' | 'call-end'
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
  incomingCall: IncomingCall | null
  // Group call specific
  isGroupCall: boolean
  groupParticipants: GroupCallParticipant[]
  // Methods
  startCall: (userId: string, conversationId: string, config: CallConfig) => Promise<void>
  startGroupCall: (conversationId: string, config: GroupCallConfig) => Promise<void>
  answerCall: () => Promise<void>
  endCall: () => void
  toggleAudio: () => void
  toggleVideo: () => void
  rejectCall: () => void
}

const CallContext = createContext<CallContextType | undefined>(undefined)

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [isInCall, setIsInCall] = useState(false)
  const [isRinging, setIsRinging] = useState(false)
  const [isCalling, setIsCalling] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [videoEnabled, setVideoEnabled] = useState(true)
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

  // Subscribe to call signals globally
  useEffect(() => {
    if (!user) return

    console.log('🔔 CallContext: Setting up global call listener for user:', user.id)

    const channel = supabase
      .channel('global-webrtc-signals')
      .on('broadcast', { event: 'call-signal' }, async (payload) => {
        const signal = payload.payload as CallSignal
        
        // DEBUG: Log full details for diagnosis
        console.log('🔔 CallContext: === SIGNAL RECEIVED ===')
        console.log('🔔 CallContext: Signal type:', signal.type)
        console.log('🔔 CallContext: Signal from:', signal.from)
        console.log('🔔 CallContext: Signal to:', signal.to)
        console.log('🔔 CallContext: Current user.id:', user?.id)
        console.log('🔔 CallContext: user object:', user)
        console.log('🔔 CallContext: Comparison (signal.from === user.id):', signal.from === user?.id)
        console.log('🔔 CallContext: Comparison (signal.to === user.id):', signal.to === user?.id)
        console.log('🔔 CallContext: typeof signal.from:', typeof signal.from)
        console.log('🔔 CallContext: typeof user.id:', typeof user?.id)
        
        // Ignorer nos propres signaux
        if (signal.from === user?.id) {
          console.log('🔔 CallContext: ❌ Ignoring own signal (from matches our user.id)')
          return
        }
        
        // Traiter uniquement les signaux qui nous sont destinés
        if (signal.to !== user?.id) {
          console.log('🔔 CallContext: ❌ Signal not for us (to does not match our user.id)')
          return
        }

        console.log('🔔 CallContext: ✅ Processing signal for us')
        handleIncomingSignal(signal)
      })
      .subscribe((status) => {
        console.log('🔔 CallContext: Channel subscription status:', status)
      })

    setChannelRef(channel)

    return () => {
      console.log('🔔 CallContext: Cleaning up channel')
      supabase.removeChannel(channel)
    }
  }, [user])

  const handleIncomingSignal = async (signal: CallSignal) => {
    console.log('🔔 CallContext: handleIncomingSignal:', signal.type)

    switch (signal.type) {
      case 'offer':
        console.log('🔔 CallContext: Incoming call offer')
        // Appel entrant
        setIncomingCallSignal(signal)
        setIsRinging(true)
        
        // Récupérer le nom et l'avatar de l'appelant
        const { data: profile } = await supabase
          .from('profiles')
          .select('display_name, username, avatar_url')
          .eq('id', signal.from)
          .maybeSingle()

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
        if ('Notification' in window && Notification.permission === 'granted') {
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
                  conversationId: signal.conversation_id,
                  callerId: signal.from,
                  url: `/chat/${signal.conversation_id}`,
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
        break

      case 'answer':
        console.log('🔔 CallContext: Call answered')
        if (webrtcManager) {
          await webrtcManager.handleAnswer(signal.data)
          setIsCalling(false)
          setIsInCall(true)
        }
        break

      case 'ice-candidate':
        // NE PAS logger pour éviter le spam
        if (signal.data) {
          if (isPeerConnectionReady) {
            try {
              await webrtcManager.addIceCandidate(signal.data)
            } catch (error) {
              console.error('Error adding ICE candidate:', error)
            }
          } else {
            // Utiliser une ref au lieu de state pour éviter les re-renders
            iceCandidateQueueRef.current.push({
              candidate: signal.data,
              timestamp: Date.now()
            })
          }
        }
        break

      case 'call-end':
        console.log('🔔 CallContext: Call ended by remote')
        endCall()
        break
    }
  }

  const sendSignal = async (signal: CallSignal) => {
    if (channelRef) {
      await channelRef.send({
        type: 'broadcast',
        event: 'call-signal',
        payload: signal,
      })
    }
  }

  const startCall = async (userId: string, conversationId: string, config: CallConfig) => {
    try {
      console.log('📞 Starting call to:', userId)
      
      // DEMANDER EXPLICITEMENT les permissions sur mobile
      if (typeof window !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          console.log('📱 Mobile: Requesting permissions explicitly...')
          const testStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: config.video
          })
          
          // Arrêter le stream de test immédiatement
          testStream.getTracks().forEach(track => track.stop())
          console.log('✅ Permissions granted')
        } catch (permError: any) {
          console.error('❌ Permission denied:', permError.name, permError.message)
          
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
      const calleeAvatar = profile?.avatar_url || undefined

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

      setIsPeerConnectionReady(true)

      const offer = await webrtcManager.createOffer()

      await sendSignal({
        type: 'offer',
        from: user!.id,
        to: userId,
        data: { ...offer, video: config.video },
        conversation_id: conversationId,
      })

      webrtcManager.onIceCandidate(async (candidate) => {
        await sendSignal({
          type: 'ice-candidate',
          from: user!.id,
          to: userId,
          data: candidate,
          conversation_id: conversationId,
        })
      })

      webrtcManager.onRemoteStream((stream) => {
        console.log('📞 Remote stream received (caller side)')
        setRemoteStream(stream)
      })

      webrtcManager.onCallEnd(() => {
        endCall()
      })

      await supabase.from('call_logs').insert({
        conversation_id: conversationId,
        caller_id: user!.id,
        callee_id: userId,
        type: config.video ? 'video' : 'audio',
        status: 'initiated',
      })
    } catch (error) {
      console.error('Error starting call:', error)
      setIsCalling(false)
      throw error
    }
  }

  const answerCall = async () => {
    if (!incomingCallSignal) return

    try {
      console.log('📞 Answering call')
      setIsRinging(false)
      setIsInCall(true)
      setIsPeerConnectionReady(false)

      const config: CallConfig = {
        audio: true,
        video: incomingCallSignal.data.video || false,
      }
      
      const stream = await webrtcManager.initializeCall(config)
      setLocalStream(stream)

      // Configurer les callbacks AVANT de créer l'answer
      webrtcManager.onRemoteStream((stream) => {
        console.log('📞 Remote stream received')
        setRemoteStream(stream)
      })

      webrtcManager.onIceCandidate(async (candidate) => {
        await sendSignal({
          type: 'ice-candidate',
          from: user!.id,
          to: incomingCallSignal.from,
          data: candidate,
          conversation_id: incomingCallSignal.conversation_id,
        })
      })

      const answer = await webrtcManager.createAnswer(incomingCallSignal.data)

      setIsPeerConnectionReady(true)

      if (iceCandidateQueueRef.current.length > 0) {
        console.log(`Processing ${iceCandidateQueueRef.current.length} queued ICE candidates`)
        for (const { candidate } of iceCandidateQueueRef.current) {
          try {
            await webrtcManager.addIceCandidate(candidate)
          } catch (error) {
            console.error('Error adding queued ICE candidate:', error)
          }
        }
        // Vider la queue
        iceCandidateQueueRef.current = []
      }

      await sendSignal({
        type: 'answer',
        from: user!.id,
        to: incomingCallSignal.from,
        data: answer,
        conversation_id: incomingCallSignal.conversation_id,
      })

      await supabase.from('call_logs').insert({
        conversation_id: incomingCallSignal.conversation_id,
        caller_id: incomingCallSignal.from,
        callee_id: user!.id,
        type: config.video ? 'video' : 'audio',
        status: 'answered',
      })

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
      await sendSignal({
        type: 'call-end',
        from: user!.id,
        to: incomingCallSignal.from,
        data: { reason: 'rejected' },
        conversation_id: incomingCallSignal.conversation_id,
      })

      setIsRinging(false)
      setIncomingCallSignal(null)
      setIncomingCall(null)
    }
  }

  const toggleAudio = () => {
    const newState = !audioEnabled
    if (isGroupCall) {
      groupCallManager.toggleAudio(newState)
    } else {
      webrtcManager.toggleAudio(newState)
    }
    setAudioEnabled(newState)
  }

  const toggleVideo = () => {
    const newState = !videoEnabled
    if (isGroupCall) {
      groupCallManager.toggleVideo(newState)
    } else {
      webrtcManager.toggleVideo(newState)
    }
    setVideoEnabled(newState)
  }

  // Start a group call
  const startGroupCall = async (conversationId: string, config: GroupCallConfig) => {
    try {
      console.log('📞 Starting group call for conversation:', conversationId)
      
      // Request permissions explicitly on mobile
      if (typeof window !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          console.log('📱 Mobile: Requesting permissions explicitly...')
          const testStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: config.video
          })
          
          // Stop test stream immediately
          testStream.getTracks().forEach(track => track.stop())
          console.log('✅ Permissions granted')
        } catch (permError: any) {
          console.error('❌ Permission denied:', permError.name, permError.message)
          
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
      setIsGroupCall(true)
      setCurrentCallConversationId(conversationId)

      // Get conversation info for the call
      const { data: conversation } = await supabase
        .from('conversations')
        .select('name, avatar_url')
        .eq('id', conversationId)
        .maybeSingle()

      setIncomingCall({
        from: conversationId,
        conversationId: conversationId,
        isVideo: config.video,
        callerName: conversation?.name || 'Appel de groupe',
        callerAvatar: conversation?.avatar_url,
        isGroupCall: true
      })

      // Initialize group call
      const stream = await groupCallManager.initializeGroupCall(
        user!.id,
        conversationId,
        config
      )
      
      setLocalStream(stream)
      setAudioEnabled(config.audio)
      setVideoEnabled(config.video)

      // Set up callbacks
      groupCallManager.onParticipantUpdate((participants) => {
        const participantArray: GroupCallParticipant[] = []
        participants.forEach((p) => {
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

      // Log the call
      await supabase.from('call_logs').insert({
        conversation_id: conversationId,
        caller_id: user!.id,
        type: config.video ? 'video' : 'audio',
        status: 'initiated',
        is_group_call: true,
      })
    } catch (error) {
      console.error('Error starting group call:', error)
      setIsCalling(false)
      setIsGroupCall(false)
      throw error
    }
  }

  // End call - handles both group and 1-to-1 calls
  const endCall = () => {
    if (isGroupCall) {
      // End group call
      groupCallManager.leaveCall()
      setGroupParticipants([])
      setIsGroupCall(false)
    } else {
      // End 1-to-1 call
      const otherUserId = incomingCallSignal?.from || currentCallUserId
      const conversationId = incomingCallSignal?.conversation_id || currentCallConversationId
      
      if (otherUserId && conversationId) {
        sendSignal({
          type: 'call-end',
          from: user!.id,
          to: otherUserId,
          data: { reason: 'ended' },
          conversation_id: conversationId,
        })
      }

      webrtcManager.endCall()
    }

    // Reset common state
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

  return (
    <CallContext.Provider value={{
      isInCall,
      isRinging,
      isCalling,
      localStream,
      remoteStream,
      audioEnabled,
      videoEnabled,
      incomingCall,
      isGroupCall,
      groupParticipants,
      startCall,
      startGroupCall,
      answerCall,
      endCall,
      toggleAudio,
      toggleVideo,
      rejectCall,
    }}>
      {children}
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