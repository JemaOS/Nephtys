import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, Forward, Star, Pin, Smile, Share2, Download, ExternalLink, Play, Pause, Volume2, VolumeX } from 'lucide-react';

interface MediaViewerProps {
  isOpen: boolean;
  mediaUrl: string;
  mediaType: 'image' | 'video' | 'audio' | 'gif' | 'sticker';
  senderName: string;
  senderAvatar?: string;
  timestamp: string;
  isOwn: boolean;
  onClose: () => void;
  onForward?: () => void;
  onStar?: () => void;
  onPin?: () => void;
  onReaction?: (emoji: string) => void;
  onShare?: () => void;
  onDownload?: () => void;
  // For navigation between media
  allMedia?: Array<{
    url: string;
    type: 'image' | 'video' | 'audio' | 'gif' | 'sticker';
    senderName: string;
    senderAvatar?: string;
    timestamp: string;
    isOwn: boolean;
    messageId: string;
  }>;
  currentIndex?: number;
  onNavigate?: (index: number) => void;
}

export const MediaViewer: React.FC<MediaViewerProps> = ({
  isOpen,
  mediaUrl,
  mediaType,
  senderName,
  senderAvatar,
  timestamp,
  isOwn,
  onClose,
  onForward,
  onStar,
  onPin,
  onReaction,
  onShare,
  onDownload,
  allMedia,
  currentIndex = 0,
  onNavigate,
}) => {
  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Format timestamp
  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    
    if (isToday) {
      return `Aujourd'hui à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    }
    return date.toLocaleDateString('fr-FR', { 
      day: 'numeric', 
      month: 'long',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Auto-hide controls after 3 seconds
  useEffect(() => {
    if (showControls && (mediaType === 'video' || mediaType === 'audio')) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [showControls, mediaType]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          handlePrevious();
          break;
        case 'ArrowRight':
          handleNext();
          break;
        case ' ':
          e.preventDefault();
          togglePlayPause();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentIndex, allMedia]);

  // Prevent body scroll when viewer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handlePrevious = () => {
    if (allMedia && currentIndex > 0 && onNavigate) {
      onNavigate(currentIndex - 1);
    }
  };

  const handleNext = () => {
    if (allMedia && currentIndex < allMedia.length - 1 && onNavigate) {
      onNavigate(currentIndex + 1);
    }
  };

  const togglePlayPause = () => {
    if (mediaType === 'video' && videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    } else if (mediaType === 'audio' && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
    }
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
    }
    setIsMuted(!isMuted);
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(mediaUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const extension = mediaType === 'video' ? 'mp4' : mediaType === 'audio' ? 'webm' : mediaType === 'gif' ? 'gif' : 'jpg';
      a.download = `media-${Date.now()}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      onDownload?.();
    } catch (error) {
      console.error('Error downloading media:', error);
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Média partagé',
          url: mediaUrl,
        });
        onShare?.();
      } catch (error) {
        console.log('Share cancelled');
      }
    } else {
      // Fallback: copy URL to clipboard
      await navigator.clipboard.writeText(mediaUrl);
      alert('Lien copié !');
      onShare?.();
    }
  };

  const handleOpenExternal = () => {
    window.open(mediaUrl, '_blank');
  };

  const quickEmojis = ['❤️', '😂', '😮', '😢', '🙏', '👍'];

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[200] bg-black flex flex-col"
      onClick={() => setShowControls(true)}
    >
      {/* Header */}
      <div 
        className={`absolute top-0 left-0 right-0 z-10 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center justify-between p-3 md:p-4 bg-gradient-to-b from-black/80 to-transparent">
          {/* Left side - Sender info */}
          <div className="flex items-center gap-3">
            {senderAvatar ? (
              <img
                src={senderAvatar}
                alt={senderName}
                className="w-10 h-10 rounded-full object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold">
                {senderName[0]?.toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-white font-medium text-sm md:text-base">{senderName}</p>
              <p className="text-white/60 text-xs md:text-sm">{formatTimestamp(timestamp)}</p>
            </div>
          </div>

          {/* Right side - Action buttons */}
          <div className="flex items-center gap-1 md:gap-2">
            {onForward && (
              <button
                onClick={(e) => { e.stopPropagation(); onForward(); }}
                className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
                title="Transférer"
              >
                <Forward size={20} className="text-white" />
              </button>
            )}
            {onStar && (
              <button
                onClick={(e) => { e.stopPropagation(); onStar(); }}
                className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
                title="Favoris"
              >
                <Star size={20} className="text-white" />
              </button>
            )}
            {onPin && (
              <button
                onClick={(e) => { e.stopPropagation(); onPin(); }}
                className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
                title="Épingler"
              >
                <Pin size={20} className="text-white" />
              </button>
            )}
            {onReaction && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowEmojiPicker(!showEmojiPicker); }}
                  className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
                  title="Réagir"
                >
                  <Smile size={20} className="text-white" />
                </button>
                {showEmojiPicker && (
                  <div className="absolute right-0 top-12 bg-bg-surface rounded-xl p-2 shadow-2xl flex gap-1">
                    {quickEmojis.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={(e) => {
                          e.stopPropagation();
                          onReaction(emoji);
                          setShowEmojiPicker(false);
                        }}
                        className="w-10 h-10 flex items-center justify-center text-2xl hover:bg-bg-hover rounded-lg transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); handleShare(); }}
              className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
              title="Partager"
            >
              <Share2 size={20} className="text-white" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDownload(); }}
              className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
              title="Télécharger"
            >
              <Download size={20} className="text-white" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleOpenExternal(); }}
              className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
              title="Ouvrir dans le navigateur"
            >
              <ExternalLink size={20} className="text-white" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
              title="Fermer"
            >
              <X size={24} className="text-white" />
            </button>
          </div>
        </div>
      </div>

      {/* Navigation arrows */}
      {allMedia && allMedia.length > 1 && (
        <>
          {/* Previous button */}
          <button
            onClick={(e) => { e.stopPropagation(); handlePrevious(); }}
            disabled={currentIndex === 0}
            className={`absolute left-2 md:left-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-all ${
              currentIndex === 0 ? 'opacity-30 cursor-not-allowed' : 'opacity-100'
            } ${showControls ? 'opacity-100' : 'opacity-0'}`}
          >
            <ChevronLeft size={28} className="text-white" />
          </button>

          {/* Next button */}
          <button
            onClick={(e) => { e.stopPropagation(); handleNext(); }}
            disabled={currentIndex === allMedia.length - 1}
            className={`absolute right-2 md:right-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-all ${
              currentIndex === allMedia.length - 1 ? 'opacity-30 cursor-not-allowed' : 'opacity-100'
            } ${showControls ? 'opacity-100' : 'opacity-0'}`}
          >
            <ChevronRight size={28} className="text-white" />
          </button>
        </>
      )}

      {/* Media content */}
      <div className="flex-1 flex items-center justify-center p-4 md:p-8">
        {/* Image, GIF, Sticker - all displayed fullscreen */}
        {(mediaType === 'image' || mediaType === 'gif' || mediaType === 'sticker') && (
          <img
            src={mediaUrl}
            alt="Media"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        )}

        {/* Video */}
        {mediaType === 'video' && (
          <div className="relative max-w-full max-h-full">
            <video
              ref={videoRef}
              src={mediaUrl}
              className="max-w-full max-h-[80vh] object-contain"
              onClick={(e) => {
                e.stopPropagation();
                togglePlayPause();
              }}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
            />
            
            {/* Video controls overlay */}
            <div 
              className={`absolute inset-0 flex items-center justify-center transition-opacity ${
                showControls || !isPlaying ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlayPause();
                }}
                className="w-16 h-16 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors"
              >
                {isPlaying ? (
                  <Pause size={32} className="text-white" />
                ) : (
                  <Play size={32} className="text-white ml-1" />
                )}
              </button>
            </div>

            {/* Volume control */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleMute();
              }}
              className={`absolute bottom-4 right-4 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-all ${
                showControls ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {isMuted ? (
                <VolumeX size={20} className="text-white" />
              ) : (
                <Volume2 size={20} className="text-white" />
              )}
            </button>
          </div>
        )}

        {/* Audio */}
        {mediaType === 'audio' && (
          <div className="w-full max-w-md bg-bg-surface rounded-2xl p-6">
            <audio
              ref={audioRef}
              src={mediaUrl}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
            />
            
            <div className="flex flex-col items-center gap-4">
              {/* Waveform visualization placeholder */}
              <div className="w-full h-16 bg-bg-hover rounded-lg flex items-center justify-center gap-1">
                {Array.from({ length: 30 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-1 bg-accent rounded-full transition-all ${
                      isPlaying ? 'animate-pulse' : ''
                    }`}
                    style={{
                      height: `${Math.random() * 40 + 10}px`,
                      animationDelay: `${i * 50}ms`,
                    }}
                  />
                ))}
              </div>

              {/* Play/Pause button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlayPause();
                }}
                className="w-16 h-16 rounded-full bg-accent hover:bg-[#5a5ec9] flex items-center justify-center transition-colors"
              >
                {isPlaying ? (
                  <Pause size={28} className="text-white" />
                ) : (
                  <Play size={28} className="text-white ml-1" />
                )}
              </button>

              <p className="text-text-secondary text-sm">Message vocal</p>
            </div>
          </div>
        )}
      </div>

      {/* Media counter */}
      {allMedia && allMedia.length > 1 && (
        <div 
          className={`absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/50 text-white text-sm transition-opacity ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {currentIndex + 1} / {allMedia.length}
        </div>
      )}
    </div>
  );
};