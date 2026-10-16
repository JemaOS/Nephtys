// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// WebRTC Manager for Audio/Video Calls
// Version simplifiÃ©e utilisant des serveurs STUN publics

import { getPeerConnectionConfig } from './iceServers';

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

  async initializeCall(config: CallConfig): Promise<MediaStream> {
    try {
      
      if (this.peerConnection) {
        console.warn('🎥 WebRTC: PeerConnection already exists! Cleaning up previous connection...');
        this.endCall();
      }

      
      // Obtenir le stream local (audio/vidéo)
      // On utilise des contraintes lâches (ideal) pour maximiser la compat
      // mobile. Si la résolution idéale n'est pas dispo le navigateur prend
      // la meilleure disponible au lieu de rejeter.
      const videoConstraints: MediaTrackConstraints = {
        facingMode: 'user',
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 },
      };

      // Première tentative : avec vidéo/audio demandés
      let gotStream = false;
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: config.audio ? {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          } : false,
          video: config.video ? videoConstraints : false,
        });
        gotStream = true;
      } catch (mediaErr: any) {
        // OverconstrainedError : réessayer sans contraintes vidéo spécifiques
        if (config.video && (mediaErr.name === 'OverconstrainedError' || mediaErr.name === 'ConstraintNotSatisfiedError')) {
          console.warn('🎥 WebRTC: Overconstrained, retrying with basic video');
          this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: config.audio ? { echoCancellation: true, noiseSuppression: true } : false,
            video: true,
          });
          gotStream = true;
        } else if (config.video && mediaErr.name !== 'NotAllowedError' && mediaErr.name !== 'PermissionDeniedError') {
          // Caméra indispo mais micro OK → audio seulement
          console.warn('🎥 WebRTC: Video unavailable, falling back to audio only:', mediaErr.name);
          this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: config.audio ? { echoCancellation: true, noiseSuppression: true } : false,
            video: false,
          });
          gotStream = true;
        } else {
          throw mediaErr; // permission refusée → laisser remonter
        }
      }
      if (!gotStream) throw new Error('Could not obtain media stream');

      this.localStream.getTracks().forEach((track, i) => {
      });

      // Créer la connexion peer
      this.peerConnection = new RTCPeerConnection(getPeerConnectionConfig());

      // Ajouter les tracks locaux
      const localStream = this.localStream;
      this.localStream.getTracks().forEach(track => {
        const sender = this.peerConnection!.addTrack(track, localStream);
        
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
        
        // Ensure the track is enabled
        if (!event.track.enabled) {
          event.track.enabled = true;
        }

        if (event.streams?.[0]) {
          const stream = event.streams[0];
          
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
        if (this.peerConnection?.connectionState === 'disconnected' ||
            this.peerConnection?.connectionState === 'failed' ||
            this.peerConnection?.connectionState === 'closed') {
          this.onCallEndCallback?.();
        }
      };

      // Monitor ICE connection state for debugging reliability issues
      this.peerConnection.oniceconnectionstatechange = () => {
        const iceState = this.peerConnection?.iceConnectionState;
        
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
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await this.peerConnection.createAnswer();
    
    await this.peerConnection.setLocalDescription(answer);
    
    return answer;
  }

  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) {
      console.error('🧊 WebRTC: Peer connection not initialized when adding ICE candidate');
      throw new Error('Peer connection not initialized');
    }

    if (!this.peerConnection.remoteDescription) {
      console.warn('🧊 WebRTC: Remote description not set, cannot add ICE candidate yet');
      throw new Error('Remote description not set');
    }

    await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
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
      // @ts-expect-error - TypeScript doesn't understand the callback signature
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
    
    if (!this.localStream || !this.peerConnection) {
      console.warn('🎥 WebRTC: No local stream or peer connection');
      return;
    }

    const videoTracks = this.localStream.getVideoTracks();
    
    if (enabled) {
      // Check if we have an existing video track that's just disabled
      if (videoTracks.length > 0 && videoTracks[0].readyState === 'live') {
        // Just re-enable the existing track
        videoTracks.forEach(track => {
          track.enabled = true;
        });
        this.onLocalStreamCallback?.(this.localStream);
        return;
      }
      
      // Need to get a new video track
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 60 }
          }
        });
        const newTrack = newStream.getVideoTracks()[0];
        
        // Remove old tracks from local stream
        const localStream = this.localStream;
        const oldTracks = localStream.getVideoTracks();
        oldTracks.forEach(t => {
          localStream.removeTrack(t);
          t.stop();
        });
        
        // Add new track to local stream
        this.localStream.addTrack(newTrack);
        this.onLocalStreamCallback?.(this.localStream);

        // Find video sender and replace track
        const senders = this.peerConnection.getSenders();
        const videoSender = senders.find(s => s.track?.kind === 'video' || s.track === null);
        
        if (videoSender) {
          await videoSender.replaceTrack(newTrack);
        } else {
          // No video sender exists - this happens if call started without video
          this.peerConnection.addTrack(newTrack, this.localStream);
        }

      } catch (error) {
        console.error('🎥 WebRTC: Error enabling video:', error);
      }
    } else {
      // Disable: Just set enabled = false on the track
      // This sends black frames but keeps the sender active
      // This is the most reliable method (like WhatsApp)
      videoTracks.forEach(track => {
        track.enabled = false;
      });
      this.onLocalStreamCallback?.(this.localStream);
    }
  }

  endCall(): void {
    
    // Arrêter tous les tracks locaux
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        track.stop();
      });
    }

    // Arrêter tous les tracks distants
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach(track => {
        track.stop();
      });
    }

    // Reset callbacks first to prevent re-entry during close
    this.onRemoteStreamCallback = null;
    this.onCallEndCallback = null;

    // Fermer la connexion peer
    if (this.peerConnection) {
      
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
    
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }
}

export const webrtcManager = new WebRTCManager();