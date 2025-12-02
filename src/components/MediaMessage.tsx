import React, { useState, useEffect, useRef } from 'react';
import { Download, File, Play, Copy, ChevronDown } from 'lucide-react';
import { MediaViewer } from './MediaViewer';
import { calculateDisplayDimensions } from '@/lib/imageUtils';
import { MessageHoverActions } from './MessageHoverActions';

interface MediaMessageProps {
  url: string;
  type: 'image' | 'video' | 'file';
  fileName?: string;
  fileSize?: number;
  caption?: string;
  // Image dimensions for immediate aspect ratio display
  width?: number;
  height?: number;
  // Blur placeholder for loading state
  thumbnail?: string;
  // Optional props for MediaViewer
  senderName?: string;
  senderAvatar?: string;
  timestamp?: string;
  isOwn?: boolean;
  isStarred?: boolean;
  messageId?: string;
  // Message status for checkmarks (sent/delivered/read)
  status?: 'sent' | 'delivered' | 'read';
  onForward?: () => void;
  onStar?: () => void;
  onPin?: () => void;
  onReaction?: (emoji: string) => void;
  // Hover actions
  onOpenMenu?: (e: React.MouseEvent) => void;
  showHoverActions?: boolean;
}

// Helper component for timestamp overlay inside media
const MediaTimestampOverlay: React.FC<{
  timestamp: string;
  status?: 'sent' | 'delivered' | 'read';
  isOwn: boolean;
}> = ({ timestamp, status, isOwn }) => {
  const formatTime = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="absolute bottom-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/50 backdrop-blur-[2px]">
      <span className="text-[11px] text-white font-medium drop-shadow-sm">
        {formatTime(timestamp)}
      </span>
      {isOwn && (
        <>
          {status === 'sent' && (
            /* Single gray check - sent */
            <svg width="14" height="10" viewBox="0 0 16 11" fill="none">
              <path d="M10.5 1L4.5 7L2 4.5" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          {status === 'delivered' && (
            /* Double gray checks - delivered */
            <svg width="14" height="10" viewBox="0 0 16 11" fill="none">
              <path d="M1.5 5.5L4.5 8.5L10.5 2.5" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5.5 5.5L8.5 8.5L14.5 2.5" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          {status === 'read' && (
            /* Double blue checks - read */
            <svg width="14" height="10" viewBox="0 0 16 11" fill="none">
              <path d="M1.5 5.5L4.5 8.5L10.5 2.5" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5.5 5.5L8.5 8.5L14.5 2.5" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          {!status && (
            /* Default: single gray check */
            <svg width="14" height="10" viewBox="0 0 16 11" fill="none">
              <path d="M10.5 1L4.5 7L2 4.5" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </>
      )}
    </div>
  );
};

export const MediaMessage: React.FC<MediaMessageProps> = ({
  url,
  type,
  fileName,
  fileSize,
  caption,
  width: propWidth,
  height: propHeight,
  thumbnail,
  senderName = 'Utilisateur',
  senderAvatar,
  timestamp = new Date().toISOString(),
  isOwn = false,
  isStarred = false,
  messageId,
  status,
  onForward,
  onStar,
  onPin,
  onReaction,
  onOpenMenu,
  showHoverActions = false,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(
    propWidth && propHeight ? { width: propWidth, height: propHeight } : null
  );
  const [videoDuration, setVideoDuration] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement>(null);

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDuration = (seconds: number): string => {
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
      a.download = fileName || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Error downloading file:', error);
    }
  };

  // Determine media type for viewer (handle GIF detection)
  const getViewerMediaType = (): 'image' | 'video' | 'audio' | 'gif' | 'sticker' => {
    if (type === 'video') return 'video';
    if (type === 'image') {
      // Check if it's a GIF
      if (url.toLowerCase().includes('.gif') || url.toLowerCase().includes('gif')) {
        return 'gif';
      }
      return 'image';
    }
    return 'image';
  };

  // Calculate optimal container size based on image dimensions
  const getContainerStyle = (): React.CSSProperties => {
    // If we have dimensions (from props or loaded), calculate display size
    if (imageDimensions) {
      const displayDims = calculateDisplayDimensions(imageDimensions);
      const aspectRatio = imageDimensions.width / imageDimensions.height;
      return {
        width: '100%',
        maxWidth: `${displayDims.width}px`,
        aspectRatio: `${aspectRatio}`,
        maxHeight: '400px',
      };
    }
    
    // Default fallback for unknown dimensions
    return {
      width: '100%',
      maxWidth: '200px',
      aspectRatio: '1',
      maxHeight: '400px',
    };
  };

  // Get aspect ratio for CSS
  const getAspectRatio = (): string | undefined => {
    if (imageDimensions) {
      return `${imageDimensions.width} / ${imageDimensions.height}`;
    }
    return undefined;
  };

  // Handle video metadata load
  useEffect(() => {
    if (type === 'video' && videoRef.current) {
      const video = videoRef.current;
      const handleLoadedMetadata = () => {
        if (video.duration && !isNaN(video.duration)) {
          setVideoDuration(formatDuration(video.duration));
        }
      };
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    }
  }, [type]);

  if (type === 'image') {
    const containerStyle = getContainerStyle();
    const hasKnownDimensions = !!imageDimensions;
    
    return (
      <>
        <div
          className="relative cursor-pointer overflow-hidden rounded-xl border-[3px] border-[#787add] group message-media-container"
          style={{ ...containerStyle, boxSizing: 'border-box' }}
          onClick={() => !imageError && setIsFullscreen(true)}
        >
          {/* Hover Actions Button */}
          {onOpenMenu && (
            <MessageHoverActions
              isVisible={showHoverActions}
              isOwn={isOwn}
              onOpenMenu={onOpenMenu}
            />
          )}
          {/* Blur placeholder background - shown while loading */}
          {!imageLoaded && !imageError && thumbnail && (
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{
                backgroundImage: `url(${thumbnail})`,
                filter: 'blur(10px)',
                transform: 'scale(1.1)', // Prevent blur edges from showing
              }}
            />
          )}
          
          {/* Skeleton loading state - shown when no thumbnail */}
          {!imageLoaded && !imageError && !thumbnail && (
            <div
              className="absolute inset-0 bg-gradient-to-br from-[#1a1a1a] to-[#2a2a2a] animate-pulse"
              style={hasKnownDimensions ? {} : { aspectRatio: '4/3' }}
            />
          )}
          
          {/* Loading spinner overlay */}
          {!imageLoaded && !imageError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-10">
              <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
          )}
          
          {/* Error state */}
          {imageError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1a1a1a] text-text-secondary">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <span className="text-xs mt-2">Image non disponible</span>
            </div>
          )}
          
          {/* Actual image */}
          <img
            src={url}
            alt="Image"
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              imageLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            loading="lazy"
            onLoad={(e) => {
              const img = e.target as HTMLImageElement;
              // Update dimensions if we didn't have them from props
              if (!propWidth || !propHeight) {
                setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
              }
              setImageLoaded(true);
            }}
            onError={() => {
              setImageError(true);
            }}
          />
          
          {/* Gradient overlay for timestamp visibility */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
          
          {/* Timestamp and status overlay - WhatsApp style */}
          {imageLoaded && !imageError && (
            <MediaTimestampOverlay
              timestamp={timestamp}
              status={status}
              isOwn={isOwn}
            />
          )}
        </div>
        {caption && (
          <p className="mt-1.5 text-sm whitespace-pre-wrap break-words">{caption}</p>
        )}

        {/* MediaViewer for fullscreen */}
        <MediaViewer
          isOpen={isFullscreen}
          mediaUrl={url}
          mediaType={getViewerMediaType()}
          senderName={senderName}
          senderAvatar={senderAvatar}
          timestamp={timestamp}
          isOwn={isOwn}
          isStarred={isStarred}
          onClose={() => setIsFullscreen(false)}
          onForward={onForward}
          onStar={onStar}
          onPin={onPin}
          onReaction={onReaction}
        />
      </>
    );
  }

  if (type === 'video') {
    return (
      <>
        <div
          className="relative cursor-pointer overflow-hidden rounded-xl border-[3px] border-[#787add] max-w-[280px] group message-media-container"
          onClick={() => setIsFullscreen(true)}
        >
          {/* Hover Actions Button */}
          {onOpenMenu && (
            <MessageHoverActions
              isVisible={showHoverActions}
              isOwn={isOwn}
              onOpenMenu={onOpenMenu}
            />
          )}
          {/* Video with WhatsApp-style frame */}
          <div className="relative bg-black" style={{ borderRadius: '9px' }}>
            <video
              ref={videoRef}
              src={url}
              className="w-full h-auto object-cover"
              style={{ maxHeight: '400px' }}
              muted
              playsInline
              preload="metadata"
            />
            {/* Play button overlay */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-black/60 flex items-center justify-center backdrop-blur-sm">
                <Play size={28} className="text-white ml-1" fill="white" />
              </div>
            </div>
            {/* Gradient overlay for timestamp visibility */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" />
            
            {/* Video info overlay - bottom left */}
            <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
              {/* HD badge */}
              <span className="px-1.5 py-0.5 bg-white/90 text-black text-[10px] font-bold rounded">
                HD
              </span>
              {/* Duration */}
              {videoDuration && (
                <span className="text-white text-xs font-medium drop-shadow-lg">
                  {videoDuration}
                </span>
              )}
            </div>
            
            {/* Timestamp and status overlay - WhatsApp style */}
            <MediaTimestampOverlay
              timestamp={timestamp}
              status={status}
              isOwn={isOwn}
            />
            {/* Picture-in-picture icon - top left */}
            <div className="absolute top-2 left-2">
              <Copy size={16} className="text-white drop-shadow-lg" />
            </div>
          </div>
        </div>
        {caption && (
          <p className="mt-1.5 text-sm whitespace-pre-wrap break-words">{caption}</p>
        )}

        {/* MediaViewer for fullscreen video */}
        <MediaViewer
          isOpen={isFullscreen}
          mediaUrl={url}
          mediaType="video"
          senderName={senderName}
          senderAvatar={senderAvatar}
          timestamp={timestamp}
          isOwn={isOwn}
          isStarred={isStarred}
          onClose={() => setIsFullscreen(false)}
          onForward={onForward}
          onStar={onStar}
          onPin={onPin}
          onReaction={onReaction}
        />
      </>
    );
  }

  // File type
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-glass-surface-medium border border-glass-border max-w-[240px] sm:max-w-[280px]">
      <div className="w-10 h-10 rounded-lg bg-primary-500/20 flex items-center justify-center flex-shrink-0">
        <File size={20} className="text-primary-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{fileName || 'Fichier'}</p>
        {fileSize && (
          <p className="text-xs text-text-tertiary">{formatFileSize(fileSize)}</p>
        )}
      </div>
      <button
        onClick={handleDownload}
        className="p-2 rounded-full hover:bg-white/10 transition-colors flex-shrink-0"
        aria-label="Télécharger"
      >
        <Download size={18} className="text-text-tertiary" />
      </button>
    </div>
  );
};