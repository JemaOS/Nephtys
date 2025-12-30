// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { webrtcManager, CallConfig } from '@/lib/webrtc'
import { groupCallManager, Participant, GroupCallConfig } from '@/lib/groupWebRTC'
import { useAuth } from './AuthContext'

interface CallSignal {
  type: 'offer' | 'answer' | 'ice-candidate' | 'call-end' | 'group-call-invite'
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
  endCall: (sendEndSignal?: boolean) => void
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

  const handleIncomingSignal = async (signal: CallSignal) => {
    switch (signal.type) {
      case 'offer':
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

      case 'group-call-invite':
        // Appel de groupe entrant - afficher la notification
        setIsRinging(true)
        
        // Récupérer le nom et l'avatar de l'appelant
        const { data: callerProfile } = await supabase
          .from('profiles')
          .select('display_name, username, avatar_url')
          .eq('id', signal.from)
          .maybeSingle()

        // Récupérer les infos du groupe
        const { data: groupConversation } = await supabase
          .from('conversations')
          .select('name, avatar_url')
          .eq('id', signal.conversation_id)
          .maybeSingle()

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
        if ('Notification' in window && Notification.permission === 'granted') {
          const callType = isGroupVideo ? '📹 Appel vidéo de groupe' : '📞 Appel de groupe'
          
          if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.ready.then((registration) => {
              registration.showNotification(`${callType} entrant`, {
                body: `${groupCallerName} vous appelle dans ${groupName}...`,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                tag: 'incoming-group-call',
                requireInteraction: true,
                actions: [
                  { action: 'answer', title: 'Rejoindre' },
                  { action: 'reject', title: 'Ignorer' },
                ],
                data: {
                  conversationId: signal.conversation_id,
                  callerId: signal.from,
                  url: `/chat/${signal.conversation_id}`,
                  isGroupCall: true,
                },
              } as any)
              
              if ('vibrate' in navigator) {
                navigator.vibrate([200, 100, 200, 100, 200])
              }
            })
          } else {
            new Notification(`${callType} entrant`, {
              body: `${groupCallerName} vous appelle dans ${groupName}...`,
              icon: '/icon-192.png',
              tag: 'incoming-group-call',
            })
            
            if ('vibrate' in navigator) {
              navigator.vibrate([200, 100, 200, 100, 200])
            }
          }
        }
        break

      case 'answer':
        if (webrtcManager) {
          await webrtcManager.handleAnswer(signal.data)
          setIsCalling(false)
          setIsInCall(true)
          // Process any queued ICE candidates now that we have the remote description
          await processIceCandidateQueue()
        }
        break

      case 'ice-candidate':
        if (signal.data) {
          // Check if we are ready to add candidates: PC ready AND remote description set
          const canAddCandidate = isPeerConnectionReady && webrtcManager.hasRemoteDescription()
          
          if (canAddCandidate) {
            try {
              await webrtcManager.addIceCandidate(signal.data)
            } catch (error) {
              console.error('Error adding ICE candidate:', error)
              // If it failed, queue it just in case
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
        break

      case 'call-end':
        // Pass false to avoid sending another call-end signal back (would cause infinite loop)
        endCall(false)
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
      // DEMANDER EXPLICITEMENT les permissions sur mobile
      if (typeof window !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
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

      webrtcManager.onRemoteStream((...args) => {
        setRemoteStream(args[0])
      })

      webrtcManager.onCallEnd(() => {
        endCall()
      })

      const { data: callLogData, error: callLogError } = await supabase.from('call_logs').insert({
        conversation_id: conversationId,
        caller_id: user!.id,
        callee_id: userId,
        type: config.video ? 'video' : 'audio',
        status: 'initiated',
      }).select()
      
      if (!callLogError && callLogData) {
        // Dispatch a custom event to notify ChatViewPage to reload call logs
        window.dispatchEvent(new CustomEvent('call-log-created', {
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
      
      // FIX: Set up callbacks BEFORE initializeCall to ensure we don't miss any events
      webrtcManager.onRemoteStream((...args) => {
        const stream = args[0];
        setRemoteStream(stream)
      })

      webrtcManager.onCallEnd(() => {
        endCall()
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

      const stream = await webrtcManager.initializeCall(config)
      setLocalStream(stream)

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
        from: user!.id,
        to: incomingCallSignal.from,
        data: answer,
        conversation_id: incomingCallSignal.conversation_id,
      })

      const { data: answerCallLogData, error: answerCallLogError } = await supabase.from('call_logs').insert({
        conversation_id: incomingCallSignal.conversation_id,
        caller_id: incomingCallSignal.from,
        callee_id: user!.id,
        type: config.video ? 'video' : 'audio',
        status: 'answered',
      }).select()
      
      if (!answerCallLogError && answerCallLogData) {
        // Dispatch a custom event to notify ChatViewPage to reload call logs
        window.dispatchEvent(new CustomEvent('call-log-created', {
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
      if (!incomingCall?.isGroupCall) {
        await sendSignal({
          type: 'call-end',
          from: user!.id,
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

  // Answer a group call (join the existing call)
  const answerGroupCall = async () => {
    if (!incomingCallSignal || !incomingCall?.isGroupCall) return

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
      webrtcManager.toggleVideo(newState)
    }
    setVideoEnabled(newState)
  }

  // Start a group call
  const startGroupCall = async (conversationId: string, config: GroupCallConfig) => {
    try {
      // Request permissions explicitly on mobile
      if (typeof window !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          const testStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: config.video
          })
          
          // Stop test stream immediately
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
      if (members && members.length > 0) {
        for (const member of members) {
          // Don't send to ourselves
          if (member.user_id !== user!.id) {
            await sendSignal({
              type: 'group-call-invite',
              from: user!.id,
              to: member.user_id,
              data: {
                video: config.video,
                conversationName: conversation?.name || 'Groupe',
                conversationAvatar: conversation?.avatar_url,
              },
              conversation_id: conversationId,
            })
          }
        }
      }

      // Log the call - For group calls, use caller_id as callee_id (self-reference indicates group call)
      // This satisfies the NOT NULL constraint on callee_id while allowing us to identify group calls
      const { data: callLogData, error: callLogError } = await supabase.from('call_logs').insert({
        conversation_id: conversationId,
        caller_id: user!.id,
        callee_id: user!.id, // Self-reference indicates group call (caller_id === callee_id)
        type: config.video ? 'video' : 'audio',
        status: 'initiated',
      }).select()
      
      if (callLogError) {
        console.error('Error creating group call log:', callLogError)
      } else if (callLogData) {
        // Dispatch a custom event to notify ChatViewPage to reload call logs
        window.dispatchEvent(new CustomEvent('call-log-created', {
          detail: { conversationId, callLog: callLogData?.[0] }
        }))
      }
    } catch (error) {
      console.error('Error starting group call:', error)
      setIsCalling(false)
      setIsGroupCall(false)
      throw error
    }
  }

  // End call - handles both group and 1-to-1 calls
  const endCall = async (sendEndSignal: boolean = true) => {
    console.log('📞 CallContext: endCall initiated', { isGroupCall, sendEndSignal });
    
    if (isGroupCall) {
      // Get participant count before leaving
      const participantCount = groupCallManager.getParticipantCount()
      const conversationId = currentCallConversationId
      
      // End group call
      groupCallManager.leaveCall()
      setGroupParticipants([])
      setIsGroupCall(false)
      
      // Update call log with participant count (if we have a conversation ID)
      if (conversationId && user) {
        try {
          // Find the most recent call log for this conversation and update it
          const { data: callLog } = await supabase
            .from('call_logs')
            .select('id')
            .eq('conversation_id', conversationId)
            .eq('caller_id', user.id)
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
    } else {
      // End 1-to-1 call
      const otherUserId = incomingCallSignal?.from || currentCallUserId
      const conversationId = incomingCallSignal?.conversation_id || currentCallConversationId
      
      // Only send end signal if we initiated the hang up (not if we received call-end from remote)
      if (sendEndSignal && otherUserId && conversationId && user) {
        try {
          console.log('📞 CallContext: Sending call-end signal');
          await sendSignal({
            type: 'call-end',
            from: user.id,
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

    console.log('📞 CallContext: Resetting state');
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