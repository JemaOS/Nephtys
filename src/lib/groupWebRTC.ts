// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

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

  // Current user info
  private currentUserName: string = '';
  private currentUserAvatar: string | undefined = undefined;

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

    // Fetch current user's profile info
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, username, avatar_url')
        .eq('id', userId)
        .maybeSingle();
      
      this.currentUserName = profile?.display_name || profile?.username || 'Moi';
      this.currentUserAvatar = profile?.avatar_url || undefined;
      console.log('🎥 GroupWebRTC: Current user profile:', this.currentUserName);
    } catch (error) {
      console.error('🎥 GroupWebRTC: Error fetching user profile:', error);
      this.currentUserName = 'Moi';
    }

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

    // Broadcast join signal to all participants with our profile info
    await this.sendSignal({
      type: 'group-join',
      from: this.currentUserId,
      conversationId: this.conversationId,
      data: {
        audio: this.config.audio,
        video: this.config.video,
        name: this.currentUserName,
        avatar: this.currentUserAvatar,
      },
    });
  }

  // Fetch participant profile from database
  private async fetchParticipantProfile(participantId: string): Promise<{ name: string; avatar?: string }> {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, username, avatar_url')
        .eq('id', participantId)
        .maybeSingle();
      
      return {
        name: profile?.display_name || profile?.username || 'Participant',
        avatar: profile?.avatar_url || undefined,
      };
    } catch (error) {
      console.error('🎥 GroupWebRTC: Error fetching participant profile:', error);
      return { name: 'Participant' };
    }
  }

  // Handle when a new participant joins
  private async handleParticipantJoin(signal: GroupCallSignal): Promise<void> {
    const participantId = signal.from;
    console.log('🎥 GroupWebRTC: Participant joining:', participantId);

    // Check if we already have a connection with this participant
    const existingParticipant = this.participants.get(participantId);
    if (existingParticipant?.peerConnection) {
      const state = existingParticipant.peerConnection.connectionState;
      if (state === 'connected' || state === 'connecting') {
        console.log('🎥 GroupWebRTC: Already connected/connecting to:', participantId, '- ignoring join');
        return;
      }
      // Close the old connection
      existingParticipant.peerConnection.close();
    }

    // Create peer connection for this participant
    const peerConnection = await this.createPeerConnection(participantId);

    // Get participant name - prefer from signal, fallback to database lookup
    let participantName = signal.data.name;
    let participantAvatar = signal.data.avatar;
    
    if (!participantName) {
      const profile = await this.fetchParticipantProfile(participantId);
      participantName = profile.name;
      participantAvatar = profile.avatar;
    }

    // Add participant to our list
    this.participants.set(participantId, {
      id: participantId,
      name: participantName,
      avatar: participantAvatar,
      peerConnection,
      audioEnabled: signal.data.audio,
      videoEnabled: signal.data.video,
    });

    try {
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
    } catch (error) {
      console.error('🎥 GroupWebRTC: Error creating offer for participant:', participantId, error);
    }
  }

  // Handle incoming offer
  private async handleOffer(signal: GroupCallSignal): Promise<void> {
    const participantId = signal.from;
    console.log('🎥 GroupWebRTC: Handling offer from:', participantId);

    // Get or create peer connection
    let participant = this.participants.get(participantId);
    let peerConnection = participant?.peerConnection;
    
    if (!peerConnection) {
      peerConnection = await this.createPeerConnection(participantId);
      
      // Fetch participant profile from database
      const profile = await this.fetchParticipantProfile(participantId);
      
      this.participants.set(participantId, {
        id: participantId,
        name: profile.name,
        avatar: profile.avatar,
        peerConnection,
        audioEnabled: true,
        videoEnabled: this.config.video,
      });
    } else {
      // Check if we already have a stable connection - ignore duplicate offers
      if (peerConnection.signalingState === 'stable' && peerConnection.connectionState === 'connected') {
        console.log('🎥 GroupWebRTC: Ignoring duplicate offer - already connected to:', participantId);
        return;
      }
      
      // If we're in the middle of negotiation, check if we should handle this offer
      // Use "polite peer" pattern - the peer with the lower ID is polite and yields
      if (peerConnection.signalingState !== 'stable') {
        const weArePolite = this.currentUserId < participantId;
        if (!weArePolite) {
          console.log('🎥 GroupWebRTC: Ignoring offer due to glare - we are impolite peer');
          return;
        }
        // We are polite, so we rollback and accept the offer
        console.log('🎥 GroupWebRTC: Rolling back local description due to glare');
        await peerConnection.setLocalDescription({ type: 'rollback' });
      }
    }

    try {
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
    } catch (error) {
      console.error('🎥 GroupWebRTC: Error handling offer:', error);
    }
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

    // Check if we're in the right state to receive an answer
    const signalingState = participant.peerConnection.signalingState;
    if (signalingState !== 'have-local-offer') {
      console.log('🎥 GroupWebRTC: Ignoring answer - wrong signaling state:', signalingState);
      return;
    }

    try {
      await participant.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.data));

      // Process queued ICE candidates
      await this.processQueuedIceCandidates(participantId);
    } catch (error) {
      console.error('🎥 GroupWebRTC: Error handling answer:', error);
    }
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
  async toggleVideo(enabled: boolean): Promise<void> {
    console.log('🎥 GroupWebRTC: toggleVideo called, enabled:', enabled);
    
    if (!this.localStream) {
      console.log('🎥 GroupWebRTC: No local stream, cannot toggle video');
      return;
    }

    const currentVideoTracks = this.localStream.getVideoTracks();
    
    if (enabled) {
      // Re-enable video - ALWAYS get a new video track and replace it in all peer connections
      // This is necessary because just enabling the track doesn't properly update remote peers
      console.log('🎥 GroupWebRTC: Getting new video track for re-enable...');
      try {
        // Get a new video stream
        const newVideoStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user'
          }
        });
        
        const newVideoTrack = newVideoStream.getVideoTracks()[0];
        console.log('🎥 GroupWebRTC: Got new video track:', newVideoTrack.id);
        
        // Remove old video tracks from local stream and stop them
        currentVideoTracks.forEach(track => {
          this.localStream!.removeTrack(track);
          track.stop();
        });
        
        // Add new video track to local stream
        this.localStream.addTrack(newVideoTrack);
        
        // Replace the video track in all peer connections
        await this.replaceVideoTrackInAllPeers(newVideoTrack);
        
        // Notify local stream callback so UI updates
        this.onLocalStreamCallback?.(this.localStream);
        
        console.log('🎥 GroupWebRTC: Video track replaced in all peers successfully');
      } catch (error) {
        console.error('🎥 GroupWebRTC: Error getting new video track:', error);
      }
    } else {
      // Disable video - stop the tracks completely (we'll get new ones when re-enabling)
      console.log('🎥 GroupWebRTC: Stopping video tracks');
      currentVideoTracks.forEach(track => {
        track.stop();
        this.localStream!.removeTrack(track);
      });
      
      // Notify local stream callback so UI updates (shows avatar)
      this.onLocalStreamCallback?.(this.localStream);
    }
  }

  // Replace video track in all peer connections
  private async replaceVideoTrackInAllPeers(newTrack: MediaStreamTrack): Promise<void> {
    console.log('🎥 GroupWebRTC: Replacing video track in', this.participants.size, 'peer connections');
    
    for (const [participantId, participant] of this.participants) {
      if (participant.peerConnection) {
        const senders = participant.peerConnection.getSenders();
        const videoSender = senders.find(sender => sender.track?.kind === 'video');
        
        if (videoSender) {
          try {
            await videoSender.replaceTrack(newTrack);
            console.log('🎥 GroupWebRTC: Replaced video track for participant:', participantId);
          } catch (error) {
            console.error('🎥 GroupWebRTC: Error replacing track for participant:', participantId, error);
          }
        } else {
          // No video sender exists, we need to add the track
          console.log('🎥 GroupWebRTC: No video sender for participant:', participantId, '- adding track');
          try {
            participant.peerConnection.addTrack(newTrack, this.localStream!);
          } catch (error) {
            console.error('🎥 GroupWebRTC: Error adding track for participant:', participantId, error);
          }
        }
      }
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