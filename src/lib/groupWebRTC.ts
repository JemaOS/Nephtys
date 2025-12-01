// Group WebRTC Manager for Audio/Video Group Calls
// Uses mesh topology where each participant connects to every other participant

import { supabase } from './supabase';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export interface GroupCallConfig {
  audio: boolean;
  video: boolean;
}

export interface Participant {
  id: string;
  name: string;
  avatar?: string;
  stream?: MediaStream;
  peerConnection?: RTCPeerConnection;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

export interface GroupCallSignal {
  type: 'group-offer' | 'group-answer' | 'group-ice-candidate' | 'group-join' | 'group-leave' | 'group-end';
  from: string;
  to?: string; // Optional - if not set, broadcast to all
  conversationId: string;
  data: any;
}

type ParticipantUpdateCallback = (participants: Map<string, Participant>) => void;
type LocalStreamCallback = (stream: MediaStream) => void;
type CallEndCallback = () => void;
type ErrorCallback = (error: Error) => void;

export class GroupCallManager {
  private localStream: MediaStream | null = null;
  private participants: Map<string, Participant> = new Map();
  private currentUserId: string = '';
  private conversationId: string = '';
  private config: GroupCallConfig = { audio: true, video: false };
  private channel: any = null;
  private iceCandidateQueues: Map<string, RTCIceCandidateInit[]> = new Map();
  
  // Callbacks
  private onParticipantUpdateCallback: ParticipantUpdateCallback | null = null;
  private onLocalStreamCallback: LocalStreamCallback | null = null;
  private onCallEndCallback: CallEndCallback | null = null;
  private onErrorCallback: ErrorCallback | null = null;

  constructor() {
    this.participants = new Map();
    this.iceCandidateQueues = new Map();
  }

  // Initialize the group call
  async initializeGroupCall(
    userId: string,
    conversationId: string,
    config: GroupCallConfig
  ): Promise<MediaStream> {
    console.log('🎥 GroupWebRTC: Initializing group call for user:', userId);
    
    this.currentUserId = userId;
    this.conversationId = conversationId;
    this.config = config;

    try {
      // Get local media stream
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: config.audio,
        video: config.video ? {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        } : false,
      });

      console.log('🎥 GroupWebRTC: Local stream obtained:', this.localStream.getTracks().length, 'tracks');

      // Set up signaling channel
      await this.setupSignalingChannel();

      // Notify callback
      this.onLocalStreamCallback?.(this.localStream);

