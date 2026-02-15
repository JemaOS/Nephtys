// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// WebRTC Manager for Audio/Video Calls
// Version simplifiée utilisant des serveurs STUN publics

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun.stunprotocol.org:3478' },
  { urls: 'stun:stun.framasoft.org:3478' },
  { urls: 'stun:stun.voip.blackberry.com:3478' },
];

export interface CallConfig {
  audio: boolean;
  video: boolean;
}

export class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private onRemoteStreamCallback: ((stream: MediaStream) => void) | null = null;
  private onLocalStreamCallback: ((stream: MediaStream) => void) | null = null;
  private onCallEndCallback: (() => void) | null = null;
  private onNegotiationNeededCallback: (() => void) | null = null;
  private onIceConnectionStateChangeCallback: ((state: RTCIceConnectionState) => void) | null = null;

  constructor() {
    this.peerConnection = null;
  }

  async initializeCall(config: CallConfig): Promise<MediaStream> {
    try {
      console.log('🎥 WebRTC: initializeCall start');
      
      if (this.peerConnection) {
        console.warn('🎥 WebRTC: PeerConnection already exists! Cleaning up previous connection...');
        this.endCall();
      }

      console.log('🎥 WebRTC: Requesting permissions for audio:', config.audio, 'video:', config.video);
      
      // Obtenir le stream local (audio/vidéo)
      // Configuration audio améliorée pour la fiabilité
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: config.audio ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } : false,
        video: config.video ? {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60 }
        } : false,
      });

      console.log('🎥 WebRTC: Local stream obtained:', this.localStream.getTracks().length, 'tracks');
      this.localStream.getTracks().forEach((track, i) => {
        console.log(`🎥 WebRTC: Track ${i}:`, track.kind, 'enabled:', track.enabled, 'readyState:', track.readyState);
      });

      // Créer la connexion peer
      this.peerConnection = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
      });

      // Ajouter les tracks locaux
      this.localStream.getTracks().forEach(track => {
        const sender = this.peerConnection!.addTrack(track, this.localStream!);
        
        // Increase video bitrate if possible
        if (track.kind === 'video') {
          const params = sender.getParameters();
          if (!params.encodings) {
            params.encodings = [{}];
          }
          
          // Set maxBitrate to 4 Mbps (4000000 bps)
          params.encodings[0].maxBitrate = 4000000;
          
          sender.setParameters(params).catch(err => {
            console.warn('🎥 WebRTC: Failed to set video bitrate parameters:', err);
          });
        }
      });

      // Écouter les tracks distants
      this.peerConnection.ontrack = (event) => {
        console.log('🎥 WebRTC: ontrack event fired');
        console.log('🎥 WebRTC: Track kind:', event.track.kind);
        
        // Ensure the track is enabled
        if (!event.track.enabled) {
          console.log(`🎥 WebRTC: Enabling disabled ${event.track.kind} track`);
          event.track.enabled = true;
        }

        if (event.streams && event.streams[0]) {
          const stream = event.streams[0];
          console.log('🎥 WebRTC: Remote stream received, tracks:', stream.getTracks().length);
          
          // Ensure all tracks in the stream are enabled
          stream.getTracks().forEach(track => {
            if (!track.enabled) track.enabled = true;
          });

          this.remoteStream = stream;
          this.onRemoteStreamCallback?.(stream);
        }
      };

      // Gérer la fermeture de connexion
      this.peerConnection.onconnectionstatechange = () => {
        console.log('🎥 WebRTC: Connection state changed:', this.peerConnection?.connectionState);
        if (this.peerConnection?.connectionState === 'disconnected' ||
            this.peerConnection?.connectionState === 'failed' ||
            this.peerConnection?.connectionState === 'closed') {
          this.onCallEndCallback?.();
        }
      };

      // Monitor ICE connection state for debugging reliability issues
      this.peerConnection.oniceconnectionstatechange = () => {
        const iceState = this.peerConnection?.iceConnectionState;
        console.log('🧊 WebRTC: ICE connection state changed:', iceState);
        
        if (iceState) {
          this.onIceConnectionStateChangeCallback?.(iceState);
        }
        
        if (iceState === 'failed' || iceState === 'disconnected') {
          console.warn('🧊 WebRTC: ICE connection issues detected!');
        }
      };

      return this.localStream;
    } catch (error) {
      console.error('Error initializing call:', error);
      throw error;
    }
  }

  async restartIce(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }
    console.log('🧊 WebRTC: Restarting ICE...');
    
    const offer = await this.peerConnection.createOffer({ iceRestart: true });
    await this.peerConnection.setLocalDescription(offer);
    
    return offer;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  async createAnswer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    console.log('🎥 WebRTC: createAnswer called');
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    console.log('🎥 WebRTC: Setting remote description, current signaling state:', this.peerConnection.signalingState);
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    console.log('🎥 WebRTC: Remote description set, signaling state:', this.peerConnection.signalingState);
    
    const answer = await this.peerConnection.createAnswer();
    console.log('🎥 WebRTC: Answer created');
    
    await this.peerConnection.setLocalDescription(answer);
    console.log('🎥 WebRTC: Local description set, signaling state:', this.peerConnection.signalingState);
    
    return answer;
  }

  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    console.log('🧊 WebRTC: addIceCandidate called, peerConnection exists:', !!this.peerConnection);
    if (!this.peerConnection) {
      console.error('🧊 WebRTC: Peer connection not initialized when adding ICE candidate');
      throw new Error('Peer connection not initialized');
    }

    if (!this.peerConnection.remoteDescription) {
      console.warn('🧊 WebRTC: Remote description not set, cannot add ICE candidate yet');
      throw new Error('Remote description not set');
    }

    console.log('🧊 WebRTC: Adding ICE candidate, current signaling state:', this.peerConnection.signalingState);
    await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    console.log('🧊 WebRTC: ICE candidate added successfully');
  }

  hasRemoteDescription(): boolean {
    return !!this.peerConnection?.remoteDescription;
  }

  onIceCandidate(callback: (candidate: RTCIceCandidate) => void): void {
    if (this.peerConnection) {
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          callback(event.candidate);
        }
      };
    }
  }

  onRemoteStream(callback: (stream: MediaStream) => void): void {
    this.onRemoteStreamCallback = (...args: any[]) => {
      if (args.length > 1) console.error('WebRTCManager: onRemoteStreamCallback called with multiple arguments!', args);
      // @ts-ignore
      callback(...args);
    };
  }

  onLocalStream(callback: (stream: MediaStream) => void): void {
    this.onLocalStreamCallback = callback;
  }

  onNegotiationNeeded(callback: () => void): void {
    this.onNegotiationNeededCallback = callback;
  }

  onIceConnectionStateChange(callback: (state: RTCIceConnectionState) => void): void {
    this.onIceConnectionStateChangeCallback = callback;
  }

  onCallEnd(callback: () => void): void {
    this.onCallEndCallback = callback;
  }

  toggleAudio(enabled: boolean): void {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  async toggleVideo(enabled: boolean): Promise<void> {
    console.log('🎥 WebRTC: toggleVideo called, enabled:', enabled);
    
    if (!this.localStream || !this.peerConnection) {
      console.warn('🎥 WebRTC: No local stream or peer connection');
      return;
    }

    const videoTracks = this.localStream.getVideoTracks();
    
    if (enabled) {
      // Check if we have an existing video track that's just disabled
      if (videoTracks.length > 0 && videoTracks[0].readyState === 'live') {
        // Just re-enable the existing track
        console.log('🎥 WebRTC: Re-enabling existing video track');
        videoTracks.forEach(track => {
          track.enabled = true;
        });
        this.onLocalStreamCallback?.(this.localStream);
        return;
      }
      
      // Need to get a new video track
      try {
        console.log('🎥 WebRTC: Getting new video track from camera...');
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 60 }
          }
        });
        const newTrack = newStream.getVideoTracks()[0];
        console.log('🎥 WebRTC: New video track obtained, id:', newTrack.id, 'readyState:', newTrack.readyState);
        
        // Remove old tracks from local stream
        const oldTracks = this.localStream.getVideoTracks();
        oldTracks.forEach(t => {
          console.log('🎥 WebRTC: Removing old track from local stream, id:', t.id);
          this.localStream!.removeTrack(t);
          t.stop();
        });
        
        // Add new track to local stream
        this.localStream.addTrack(newTrack);
        this.onLocalStreamCallback?.(this.localStream);

        // Find video sender and replace track
        const senders = this.peerConnection.getSenders();
        const videoSender = senders.find(s => s.track?.kind === 'video' || s.track === null);
        
        if (videoSender) {
          console.log('🎥 WebRTC: Replacing track in sender');
          await videoSender.replaceTrack(newTrack);
          console.log('🎥 WebRTC: Video track replaced successfully');
        } else {
          // No video sender exists - this happens if call started without video
          console.log('🎥 WebRTC: No video sender found, adding new track');
          this.peerConnection.addTrack(newTrack, this.localStream);
        }

      } catch (error) {
        console.error('🎥 WebRTC: Error enabling video:', error);
      }
    } else {
      // Disable: Just set enabled = false on the track
      // This sends black frames but keeps the sender active
      // This is the most reliable method (like WhatsApp)
      console.log('🎥 WebRTC: Disabling video track (sending black frames)');
      videoTracks.forEach(track => {
        track.enabled = false;
      });
      this.onLocalStreamCallback?.(this.localStream);
    }
  }

  endCall(): void {
    console.log('🎥 WebRTC: endCall called');
    
    // Arrêter tous les tracks locaux
    if (this.localStream) {
      console.log('🎥 WebRTC: Stopping local tracks');
      this.localStream.getTracks().forEach(track => {
        track.stop();
        console.log(`🎥 WebRTC: Stopped local track ${track.kind}`);
      });
    }

    // Arrêter tous les tracks distants
    if (this.remoteStream) {
      console.log('🎥 WebRTC: Stopping remote tracks');
      this.remoteStream.getTracks().forEach(track => {
        track.stop();
        console.log(`🎥 WebRTC: Stopped remote track ${track.kind}`);
      });
    }

    // Reset callbacks first to prevent re-entry during close
    this.onRemoteStreamCallback = null;
    this.onCallEndCallback = null;

    // Fermer la connexion peer
    if (this.peerConnection) {
      console.log('🎥 WebRTC: Closing PeerConnection');
      
      // Remove listeners before closing
      this.peerConnection.ontrack = null;
      this.peerConnection.onicecandidate = null;
      this.peerConnection.onconnectionstatechange = null;
      
      this.peerConnection.close();
    }

    // Reset
    this.localStream = null;
    this.remoteStream = null;
    this.peerConnection = null;
    
    console.log('🎥 WebRTC: Cleanup finished');
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }
}

export const webrtcManager = new WebRTCManager();