// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Play, Pause, Download } from 'lucide-react';

// Audio context for decoding audio that browsers can't play natively
let audioContext: AudioContext | null = null;
const getAudioContext = () => {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioContext;
};

interface VoiceMessageProps {
  url: string;
  duration: number;
  isOwn: boolean;
}

// Generate a consistent waveform pattern based on a seed
const generateWaveformHeights = (count: number, seed: number = 42): number[] => {
  const heights: number[] = [];
  let value = seed;
  
  for (let i = 0; i < count; i++) {
    // Simple pseudo-random based on position for consistent pattern
    value = (value * 9301 + 49297) % 233280;
    const random = value / 233280;
    
    // Create a natural waveform pattern with peaks and valleys
    const wave = Math.sin(i * 0.5) * 0.3 + 0.5;
    const variation = random * 0.4;
    const height = Math.max(0.15, Math.min(1, wave + variation));
    
    heights.push(height);
  }
  
  return heights;
};

export const VoiceMessage: React.FC<VoiceMessageProps> = ({
  url,
  duration,
  isOwn,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(duration);
  const audioRef = useRef<HTMLAudioElement>(null);
  
  // Generate waveform heights once based on URL hash
  const waveformHeights = useMemo(() => {
    const seed = url.split('').reduce((acc, char) => acc + (char.codePointAt(0) || 0), 0);
    return generateWaveformHeights(35, seed);
  }, [url]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      console.log('Audio loaded - duration:', audio.duration, 'src:', url);
      if (audio.duration && !Number.isNaN(audio.duration) && Number.isFinite(audio.duration)) {
        setAudioDuration(audio.duration);
      }
    };

    const handleDurationChange = () => {
      console.log('Duration changed:', audio.duration);
      if (audio.duration && !Number.isNaN(audio.duration) && Number.isFinite(audio.duration)) {
        setAudioDuration(audio.duration);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handleError = (e: Event) => {
      const audioElement = e.target as HTMLAudioElement;
      console.error('Audio playback error:', {
        error: audioElement.error,
        errorCode: audioElement.error?.code,
        errorMessage: audioElement.error?.message,
        src: url,
        networkState: audioElement.networkState,
        readyState: audioElement.readyState,
      });
    };

    const handleCanPlay = () => {
      console.log('Audio can play - ready state:', audio.readyState, 'duration:', audio.duration);
      if (audio.duration && !Number.isNaN(audio.duration) && Number.isFinite(audio.duration)) {
        setAudioDuration(audio.duration);
      }
    };

    const handleCanPlayThrough = () => {
      console.log('Audio can play through - ready state:', audio.readyState);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('canplaythrough', handleCanPlayThrough);

    // Force load on mobile - some browsers need this
    audio.load();

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('canplaythrough', handleCanPlayThrough);
    };
  }, [url]);

  // Web Audio API playback state
  const webAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const webAudioStartTimeRef = useRef<number>(0);
  const webAudioOffsetRef = useRef<number>(0);
  const webAudioIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);

  // Cleanup Web Audio resources
  const cleanupWebAudio = useCallback(() => {
    if (webAudioSourceRef.current) {
      try {
        webAudioSourceRef.current.stop();
      } catch (e) {
        // Ignore - might already be stopped
      }
      webAudioSourceRef.current = null;
    }
    if (webAudioIntervalRef.current) {
      clearInterval(webAudioIntervalRef.current);
      webAudioIntervalRef.current = null;
    }
  }, []);

  // Play using Web Audio API (for formats that HTML5 audio can't handle)
  const playWithWebAudio = useCallback(async () => {
    try {
      console.log('Trying Web Audio API playback...');
      
      const ctx = getAudioContext();
      
      // Resume context if suspended (required for user interaction)
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      
      // Fetch and decode the audio if not already cached
      if (!audioBufferRef.current) {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        
        // Decode the audio data
        audioBufferRef.current = await ctx.decodeAudioData(arrayBuffer);
        console.log('Audio decoded successfully, duration:', audioBufferRef.current.duration);
        
        // Update duration
        if (audioBufferRef.current.duration && Number.isFinite(audioBufferRef.current.duration)) {
          setAudioDuration(audioBufferRef.current.duration);
        }
      }
      
      // Create a new source node
      const source = ctx.createBufferSource();
      source.buffer = audioBufferRef.current;
      source.connect(ctx.destination);
      
      // Handle playback end
      source.onended = () => {
        if (webAudioSourceRef.current === source) {
          setIsPlaying(false);
          setCurrentTime(0);
          webAudioOffsetRef.current = 0;
          cleanupWebAudio();
        }
      };
      
      // Start playback from the current offset
      const offset = webAudioOffsetRef.current;
      source.start(0, offset);
      webAudioSourceRef.current = source;
      webAudioStartTimeRef.current = ctx.currentTime - offset;
      
      // Update current time periodically
      webAudioIntervalRef.current = setInterval(() => {
        if (webAudioSourceRef.current && audioBufferRef.current) {
          const elapsed = ctx.currentTime - webAudioStartTimeRef.current;
          if (elapsed < audioBufferRef.current.duration) {
            setCurrentTime(elapsed);
          }
        }
      }, 100);
      
      setIsPlaying(true);
      console.log('Web Audio API playback started');
      return true;
    } catch (error) {
      console.error('Web Audio API playback failed:', error);
      return false;
    }
  }, [url, cleanupWebAudio]);

  // Pause Web Audio playback
  const pauseWebAudio = useCallback(() => {
    if (webAudioSourceRef.current) {
      const ctx = getAudioContext();
      webAudioOffsetRef.current = ctx.currentTime - webAudioStartTimeRef.current;
      cleanupWebAudio();
    }
  }, [cleanupWebAudio]);

  // Helper: Try HTML5 audio playback
  const tryHtml5Playback = async (audio: HTMLAudioElement): Promise<boolean> => {
    try {
      console.log('Attempting to play audio:', url, 'readyState:', audio.readyState);
      await audio.play();
      setIsPlaying(true);
      console.log('HTML5 audio playing successfully');
      return true;
    } catch (error) {
      console.error('HTML5 audio error:', error);
      return false;
    }
  };

  // Helper: Try Web Audio API playback
  const tryWebAudioPlayback = async (): Promise<boolean> => {
    return await playWithWebAudio();
  };

  // Helper: Try blob URL playback as last resort
  const tryBlobPlayback = async (): Promise<boolean> => {
    try {
      console.log('Trying blob URL playback...');
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const blob = await response.blob();
      
      // Try to determine the correct MIME type
      let mimeType = blob.type;
      if (!mimeType || mimeType === 'application/octet-stream') {
        // Guess from URL
        if (url.includes('.ogg')) mimeType = 'audio/ogg';
        else if (url.includes('.m4a')) mimeType = 'audio/mp4';
        else if (url.includes('.webm')) mimeType = 'audio/webm';
        else mimeType = 'audio/webm'; // Default
      }
      
      // Create blob with explicit type
      const typedBlob = new Blob([blob], { type: mimeType });
      const blobUrl = URL.createObjectURL(typedBlob);
      
      // Create new audio element with blob URL
      const newAudio = new Audio(blobUrl);
      
      // Copy event listeners
      newAudio.addEventListener('timeupdate', () => {
        setCurrentTime(newAudio.currentTime);
      });
      newAudio.addEventListener('ended', () => {
        setIsPlaying(false);
        setCurrentTime(0);
        URL.revokeObjectURL(blobUrl);
      });
      newAudio.addEventListener('loadedmetadata', () => {
        if (newAudio.duration && !Number.isNaN(newAudio.duration) && Number.isFinite(newAudio.duration)) {
          setAudioDuration(newAudio.duration);
        }
      });
      
      await newAudio.play();
      
      // Replace the ref
      if (audioRef.current) {
        audioRef.current.pause();
      }
      (audioRef as any).current = newAudio;
      setIsPlaying(true);
      console.log('Blob URL playback successful');
      return true;
    } catch (blobError) {
      console.error('All playback methods failed:', blobError);
      alert('Impossible de lire ce message vocal. Le format audio n\'est pas supporté par votre navigateur.');
      return false;
    }
  };

  const togglePlayPause = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      // Check if we're using Web Audio API
      if (webAudioSourceRef.current) {
        pauseWebAudio();
      } else {
        audio.pause();
      }
      setIsPlaying(false);
    } else {
      // First, try HTML5 audio (most compatible)
      const html5Success = await tryHtml5Playback(audio);
      
      if (!html5Success) {
        // Try Web Audio API (can decode more formats)
        const webAudioSuccess = await tryWebAudioPlayback();
        
        if (!webAudioSuccess) {
          // Last resort: try blob URL approach
          await tryBlobPlayback();
        }
      }
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupWebAudio();
    };
  }, [cleanupWebAudio]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    audio.currentTime = percentage * audioDuration;
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      
      // Determine file extension from MIME type or URL
      let fileExtension = 'webm';
      const mimeType = blob.type;
      if (mimeType.includes('ogg')) {
        fileExtension = 'ogg';
      } else if (mimeType.includes('mp4') || mimeType.includes('aac') || mimeType.includes('m4a')) {
        fileExtension = 'm4a';
      } else if (url.includes('.ogg')) {
        fileExtension = 'ogg';
      } else if (url.includes('.m4a')) {
        fileExtension = 'm4a';
      }
      
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `voice-message-${Date.now()}.${fileExtension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Error downloading voice message:', error);
    }
  };

  // Helper to get waveform bar color based on state
  const getWaveformBarColor = (isActive: boolean, isOwnMessage: boolean): string => {
    if (isActive) {
      return isOwnMessage ? 'rgba(255, 255, 255, 0.95)' : '#8286ef';
    }
    return isOwnMessage ? 'rgba(255, 255, 255, 0.35)' : 'rgba(130, 134, 239, 0.35)';
  };

  const progress = audioDuration > 0 ? (currentTime / audioDuration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 min-w-[250px] max-w-[350px]">
      <audio
        ref={audioRef}
        src={url}
        preload="auto"
        playsInline
      />
      
      {/* Play/Pause Button - Apple Vision Pro style */}
      <button
        onClick={togglePlayPause}
        className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${
          isOwn
            ? 'bg-white/25'
            : 'bg-[#8286ef]/20'
        }`}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? (
          <Pause size={22} className={isOwn ? 'text-white' : 'text-[#8286ef]'} fill="currentColor" />
        ) : (
          <Play size={22} className={`${isOwn ? 'text-white' : 'text-[#8286ef]'} ml-0.5`} fill="currentColor" />
        )}
      </button>

      {/* Waveform / Progress Bar - Vision Pro + ColorOS style */}
      <div className="flex-1 flex flex-col gap-1.5">
        <div
          onClick={handleSeek}
          className="h-7 flex items-center cursor-pointer"
        >
          {/* Visual waveform with consistent heights */}
          <div className="flex items-center gap-[2px] h-full w-full">
            {waveformHeights.map((height, i) => {
              const barProgress = (i / waveformHeights.length) * 100;
              const isActive = barProgress <= progress;
              const barColor = getWaveformBarColor(isActive, isOwn);
              
              return (
                <div
                  key={`waveform-${i}-${url}`}
                  className="flex-1 rounded-full"
                  style={{
                    height: `${height * 100}%`,
                    minHeight: '4px',
                    backgroundColor: barColor,
                  }}
                />
              );
            })}
          </div>
        </div>
        
        {/* Time */}
        <div className={`text-xs font-medium ${isOwn ? 'text-white/80' : 'text-text-secondary'}`}>
          {formatTime(currentTime)} / {formatTime(audioDuration)}
        </div>
      </div>

      {/* Download Button */}
      <button
        onClick={handleDownload}
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isOwn
            ? 'bg-white/15'
            : 'bg-[#8286ef]/15'
        }`}
        aria-label="Télécharger"
      >
        <Download size={16} className={isOwn ? 'text-white/80' : 'text-[#8286ef]'} />
      </button>
    </div>
  );
};