      return this.localStream;
    } catch (error) {
      console.error('🎥 GroupWebRTC: Error initializing group call:', error);
      throw error;
    }
  }

  // Set up Supabase Realtime channel for signaling
  private async setupSignalingChannel(): Promise<void> {
    const channelName = `group-call-${this.conversationId}`;
    console.log('🎥 GroupWebRTC: Setting up signaling channel:', channelName);

    this.channel = supabase
      .channel(channelName)
      .on('broadcast', { event: 'group-signal' }, async (payload) => {
        const signal = payload.payload as GroupCallSignal;
        
        // Ignore our own signals
        if (signal.from === this.currentUserId) return;
        
        // If signal has a specific target and it's not us, ignore
        if (signal.to && signal.to !== this.currentUserId) return;

        await this.handleSignal(signal);
      })
      .subscribe((status) => {
        console.log('🎥 GroupWebRTC: Channel subscription status:', status);
      });
  }

  // Handle incoming signals
  private async handleSignal(signal: GroupCallSignal): Promise<void> {
    console.log('🎥 GroupWebRTC: Received signal:', signal.type, 'from:', signal.from);

    switch (signal.type) {
      case 'group-join':
        await this.handleParticipantJoin(signal);
        break;
      case 'group-offer':
        await this.handleOffer(signal);
        break;
      case 'group-answer':
        await this.handleAnswer(signal);
        break;
      case 'group-ice-candidate':
        await this.handleIceCandidate(signal);
        break;
      case 'group-leave':
        this.handleParticipantLeave(signal.from);
        break;
      case 'group-end':
        this.endCall();
        break;
    }
  }

  // Join an existing group call
  async joinGroupCall(): Promise<void> {
    console.log('🎥 GroupWebRTC: Joining group call');

    // Broadcast join signal to all participants
    await this.sendSignal({
      type: 'group-join',
      from: this.currentUserId,
      conversationId: this.conversationId,
      data: {
        audio: this.config.audio,
        video: this.config.video,
      },
    });
  }

  // Handle when a new participant joins
  private async handleParticipantJoin(signal: GroupCallSignal): Promise<void> {
    const participantId = signal.from;
    console.log('🎥 GroupWebRTC: Participant joining:', participantId);

    // Create peer connection for this participant
    const peerConnection = await this.createPeerConnection(participantId);

    // Add participant to our list
    this.participants.set(participantId, {
      id: participantId,
      name: signal.data.name || 'Participant',
      avatar: signal.data.avatar,
      peerConnection,
      audioEnabled: signal.data.audio,
      videoEnabled: signal.data.video,
    });

    // Create and send offer to the new participant
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await this.sendSignal({
      type: 'group-offer',
      from: this.currentUserId,
      to: participantId,
      conversationId: this.conversationId,
      data: offer,
    });

    this.notifyParticipantUpdate();
  }

  // Handle incoming offer
  private async handleOffer(signal: GroupCallSignal): Promise<void> {
    const participantId = signal.from;
    console.log('🎥 GroupWebRTC: Handling offer from:', participantId);

    // Create peer connection if not exists
    let peerConnection = this.participants.get(participantId)?.peerConnection;
    
    if (!peerConnection) {
      peerConnection = await this.createPeerConnection(participantId);
      this.participants.set(participantId, {
        id: participantId,
        name: 'Participant',
        peerConnection,
        audioEnabled: true,
        videoEnabled: this.config.video,
      });
    }

    // Set remote description
    await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.data));

    // Process queued ICE candidates
    await this.processQueuedIceCandidates(participantId);

    // Create and send answer
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    await this.sendSignal({
      type: 'group-answer',
      from: this.currentUserId,
      to: participantId,
      conversationId: this.conversationId,
      data: answer,
    });

    this.notifyParticipantUpdate();
  }

  // Handle incoming answer
  private async handleAnswer(signal: GroupCallSignal): Promise<void> {
    const participantId = signal.from;
    console.log('🎥 GroupWebRTC: Handling answer from:', participantId);

    const participant = this.participants.get(participantId);
    if (!participant?.peerConnection) {
      console.error('🎥 GroupWebRTC: No peer connection for participant:', participantId);
      return;
    }

    await participant.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.data));

    // Process queued ICE candidates
    await this.processQueuedIceCandidates(participantId);
  }

  // Handle incoming ICE candidate
  private async handleIceCandidate(signal: GroupCallSignal): Promise<void> {
    const participantId = signal.from;
    const participant = this.participants.get(participantId);

    if (!participant?.peerConnection || !participant.peerConnection.remoteDescription) {
      // Queue the ICE candidate
      if (!this.iceCandidateQueues.has(participantId)) {
        this.iceCandidateQueues.set(participantId, []);
      }
      this.iceCandidateQueues.get(participantId)!.push(signal.data);
      return;
    }

    try {
      await participant.peerConnection.addIceCandidate(new RTCIceCandidate(signal.data));
    } catch (error) {
      console.error('🎥 GroupWebRTC: Error adding ICE candidate:', error);
    }
  }

  // Process queued ICE candidates
  private async processQueuedIceCandidates(participantId: string): Promise<void> {
    const queue = this.iceCandidateQueues.get(participantId);
    if (!queue || queue.length === 0) return;

    const participant = this.participants.get(participantId);
    if (!participant?.peerConnection) return;

    console.log(`🎥 GroupWebRTC: Processing ${queue.length} queued ICE candidates for:`, participantId);

    for (const candidate of queue) {
      try {
        await participant.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('🎥 GroupWebRTC: Error adding queued ICE candidate:', error);
      }
    }

    this.iceCandidateQueues.set(participantId, []);
  }

  // Handle participant leaving
  private handleParticipantLeave(participantId: string): void {
    console.log('🎥 GroupWebRTC: Participant leaving:', participantId);

    const participant = this.participants.get(participantId);
    if (participant) {
      // Close peer connection
      participant.peerConnection?.close();
      
      // Stop remote stream tracks
      participant.stream?.getTracks().forEach(track => track.stop());
      
      // Remove from participants
      this.participants.delete(participantId);
      
      this.notifyParticipantUpdate();
    }
  }

  // Create a peer connection for a participant
  private async createPeerConnection(participantId: string): Promise<RTCPeerConnection> {
    console.log('🎥 GroupWebRTC: Creating peer connection for:', participantId);

    const peerConnection = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
    });

    // Add local tracks to the connection
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, this.localStream!);
      });
    }

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'group-ice-candidate',
          from: this.currentUserId,
          to: participantId,
          conversationId: this.conversationId,
          data: event.candidate,
        });
      }
    };

    // Handle remote stream
    peerConnection.ontrack = (event) => {
      console.log('🎥 GroupWebRTC: Received remote track from:', participantId);
      
      if (event.streams && event.streams[0]) {
        const participant = this.participants.get(participantId);
        if (participant) {
          participant.stream = event.streams[0];
          this.participants.set(participantId, participant);
          this.notifyParticipantUpdate();
        }
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log('🎥 GroupWebRTC: Connection state for', participantId, ':', peerConnection.connectionState);
      
      if (peerConnection.connectionState === 'disconnected' ||
          peerConnection.connectionState === 'failed' ||
          peerConnection.connectionState === 'closed') {
        this.handleParticipantLeave(participantId);
      }
    };

    return peerConnection;
  }

  // Send a signal through the channel
  private async sendSignal(signal: GroupCallSignal): Promise<void> {
    if (this.channel) {
      await this.channel.send({
        type: 'broadcast',
        event: 'group-signal',
        payload: signal,
      });
    }
  }

  // Notify participant update
  private notifyParticipantUpdate(): void {
    this.onParticipantUpdateCallback?.(this.participants);
  }

  // Toggle local audio
  toggleAudio(enabled: boolean): void {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  // Toggle local video
  toggleVideo(enabled: boolean): void {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  // Leave the group call
  async leaveCall(): Promise<void> {
    console.log('🎥 GroupWebRTC: Leaving group call');

    // Send leave signal
    await this.sendSignal({
      type: 'group-leave',
      from: this.currentUserId,
      conversationId: this.conversationId,
      data: {},
    });

    this.cleanup();
  }

  // End the entire group call (for call initiator)
  async endCall(): Promise<void> {
    console.log('🎥 GroupWebRTC: Ending group call');

    // Send end signal to all
    await this.sendSignal({
      type: 'group-end',
      from: this.currentUserId,
      conversationId: this.conversationId,
      data: {},
    });

    this.cleanup();
    this.onCallEndCallback?.();
  }

  // Cleanup resources
  private cleanup(): void {
    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Close all peer connections
    this.participants.forEach(participant => {
      participant.peerConnection?.close();
      participant.stream?.getTracks().forEach(track => track.stop());
    });
    this.participants.clear();

    // Remove channel
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }

    // Clear ICE candidate queues
    this.iceCandidateQueues.clear();
  }

  // Callbacks setters
  onParticipantUpdate(callback: ParticipantUpdateCallback): void {
    this.onParticipantUpdateCallback = callback;
  }

  onLocalStream(callback: LocalStreamCallback): void {
    this.onLocalStreamCallback = callback;
  }

  onCallEnd(callback: CallEndCallback): void {
    this.onCallEndCallback = callback;
  }

  onError(callback: ErrorCallback): void {
    this.onErrorCallback = callback;
  }

  // Getters
  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getParticipants(): Map<string, Participant> {
    return this.participants;
  }

  getParticipantCount(): number {
    return this.participants.size + 1; // +1 for self
  }

  isInCall(): boolean {
    return this.localStream !== null;
  }
}

// Export singleton instance
export const groupCallManager = new GroupCallManager();