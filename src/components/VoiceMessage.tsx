import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Play, Pause, Download } from 'lucide-react';

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
    const seed = url.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return generateWaveformHeights(35, seed);
  }, [url]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setAudioDuration(audio.duration);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

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
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `voice-message-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Error downloading voice message:', error);
    }
  };

  const progress = audioDuration > 0 ? (currentTime / audioDuration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 min-w-[250px] max-w-[350px]">
      <audio ref={audioRef} src={url} preload="metadata" />
      
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
              
              return (
                <div
                  key={i}
                  className="flex-1 rounded-full"
                  style={{
                    height: `${height * 100}%`,
                    minHeight: '4px',
                    backgroundColor: isActive
                      ? (isOwn ? 'rgba(255, 255, 255, 0.95)' : '#8286ef')
                      : (isOwn ? 'rgba(255, 255, 255, 0.35)' : 'rgba(130, 134, 239, 0.35)'),
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