// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';

interface AudioFilePlayerProps {
  url: string;
  fileName?: string;
  duration?: number;
  isOwn?: boolean;
}

// Format time in mm:ss
const formatTime = (seconds: number): string => {
  if (!seconds || Number.isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Helper function to get background color class
const getBackgroundColor = (isOwn: boolean): string => {
  return isOwn ? 'bg-[#5a5cc9]' : 'bg-[#1a1d21] dark:bg-[#1a1d21]';
};

// Helper function to get progress bar background class
const getProgressBarBgClass = (isOwn: boolean): string => {
  return isOwn ? 'bg-white/30' : 'bg-white/20';
};

// Helper function to get progress fill color class
const getProgressFillClass = (isOwn: boolean): string => {
  return isOwn ? 'bg-white' : 'bg-[#787add]';
};

// Helper function to get text color class
const getTextColorClass = (isOwn: boolean): string => {
  return isOwn ? 'text-[#2d2f6e]' : 'text-white';
};

// Helper function to get button color class
const getButtonColorClass = (isOwn: boolean): string => {
  return isOwn
    ? 'text-[#2d2f6e]/70 hover:text-[#2d2f6e] hover:bg-[#2d2f6e]/10'
    : 'text-white/70 hover:text-white hover:bg-white/10';
};

// Helper function to get icon color
const getIconColor = (isOwn: boolean): string => {
  return isOwn ? '#5a5cc9' : '#1a1d21';
};

export const AudioFilePlayer: React.FC<AudioFilePlayerProps> = ({
  url,
  fileName,
  duration: initialDuration,
  isOwn = false,
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Extract file name without extension and clean it up
  const displayName = fileName 
    ? fileName.replace(/\.[^/.]+$/, '').replace(/_/g, ' ').replace(/-/g, ' ')
    : 'Audio';

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current && !isDragging) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      setIsLoaded(true);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = Number.parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const skipBackward = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10);
    }
  };

  const skipForward = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 10);
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Modern 2025 design - compact, elegant, high contrast
  // Works in both light and dark mode with proper contrast
  return (
    <div className={`w-full max-w-[280px] rounded-2xl overflow-hidden backdrop-blur-sm ${getBackgroundColor(isOwn)}`}>
      {/* Compact header with file name */}
      <div className="px-4 pt-3 pb-1">
        <p className="text-[13px] font-medium truncate text-white">
          {displayName}
        </p>
      </div>

      {/* Progress bar - sleek design */}
      <div className="px-4 py-2 flex items-center">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={() => setIsDragging(false)}
          onTouchStart={() => setIsDragging(true)}
          onTouchEnd={() => setIsDragging(false)}
          className={`w-full h-1 rounded-full cursor-pointer appearance-none ${getProgressBarBgClass(isOwn)}`}
          style={{
            backgroundSize: `${progress}% 100%`,
            backgroundImage: `linear-gradient(${isOwn ? 'white' : '#787add'}, ${isOwn ? 'white' : '#787add'})`,
            backgroundRepeat: 'no-repeat'
          }}
        />
      </div>

      {/* Controls row - centered with time on sides */}
      <div className="flex items-center justify-between px-3 pb-3">
        {/* Current time - dark color for maximum contrast on purple */}
        <span className={`text-[11px] font-bold w-10 tabular-nums ${getTextColorClass(isOwn)}`}>
          {formatTime(currentTime)}
        </span>

        {/* Control buttons - compact */}
        <div className="flex items-center gap-0.5">
          {/* Skip backward */}
          <button
            onClick={skipBackward}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95 ${getButtonColorClass(isOwn)}`}
          >
            <SkipBack size={18} fill="currentColor" />
          </button>

          {/* Play/Pause - prominent */}
          <button
            onClick={togglePlay}
            className="w-11 h-11 rounded-full bg-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-lg"
          >
            {isPlaying ? (
              <Pause size={20} className={getTextColorClass(isOwn)} fill={getIconColor(isOwn)} />
            ) : (
              <Play size={20} className={`ml-0.5 ${getTextColorClass(isOwn)}`} fill={getIconColor(isOwn)} />
            )}
          </button>

          {/* Skip forward */}
          <button
            onClick={skipForward}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95 ${getButtonColorClass(isOwn)}`}
          >
            <SkipForward size={18} fill="currentColor" />
          </button>
        </div>

        {/* Duration - dark color for maximum contrast on purple */}
        <span className={`text-[11px] font-bold w-10 text-right tabular-nums ${getTextColorClass(isOwn)}`}>
          {formatTime(duration)}
        </span>
      </div>

      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={url}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        preload="metadata"
        className="hidden"
      >
        <track kind="captions" />
      </audio>
    </div>
  );
};