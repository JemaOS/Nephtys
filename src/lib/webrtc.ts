// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// WebRTC Manager for Audio/Video Calls
// Version simplifiée utilisant des serveurs STUN publics

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
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
  private onCallEndCallback: (() => void) | null = null;

  constructor() {
    this.peerConnection = null;
  }

  async initializeCall(config: CallConfig): Promise<MediaStream> {
    try {
      console.log('🎥 WebRTC: Requesting permissions for audio:', config.audio, 'video:', config.video);
      
      // Obtenir le stream local (audio/vidéo)
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: config.audio,
        video: config.video ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
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
        this.peerConnection!.addTrack(track, this.localStream!);
      });

      // Écouter les tracks distants
      this.peerConnection.ontrack = (event) => {
        console.log('🎥 WebRTC: ontrack event fired');
        console.log('🎥 WebRTC: Track kind:', event.track.kind);
        console.log('🎥 WebRTC: Track enabled:', event.track.enabled);
        console.log('🎥 WebRTC: Track readyState:', event.track.readyState);
        console.log('🎥 WebRTC: Number of streams:', event.streams?.length || 0);
        
        if (event.streams && event.streams[0]) {
          console.log('🎥 WebRTC: Remote stream received, tracks:', event.streams[0].getTracks().length);
          event.streams[0].getTracks().forEach((track, i) => {
            console.log(`🎥 WebRTC: Remote track ${i}:`, track.kind, 'enabled:', track.enabled, 'readyState:', track.readyState);
            
            // FIX: Ensure video tracks are enabled when received
            // This fixes the issue where video tracks are disabled initially
            if (track.kind === 'video' && !track.enabled) {
              console.log('🎥 WebRTC: Enabling disabled video track');
              track.enabled = true;
            }
          });
          this.remoteStream = event.streams[0];
          this.onRemoteStreamCallback?.(event.streams[0]);
        }
      };

      // Gérer la fermeture de connexion
      this.peerConnection.onconnectionstatechange = () => {
        if (this.peerConnection?.connectionState === 'disconnected' ||
            this.peerConnection?.connectionState === 'failed' ||
            this.peerConnection?.connectionState === 'closed') {
          this.onCallEndCallback?.();
        }
      };

      return this.localStream;
    } catch (error) {
      console.error('Error initializing call:', error);
      throw error;
    }
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

    console.log('🧊 WebRTC: Adding ICE candidate, current signaling state:', this.peerConnection.signalingState);
    await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    console.log('🧊 WebRTC: ICE candidate added successfully');
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
    this.onRemoteStreamCallback = callback;
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

  toggleVideo(enabled: boolean): void {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  endCall(): void {
    // Arrêter tous les tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }

    // Fermer la connexion peer
    if (this.peerConnection) {
      this.peerConnection.close();
    }

    // Reset
    this.localStream = null;
    this.remoteStream = null;
    this.peerConnection = null;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }
}

export const webrtcManager = new WebRTCManager();