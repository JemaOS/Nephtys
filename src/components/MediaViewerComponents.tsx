import React, { useRef } from 'react';
import { X, ChevronLeft, ChevronRight, Forward, Star, Pin, Smile, Share2, Download, Play, Pause, Volume2, VolumeX, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

// Format timestamp helper
export const formatTimestamp = (ts: string): string => {
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

// Format video time helper
export const formatVideoTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || Number.isNaN(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

interface HeaderActionsProps {
  onForward?: () => void;
  onStar?: () => void;
  onPin?: () => void;
  onReaction?: (emoji: string) => void;
  onShare: () => void;
  onDownload: () => void;
  onClose: () => void;
  onToggleFullscreen: () => void;
  isStarred: boolean;
  showEmojiPicker: boolean;
  setShowEmojiPicker: (show: boolean) => void;
  isMobile: boolean;
  mediaType: string;
  isFullscreen: boolean;
  zoom: number;
  MIN_ZOOM: number;
  MAX_ZOOM: number;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleResetZoom: () => void;
  quickEmojis: string[];
}

export const HeaderActions: React.FC<HeaderActionsProps> = ({
  onForward,
  onStar,
  onPin,
  onReaction,
  onShare,
  onDownload,
  onClose,
  onToggleFullscreen,
  isStarred,
  showEmojiPicker,
  setShowEmojiPicker,
  isMobile,
  mediaType,
  isFullscreen,
  zoom,
  MIN_ZOOM,
  MAX_ZOOM,
  handleZoomIn,
  handleZoomOut,
  handleResetZoom,
  quickEmojis,
}) => (
  <div className="flex items-center gap-3 md:gap-4 flex-shrink-0">
    {/* Zoom controls - only for images, hidden on mobile (use pinch-to-zoom) */}
    {(mediaType === 'image' || mediaType === 'gif' || mediaType === 'sticker') && !isMobile && (
      <>
        <button
          onClick={(e) => { e.stopPropagation(); handleZoomOut(); }}
          className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
          title="Zoom arrière"
          aria-label="Zoom arrière"
          disabled={zoom <= MIN_ZOOM}
        >
          <ZoomOut size={20} className="text-white" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); handleZoomIn(); }}
          className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
          title="Zoom avant"
          aria-label="Zoom avant"
          disabled={zoom >= MAX_ZOOM}
        >
          <ZoomIn size={20} className="text-white" />
        </button>
        {zoom !== 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); handleResetZoom(); }}
            className="px-2 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors text-white text-sm"
            title="Réinitialiser le zoom"
            aria-label="Réinitialiser le zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
        )}
        <div className="w-px h-6 bg-white/20 mx-1" />
      </>
    )}
    {/* Desktop only buttons */}
    {onForward && (
      <button
        onClick={(e) => { e.stopPropagation(); onForward(); }}
        className="hidden md:flex w-10 h-10 rounded-full hover:bg-white/10 items-center justify-center transition-colors"
        title="Transférer"
        aria-label="Transférer"
      >
        <Forward size={20} className="text-white" />
      </button>
    )}
    {onStar && (
      <button
        onClick={(e) => { e.stopPropagation(); onStar(); }}
        className="hidden md:flex w-10 h-10 rounded-full hover:bg-white/10 items-center justify-center transition-colors"
        title={isStarred ? "Retirer des favoris" : "Ajouter aux favoris"}
        aria-label={isStarred ? "Retirer des favoris" : "Ajouter aux favoris"}
      >
        <Star
          size={20}
          className={isStarred ? "text-yellow-400 fill-yellow-400" : "text-white"}
        />
      </button>
    )}
    {onPin && (
      <button
        onClick={(e) => { e.stopPropagation(); onPin(); }}
        className="hidden md:flex w-10 h-10 rounded-full hover:bg-white/10 items-center justify-center transition-colors"
        title="Épingler"
        aria-label="Épingler"
      >
        <Pin size={20} className="text-white" />
      </button>
    )}
    {onReaction && (
      <div className="relative hidden md:block">
          <button
            onClick={(e) => { e.stopPropagation(); setShowEmojiPicker(!showEmojiPicker); }}
            className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
            title="Réagir"
            aria-label="Réagir"
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
    {/* Fullscreen toggle - visible on mobile for videos */}
    {isMobile && (mediaType === 'video' || mediaType === 'image') && (
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFullscreen(); }}
        className="w-9 h-9 md:w-10 md:h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
        title={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
        aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
      >
        <Maximize2 size={18} className={`text-white ${isFullscreen ? 'rotate-45' : ''}`} />
      </button>
    )}
    {/* Share - visible on mobile */}
    <button
      onClick={(e) => { e.stopPropagation(); onShare(); }}
      className="w-9 h-9 md:w-10 md:h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
      title="Partager"
      aria-label="Partager"
    >
      <Share2 size={18} className="md:hidden text-white" />
      <Share2 size={20} className="hidden md:block text-white" />
    </button>
    {/* Download - visible on mobile */}
    <button
      onClick={(e) => { e.stopPropagation(); onDownload(); }}
      className="w-9 h-9 md:w-10 md:h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
      title="Télécharger"
      aria-label="Télécharger"
    >
      <Download size={18} className="md:hidden text-white" />
      <Download size={20} className="hidden md:block text-white" />
    </button>
    {/* Close button - always visible */}
    <button
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      className="w-9 h-9 md:w-10 md:h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
      title="Fermer"
      aria-label="Fermer"
    >
      <X size={22} className="md:hidden text-white" />
      <X size={24} className="hidden md:block text-white" />
    </button>
  </div>
);

