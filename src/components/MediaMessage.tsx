import React, { useState, useEffect, useRef } from 'react';
import { Download, File, Play, Copy, ChevronDown, FileText, FileSpreadsheet, FileImage, FileArchive } from 'lucide-react';
import { MediaViewer } from './MediaViewer';
import { calculateDisplayDimensions } from '@/lib/imageUtils';
import { MessageHoverActions } from './MessageHoverActions';

// Helper function to format file size
const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' ko';
  return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
};

// Helper function to get file extension
const getFileExtension = (filename?: string): string => {
  if (!filename) return '';
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
};

// Helper function to get icon background color based on file type
const getFileIconConfig = (extension: string): { bgColor: string; icon: React.ReactNode } => {
  const ext = extension.toLowerCase();
  
  // PDF files - Red
  if (ext === 'pdf') {
    return {
      bgColor: 'bg-red-500',
      icon: <FileText size={24} className="text-white" />
    };
  }
  
  // Word documents - Blue
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) {
    return {
      bgColor: 'bg-blue-500',
      icon: <FileText size={24} className="text-white" />
    };
  }
  
  // Excel/Spreadsheets - Green
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) {
    return {
      bgColor: 'bg-green-500',
      icon: <FileSpreadsheet size={24} className="text-white" />
    };
  }
  
  // PowerPoint - Orange
  if (['ppt', 'pptx', 'odp'].includes(ext)) {
    return {
      bgColor: 'bg-orange-500',
      icon: <FileImage size={24} className="text-white" />
    };
  }
  
  // Archives - Purple
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return {
      bgColor: 'bg-purple-500',
      icon: <FileArchive size={24} className="text-white" />
    };
  }
  
  // Text files - Gray
  if (['txt', 'md', 'json', 'xml', 'html', 'css', 'js'].includes(ext)) {
    return {
      bgColor: 'bg-gray-500',
      icon: <FileText size={24} className="text-white" />
    };
  }
  
  // Default - Teal/Primary
  return {
    bgColor: 'bg-[#787add]',
    icon: <File size={24} className="text-white" />
  };
};

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
  // Navigation props for MediaViewer
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
  allMedia,
  currentIndex,
  onNavigate,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(
    propWidth && propHeight ? { width: propWidth, height: propHeight } : null
  );
  const [videoDuration, setVideoDuration] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement>(null);

  const formatFileSizeLocal = (bytes?: number): string => {
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

  // Detect if we're on mobile
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  // Detect if we're in a PWA
  const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                (window.navigator as any).standalone === true;

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

  // Open file with native app on mobile, or in new tab on desktop
  const handleOpenFile = async () => {
    // On mobile/PWA, download the file to trigger native app opening
    if (isMobile || isPWA) {
      try {
        // Fetch the file
        const response = await fetch(url);
        const blob = await response.blob();
        
        // Get the correct MIME type
        const mimeType = blob.type || getMimeType(fileName || '');
        
        // Create a blob with the correct MIME type
        const typedBlob = new Blob([blob], { type: mimeType });
        const downloadUrl = window.URL.createObjectURL(typedBlob);
        
        // Create a download link
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = fileName || 'document';
        
        // On Android, setting target="_blank" can help trigger the "Open with" dialog
        // But we primarily rely on the download attribute
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Clean up after a delay to allow the download to start
        setTimeout(() => {
          window.URL.revokeObjectURL(downloadUrl);
        }, 1000);
      } catch (error) {
        console.error('Error opening file:', error);
        // Fallback to opening in new tab
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } else {
      // On desktop, open in new tab
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // Helper to get MIME type from filename
  const getMimeType = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'txt': 'text/plain',
      'csv': 'text/csv',
      'zip': 'application/zip',
      'rar': 'application/x-rar-compressed',
      '7z': 'application/x-7z-compressed',
      'tar': 'application/x-tar',
      'gz': 'application/gzip',
    };
    return mimeTypes[ext] || 'application/octet-stream';
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
          allMedia={allMedia}
          currentIndex={currentIndex}
          onNavigate={onNavigate}
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
          allMedia={allMedia}
          currentIndex={currentIndex}
          onNavigate={onNavigate}
        />
      </>
    );
  }

  // File type - WhatsApp-style document preview
  const extension = getFileExtension(fileName);
  const { bgColor, icon } = getFileIconConfig(extension);
  const isPDF = extension === 'pdf';
  const hasThumbnail = isPDF && thumbnail;
  
  // Format timestamp
  const formatTimestamp = (ts: string) => {
    return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };
  
  // Render status checkmarks
  const renderStatusCheck = () => {
    if (!isOwn) return null;
    if (status === 'read') {
      return (
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
          <path d="M1.5 5.5L4.5 8.5L10.5 2.5" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M5.5 5.5L8.5 8.5L14.5 2.5" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
    }
    if (status === 'delivered') {
      return (
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
          <path d="M1.5 5.5L4.5 8.5L10.5 2.5" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M5.5 5.5L8.5 8.5L14.5 2.5" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
    }
    return (
      <svg width="12" height="11" viewBox="0 0 16 11" fill="none">
        <path d="M10.5 1L4.5 7L2 4.5" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  };
  
  // Get Word-style icon for document types
  const getWordStyleIcon = (ext: string) => {
    const e = ext.toLowerCase();
    if (['doc', 'docx', 'odt', 'rtf'].includes(e)) {
      return (
        <div className="w-11 h-11 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-xl">W</span>
        </div>
      );
    }
    if (['xls', 'xlsx', 'csv', 'ods'].includes(e)) {
      return (
        <div className="w-11 h-11 rounded-lg bg-green-600 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-xl">X</span>
        </div>
      );
    }
    if (['ppt', 'pptx', 'odp'].includes(e)) {
      return (
        <div className="w-11 h-11 rounded-lg bg-orange-600 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-xl">P</span>
        </div>
      );
    }
    // Default icon for other file types
    return (
      <div className={`w-11 h-11 rounded-lg ${bgColor} flex items-center justify-center flex-shrink-0`}>
        {icon}
      </div>
    );
  };
  
  return (
    <div className="relative">
      {/* Hover Actions Button */}
      {onOpenMenu && (
        <MessageHoverActions
          isVisible={showHoverActions}
          isOwn={isOwn}
          onOpenMenu={onOpenMenu}
        />
      )}
      
      {/* PDF with thumbnail - App style with #787add accent */}
      {hasThumbnail ? (
        <div className="rounded-xl overflow-hidden max-w-[320px]">
          {/* Thumbnail image of first page - clickable */}
          <div
            className="relative bg-white cursor-pointer"
            onClick={handleOpenFile}
          >
            <img
              src={thumbnail}
              alt={fileName || 'PDF'}
              className="w-full h-auto max-h-[200px] object-cover object-top"
            />
          </div>
          
          {/* File info section - accent color background */}
          <div className="bg-[#5a5cc9] p-3">
            <div className="flex items-start gap-3">
              {/* PDF icon badge with PDF label */}
              <div className="w-11 h-11 rounded-lg bg-red-500 flex flex-col items-center justify-center flex-shrink-0">
                <FileText size={16} className="text-white" />
                <span className="text-white text-[8px] font-bold mt-0.5">PDF</span>
              </div>
              
              {/* File details */}
              <div className="flex-1 min-w-0">
                <p className="text-white text-[15px] font-medium leading-tight line-clamp-2">
                  {fileName || 'Document.pdf'}
                </p>
                <p className="text-white/70 text-[13px] mt-1">
                  1 page • PDF • {formatFileSize(fileSize)}
                </p>
              </div>
            </div>
            
            {/* Timestamp row - right aligned */}
            <div className="flex justify-end mt-2">
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-white/70">
                  {formatTimestamp(timestamp)}
                </span>
                {renderStatusCheck()}
              </div>
            </div>
          </div>
          
          {/* Action buttons - Ouvrir / Enregistrer sous */}
          <div className="bg-[#4a4cb9] flex border-t border-[#6a6cd9]">
            <button
              onClick={handleOpenFile}
              className="flex-1 py-3 text-white text-sm font-medium hover:bg-[#5a5cc9] transition-colors"
            >
              Ouvrir
            </button>
            <div className="w-px bg-[#6a6cd9]" />
            <button
              onClick={handleDownload}
              className="flex-1 py-3 text-white text-sm font-medium hover:bg-[#5a5cc9] transition-colors"
            >
              Enregistrer sous...
            </button>
          </div>
        </div>
      ) : (
        /* Standard document card - for Word, Excel, etc. */
        <div className="rounded-xl overflow-hidden max-w-[320px]">
          {/* Document info section - accent color background */}
          <div className="bg-[#5a5cc9] p-3">
            <div className="flex items-start gap-3">
              {/* Document type icon - Word/Excel style */}
              {getWordStyleIcon(extension)}
              
              {/* File details */}
              <div className="flex-1 min-w-0">
                <p className="text-white text-[15px] font-medium leading-tight line-clamp-2">
                  {fileName || 'Document'}
                </p>
                <p className="text-white/70 text-[13px] mt-1">
                  {extension.toUpperCase()} • {formatFileSize(fileSize)}
                </p>
              </div>
            </div>
            
            {/* Timestamp row - right aligned */}
            <div className="flex justify-end mt-2">
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-white/70">
                  {formatTimestamp(timestamp)}
                </span>
                {renderStatusCheck()}
              </div>
            </div>
          </div>
          
          {/* Action buttons - Ouvrir / Enregistrer sous */}
          <div className="bg-[#4a4cb9] flex border-t border-[#6a6cd9]">
            <button
              onClick={handleOpenFile}
              className="flex-1 py-3 text-white text-sm font-medium hover:bg-[#5a5cc9] transition-colors"
            >
              Ouvrir
            </button>
            <div className="w-px bg-[#6a6cd9]" />
            <button
              onClick={handleDownload}
              className="flex-1 py-3 text-white text-sm font-medium hover:bg-[#5a5cc9] transition-colors"
            >
              Enregistrer sous...
            </button>
          </div>
        </div>
      )}
      
      {/* Caption below if present */}
      {caption && (
        <p className={`mt-1.5 text-sm whitespace-pre-wrap break-words ${isOwn ? 'text-white' : 'text-text-primary'}`}>
          {caption}
        </p>
      )}
    </div>
  );
};