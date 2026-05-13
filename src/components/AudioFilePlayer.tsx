// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Loader2 } from 'lucide-react';
import { useDecryptedMedia } from '@/hooks/useDecryptedMedia';

interface AudioFilePlayerProps {
  url: string;
  fileName?: string;
  duration?: number;
  isOwn?: boolean;
  /** Indique si le média est chiffré E2EE (déchiffrement requis) */
  isEncrypted?: boolean;
  /** ID du message (requis si encrypted=true) */
  messageId?: string;
  /** ID du user courant (requis si encrypted=true) */
  currentUserId?: string;
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
  isEncrypted = false,
  messageId,
  currentUserId,
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [isDragging, setIsDragging] = useState(false);

  // Résolution de l'URL : signed URL (bucket privé) ou blob déchiffré (E2EE)
  const { url: resolvedUrl, loading: urlLoading, error: urlError } = useDecryptedMedia({
    encrypted: isEncrypted,
    messageId,
    userId: currentUserId,
    src: url,
  });
  const effectiveUrl = resolvedUrl || url;

  // Extract file name without extension and clean it up
  const displayName = fileName 
    ? fileName.replace(/\.[^/.]+$/, '').replaceAll('_', ' ').replaceAll('-', ' ')
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

  // Pendant le chargement — spinner discret, aucun texte technique
  if (urlLoading) {
    return (
      <div className={`w-full max-w-[280px] rounded-2xl overflow-hidden backdrop-blur-sm ${getBackgroundColor(isOwn)} px-4 py-4 flex items-center justify-center`}>
        <Loader2 size={20} className="animate-spin text-white/50" />
      </div>
    );
  }

  // Erreur silencieuse : on affiche un état dégradé sans exposer les détails
  if (urlError) {
    return (
      <div className={`w-full max-w-[280px] rounded-2xl overflow-hidden backdrop-blur-sm ${getBackgroundColor(isOwn)} px-4 py-4 flex items-center gap-3`}>
        <Loader2 size={18} className="text-white/30" />
        <span className="text-[13px] text-white/40">Audio</span>
      </div>
    );
  }

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
        src={effectiveUrl}
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