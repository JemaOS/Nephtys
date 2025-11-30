import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Download } from 'lucide-react';

interface VoiceMessageProps {
  url: string;
  duration: number;
  isOwn: boolean;
}

export const VoiceMessage: React.FC<VoiceMessageProps> = ({
  url,
  duration,
  isOwn,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(duration);
  const audioRef = useRef<HTMLAudioElement>(null);

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
      
      {/* Play/Pause Button */}
      <button
        onClick={togglePlayPause}
        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
          isOwn
            ? 'bg-white/20 hover:bg-white/30'
            : 'bg-primary-500/20 hover:bg-primary-500/30'
        }`}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? (
          <Pause size={20} className={isOwn ? 'text-white' : 'text-primary-500'} fill="currentColor" />
        ) : (
          <Play size={20} className={isOwn ? 'text-white' : 'text-primary-500'} fill="currentColor" />
        )}
      </button>

      {/* Waveform / Progress Bar */}
      <div className="flex-1 flex flex-col gap-1">
        <div
          onClick={handleSeek}
          className="h-8 flex items-center cursor-pointer"
        >
          {/* Simplified waveform */}
          <div className="flex items-center gap-0.5 h-full w-full">
            {[...Array(30)].map((_, i) => {
              const barProgress = (i / 30) * 100;
              const isActive = barProgress <= progress;
              const height = Math.random() * 60 + 40;
              
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-full transition-all ${
                    isActive
                      ? isOwn ? 'bg-white' : 'bg-primary-500'
                      : isOwn ? 'bg-white/30' : 'bg-primary-500/30'
                  }`}
                  style={{ height: `${height}%` }}
                />
              );
            })}
          </div>
        </div>
        
        {/* Time */}
        <div className={`text-xs ${isOwn ? 'text-white/70' : 'text-text-tertiary'}`}>
          {formatTime(currentTime)} / {formatTime(audioDuration)}
        </div>
      </div>

      {/* Download Button */}
      <button
        onClick={handleDownload}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
          isOwn
            ? 'hover:bg-white/20'
            : 'hover:bg-primary-500/20'
        }`}
        aria-label="Télécharger"
      >
        <Download size={16} className={isOwn ? 'text-white/70' : 'text-text-tertiary'} />
      </button>
    </div>
  );
};