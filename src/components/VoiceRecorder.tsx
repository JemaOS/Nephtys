// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Trash2, Pause, Play } from 'lucide-react';

interface VoiceRecorderProps {
  onRecordingComplete: (audioBlob: Blob, duration: number) => void;
  onCancel: () => void;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  onRecordingComplete,
  onCancel,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [waveformData, setWaveformData] = useState<number[]>(new Array(35).fill(0));
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef<string>('audio/webm;codecs=opus');

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Real-time waveform analysis
  const updateWaveform = useCallback(() => {
    if (!analyserRef.current || !isRecording || isPaused) {
      return;
    }

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Sample the frequency data to create waveform bars
    const bars = 35;
    const step = Math.floor(dataArray.length / bars);
    const newWaveform = [];
    
    for (let i = 0; i < bars; i++) {
      const value = dataArray[i * step] / 255;
      newWaveform.push(value);
    }
    
    setWaveformData(newWaveform);
    animationFrameRef.current = requestAnimationFrame(updateWaveform);
  }, [isRecording, isPaused]);

  const startRecording = async () => {
    try {
      // High quality audio constraints similar to WhatsApp
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        // Request high sample rate for better quality
        sampleRate: 48000,
        // Mono channel is sufficient for voice
        channelCount: 1,
      };
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints
      });
      streamRef.current = stream;

      // Setup audio analysis with higher quality settings
      audioContextRef.current = new AudioContext({ sampleRate: 48000 });
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);

      // Determine the best supported audio format
      // Priority: MP4/AAC (most compatible) > audio/webm (basic) > audio/ogg
      // Note: We avoid opus codec as it has playback issues on some browsers
      let mimeType = 'audio/webm';
      const audioBitsPerSecond = 128000; // 128 kbps for high quality voice
      
      // Check for MP4/AAC first - most universally supported for playback
      if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/mp4;codecs=aac')) {
        mimeType = 'audio/mp4;codecs=aac';
      } else if (MediaRecorder.isTypeSupported('audio/aac')) {
        mimeType = 'audio/aac';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        // Basic WebM without opus codec - better compatibility
        mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        // OGG/Opus as fallback
        mimeType = 'audio/ogg;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        // WebM/Opus as last resort
        mimeType = 'audio/webm;codecs=opus';
      }
      
      // Store the mimeType for later use when creating the blob
      mimeTypeRef.current = mimeType;
      console.log('Using audio format:', mimeType, 'at', audioBitsPerSecond, 'bps');

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond,
      });

      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        setAudioBlob(blob);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

      // Start timer - only increment if not paused
      timerRef.current = setInterval(() => {
        // Check if still recording and not paused before incrementing
        if (mediaRecorderRef.current?.state === 'recording') {
          setRecordingTime(prev => prev + 1);
        }
      }, 1000);

      // Start waveform animation
      animationFrameRef.current = requestAnimationFrame(updateWaveform);
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Impossible d\'accéder au microphone');
    }
  };

  const togglePauseResume = () => {
    if (!mediaRecorderRef.current) return;
    
    const state = mediaRecorderRef.current.state;
    console.log('MediaRecorder state:', state);
    
    if (state === 'recording') {
      // Pause
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    } else if (state === 'paused') {
      // Resume
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      
      // Resume timer - only increment if recording
      timerRef.current = setInterval(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          setRecordingTime(prev => prev + 1);
        }
      }, 1000);
      
      // Resume waveform animation
      animationFrameRef.current = requestAnimationFrame(updateWaveform);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }
  };

  const handleSend = () => {
    if (isRecording) {
      // Stop recording first, then send
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
        setIsPaused(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      }
      // Wait for the blob to be created
      setTimeout(() => {
        if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
          onRecordingComplete(blob, recordingTime);
        }
      }, 100);
    } else if (audioBlob) {
      onRecordingComplete(audioBlob, recordingTime);
    }
  };

  const handleDelete = () => {
    if (isRecording) {
      stopRecording();
    }
    setAudioBlob(null);
    setRecordingTime(0);
    chunksRef.current = [];
    setWaveformData(new Array(35).fill(0));
    onCancel();
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Auto-start recording on mount
  useEffect(() => {
    startRecording();
  }, []);

  // Update waveform when recording state changes
  useEffect(() => {
    if (isRecording && !isPaused) {
      animationFrameRef.current = requestAnimationFrame(updateWaveform);
    }
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isRecording, isPaused, updateWaveform]);

  return (
    <div className="w-full py-2">
      {/* WhatsApp Layout + JemaOS Dark Theme - Clean design without glows */}
      
      {/* Top Row: Timer + Waveform + Info */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Timer - Clean gradient text */}
        <div
          className="text-lg font-semibold font-mono min-w-[50px] tracking-wide text-[#8286ef]"
        >
          {formatTime(recordingTime)}
        </div>
        
        {/* Waveform Visualization - Clean animated style */}
        <div className="flex-1 flex items-center justify-center gap-[2px] h-8 px-2">
          {waveformData.map((value, index) => {
            const isActive = isRecording && !isPaused;
            // Dynamic waveform
            const baseHeight = isActive ? Math.max(3, value * 28) : 3;
            const height = Math.max(3, baseHeight);
            
            // WhatsApp-like pattern: dots and bars
            const isMainBar = index % 4 === 1 || index % 4 === 2;
            const barWidth = isMainBar ? 3 : 2;
            const barHeight = isMainBar ? height : Math.min(height * 0.4, 6);
            
            return (
              <div
                key={`waveform-${index}`}
                className="transition-all duration-75 rounded-full"
                style={{
                  width: `${barWidth}px`,
                  height: `${barHeight}px`,
                  backgroundColor: isActive
                    ? `rgba(130, 134, 239, ${0.5 + value * 0.5})`
                    : 'rgba(156, 163, 175, 0.4)',
                }}
              />
            );
          })}
        </div>
        
      </div>
      
      {/* Bottom Row: Delete + Pause + Send */}
      <div className="flex items-center justify-between px-4 pb-2 pt-1">
        {/* Delete Button */}
        <button
          onClick={handleDelete}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 hover:bg-bg-hover"
          aria-label="Supprimer"
        >
          <Trash2 size={24} className="text-text-secondary" strokeWidth={1.5} />
        </button>
        
        {/* Pause/Resume Button - Red accent */}
        <button
          onClick={togglePauseResume}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 hover:bg-bg-hover"
          aria-label={isPaused ? "Reprendre" : "Pause"}
        >
          {isPaused ? (
            <Play
              size={30}
              className="ml-0.5 text-red-500"
              fill="#ef4444"
            />
          ) : (
            <Pause
              size={30}
              className="text-red-500"
              strokeWidth={3}
            />
          )}
        </button>
        
        {/* Send Button - App accent color #8286ef */}
        <button
          onClick={handleSend}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90"
          style={{
            backgroundColor: '#8286ef',
          }}
          aria-label="Envoyer"
        >
          <Send size={22} className="text-white" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
};