interface MediaViewerHeaderProps {
  showControls: boolean;
  setIsHoveringControls: (hovering: boolean) => void;
  senderName: string;
  senderAvatar?: string;
  timestamp: string;
  headerActionsProps: HeaderActionsProps;
}

export const MediaViewerHeader: React.FC<MediaViewerHeaderProps> = ({
  showControls,
  setIsHoveringControls,
  senderName,
  senderAvatar,
  timestamp,
  headerActionsProps,
}) => (
  <div
    className={`absolute top-0 left-0 right-0 z-10 transition-opacity duration-300 ${
      showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
    }`}
    onMouseEnter={() => setIsHoveringControls(true)}
    onMouseLeave={() => setIsHoveringControls(false)}
    role="banner"
  >
    <div className="flex items-center justify-between p-3 md:p-4 bg-gradient-to-b from-black/80 to-transparent">
      {/* Left side - Sender info */}
      <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
        {senderAvatar ? (
          <img
            src={senderAvatar}
            alt={senderName}
            className="w-8 h-8 md:w-10 md:h-10 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold text-sm md:text-base flex-shrink-0">
            {senderName[0]?.toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-white font-medium text-sm md:text-base truncate">{senderName}</p>
          <p className="text-white/60 text-xs md:text-sm truncate">{formatTimestamp(timestamp)}</p>
        </div>
      </div>

      {/* Right side - Action buttons */}
      <HeaderActions {...headerActionsProps} />
    </div>
  </div>
);

interface ImageViewerProps {
  mediaUrl: string;
  zoom: number;
  position: { x: number; y: number };
  isDragging: boolean;
  swipeOffset: number;
  isSwipeActive: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseUp: () => void;
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchMove: (e: React.TouchEvent) => void;
  handleTouchEnd: (e: React.TouchEvent) => void;
  handleResetZoom: () => void;
  imageContainerRef: React.RefObject<HTMLDivElement>;
  allMedia?: any[];
  isMobile: boolean;
  showControls: boolean;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({
  mediaUrl,
  zoom,
  position,
  isDragging,
  swipeOffset,
  isSwipeActive,
  handleMouseDown,
  handleMouseMove,
  handleMouseUp,
  handleTouchStart,
  handleTouchMove,
  handleTouchEnd,
  handleResetZoom,
  imageContainerRef,
  allMedia,
  isMobile,
  showControls,
}) => (
  <div
    ref={imageContainerRef}
    className={`relative flex items-center justify-center w-full h-full ${
      zoom > 1 ? 'cursor-grab' : 'cursor-default'
    } ${isDragging ? 'cursor-grabbing' : ''}`}
    onMouseDown={handleMouseDown}
    onMouseMove={handleMouseMove}
    role="presentation"
    style={{
      transform: zoom <= 1 ? `translateX(${swipeOffset}px)` : 'none',
      transition: isSwipeActive ? 'none' : 'transform 0.15s ease-out',
      willChange: 'transform',
    }}
  >
    <img
      src={mediaUrl}
      alt="Media"
      className="max-w-full max-h-full object-contain select-none"
      style={{
        transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
        transition: isDragging ? 'none' : 'transform 0.1s ease-out',
        touchAction: 'manipulation',
        pointerEvents: isSwipeActive ? 'none' : 'auto',
      }}
      onClick={(e) => {
        e.stopPropagation();
        // Double-click/tap to reset zoom
        if (e.detail === 2) {
          handleResetZoom();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleResetZoom();
        }
      }}
      role="button"
      tabIndex={0}
      draggable={false}
    />
    
    {/* Zoom indicator */}
    {zoom !== 1 && (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/60 text-white text-sm flex items-center gap-2">
        <span>Zoom: {Math.round(zoom * 100)}%</span>
        <span className="text-white/60 text-xs hidden md:inline">• Molette pour zoomer • Double-clic pour réinitialiser</span>
        <span className="text-white/60 text-xs md:hidden">• Pincez pour zoomer</span>
      </div>
    )}
    
    {/* Swipe hint for mobile when there are multiple media - only show briefly */}
    {allMedia && allMedia.length > 1 && zoom <= 1 && isMobile && showControls && (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/60 text-white text-xs animate-pulse">
        ← Glissez pour naviguer →
      </div>
    )}
  </div>
);

interface VideoPlayerProps {
  mediaUrl: string;
  isMuted: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  isFullscreen: boolean;
  showControls: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
  videoContainerRef: React.RefObject<HTMLDivElement>;
  progressBarRef: React.RefObject<HTMLDivElement>;
  togglePlayPause: () => void;
  toggleMute: () => void;
  toggleFullscreen: () => void;
  handleTimeUpdate: () => void;
  handleLoadedMetadata: () => void;
  handleProgressBarClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleProgressBarTouchStart: (e: React.TouchEvent<HTMLDivElement>) => void;
  handleProgressBarTouchMove: (e: React.TouchEvent<HTMLDivElement>) => void;
  handleProgressBarTouchEnd: (e: React.TouchEvent<HTMLDivElement>) => void;
  cyclePlaybackRate: () => void;
  setIsHoveringControls: (hovering: boolean) => void;
  isLandscape: boolean;
  isMobile: boolean;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  lastClickTimeRef: React.MutableRefObject<number>;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  mediaUrl,
  isMuted,
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  isFullscreen,
  showControls,
  videoRef,
  videoContainerRef,
  progressBarRef,
  togglePlayPause,
  toggleMute,
  toggleFullscreen,
  handleTimeUpdate,
  handleLoadedMetadata,
  handleProgressBarClick,
  handleProgressBarTouchStart,
  handleProgressBarTouchMove,
  handleProgressBarTouchEnd,
  cyclePlaybackRate,
  setIsHoveringControls,
  isLandscape,
  isMobile,
  setIsPlaying,
  setCurrentTime,
  lastClickTimeRef,
}) => {
  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={videoContainerRef}
      className={`relative flex flex-col ${isLandscape && isMobile ? 'w-full h-full' : 'max-w-full max-h-full w-full'} ${isFullscreen ? 'bg-black' : ''}`}
      onClick={(e) => {
        // Smart click handling: Single click toggles play/pause immediately, double click toggles fullscreen
        const now = Date.now();
        if (now - lastClickTimeRef.current < 300) {
          toggleFullscreen();
          lastClickTimeRef.current = 0;
        } else {
          togglePlayPause();
          lastClickTimeRef.current = now;
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          togglePlayPause();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex-1 flex items-center justify-center relative">
        <video
          ref={videoRef}
          src={mediaUrl}
          muted={isMuted}
          className={`object-contain ${
            isLandscape && isMobile
              ? 'w-full h-full max-w-none max-h-none'
              : 'max-w-full max-h-[70vh]'
          }`}
          playsInline
          onClick={(e) => {
            e.stopPropagation();
            // Smart click handling
            const now = Date.now();
            if (now - lastClickTimeRef.current < 300) {
              toggleFullscreen();
              lastClickTimeRef.current = 0;
            } else {
              togglePlayPause();
              lastClickTimeRef.current = now;
            }
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            setCurrentTime(0);
          }}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
        >
          <track kind="captions" />
        </video>
        
        {/* Video controls overlay - Play/Pause button in center */}
        <div
          className={`absolute inset-0 z-40 flex items-center justify-center transition-opacity pointer-events-none ${
            showControls || !isPlaying ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePlayPause();
            }}
            className={`w-16 h-16 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors ${
              showControls || !isPlaying ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            aria-label={isPlaying ? "Pause" : "Lecture"}
          >
            {isPlaying ? (
              <Pause size={32} className="text-white" />
            ) : (
              <Play size={32} className="text-white ml-1" />
            )}
          </button>
        </div>

        {/* Volume control - top right */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleMute();
          }}
          className={`absolute top-4 right-4 z-50 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-all ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
          aria-label={isMuted ? "Activer le son" : "Couper le son"}
        >
          {isMuted ? (
            <VolumeX size={20} className="text-white" />
          ) : (
            <Volume2 size={20} className="text-white" />
          )}
        </button>
      </div>

      {/* Video progress bar - WhatsApp style at bottom */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-50 w-full px-4 py-3 bg-gradient-to-t from-black/80 to-transparent transition-opacity ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setIsHoveringControls(true)}
        onMouseLeave={() => setIsHoveringControls(false)}
        role="toolbar"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // Let parent handle escape
          }
        }}
      >
        <div className="flex items-center gap-3">
          {/* Current time */}
          <span className="text-white text-sm font-medium min-w-[45px] text-center">
            {formatVideoTime(currentTime)}
          </span>
          
          {/* Progress bar */}
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={(e) => {
               const newTime = Number.parseFloat(e.target.value);
               setCurrentTime(newTime);
               if (videoRef.current) videoRef.current.currentTime = newTime;
            }}
            className="flex-1 h-1.5 rounded-full cursor-pointer appearance-none bg-white/30 accent-[#787add]"
            style={{
              backgroundSize: `${progressPercentage}% 100%`,
              backgroundImage: `linear-gradient(#787add, #787add)`,
              backgroundRepeat: 'no-repeat'
            }}
          />
          
          {/* Duration */}
          <span className="text-white text-sm font-medium min-w-[45px] text-center">
            {formatVideoTime(duration)}
          </span>
          
          {/* Playback speed */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              cyclePlaybackRate();
            }}
            className="text-white text-sm font-medium min-w-[45px] hover:bg-white/10 px-2 py-1 rounded transition-colors"
            aria-label="Vitesse de lecture"
          >
            x {playbackRate.toFixed(1).replaceAll('.0', ',0')}
          </button>

          {/* Fullscreen toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleFullscreen();
            }}
            className="text-white hover:bg-white/10 p-1.5 rounded transition-colors ml-1"
            title={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
            aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
          >
            <Maximize2 size={20} className={isFullscreen ? 'rotate-45' : ''} />
          </button>
        </div>
      </div>
    </div>
  );
};

interface AudioPlayerProps {
  mediaUrl: string;
  isMuted: boolean;
  isPlaying: boolean;
  audioRef: React.RefObject<HTMLAudioElement>;
  togglePlayPause: () => void;
  setIsPlaying: (playing: boolean) => void;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  mediaUrl,
  isMuted,
  isPlaying,
  audioRef,
  togglePlayPause,
  setIsPlaying,
}) => (
  <div className="w-full max-w-md bg-bg-surface rounded-2xl p-6">
    <audio
      ref={audioRef}
      src={mediaUrl}
      muted={isMuted}
      onPlay={() => setIsPlaying(true)}
      onPause={() => setIsPlaying(false)}
      onEnded={() => setIsPlaying(false)}
    >
      <track kind="captions" />
    </audio>
    
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
              // Use deterministic value for visualizer height instead of Math.random()
              height: `${((i * 7) % 40) + 10}px`,
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
        aria-label={isPlaying ? "Pause" : "Lecture"}
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
);
