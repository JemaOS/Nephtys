import React, { useRef, useEffect } from 'react';
import { File, Play, Copy, FileText, FileSpreadsheet, FileImage, FileArchive } from 'lucide-react';
import { MessageHoverActions } from './MessageHoverActions';

// Custom hook to preload next images in viewport
const useMediaPreloader = (mediaUrls: string[], currentIndex: number) => {
  useEffect(() => {
    // Preload next 2 images after current one
    for (let i = 1; i <= 2; i++) {
      const nextIndex = currentIndex + i;
      if (nextIndex < mediaUrls.length) {
        const img = new Image();
        img.src = mediaUrls[nextIndex];
      }
    }
  }, [mediaUrls, currentIndex]);
};

// Generate srcSet for responsive images (if using Supabase storage with transformations)
const generateSrcSet = (url: string, widths: number[] = [320, 640, 960, 1280]): string => {
  if (!url?.includes('supabase')) return '';
  
  // For Supabase storage, we can use the public URL with transformation params
  // This assumes the storage bucket supports image transformations
  return widths
    .map(w => `${url}?width=${w} ${w}w`)
    .join(', ');
};

// Generate blur placeholder URL (tiny version for fast loading)
const generateBlurPlaceholder = (url: string): string => {
  if (!url) return '';
  // For Supabase, add width param to get a tiny version
  if (url.includes('supabase')) {
    return `${url}?width=20&quality=10`;
  }
  return url;
};

// Helper function to format file size
export const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' ko';
  return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
};

// Helper function to get file extension
export const getFileExtension = (filename?: string): string => {
  if (!filename) return '';
  const parts = filename.split('.');
  return parts.length > 1 ? parts.at(-1)?.toLowerCase() || '' : '';
};

// Helper function to get icon background color based on file type
export const getFileIconConfig = (extension: string): { bgColor: string; icon: React.ReactNode } => {
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

// Helper function to get MIME type from filename
export const getMimeTypeFromExtension = (filename: string): string => {
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

// Helper function to format video duration
export const formatVideoDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Helper function to format timestamp
export const formatMessageTimestamp = (ts: string): string => {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

// Type alias for message status
export type MessageStatus = 'sent' | 'delivered' | 'read';

// Media timestamp overlay status uses the same type alias
export type MediaTimestampStatus = MessageStatus;

// Helper function to render status check SVG
export const renderStatusCheckmark = (status?: MessageStatus): React.ReactNode => {
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

// Helper function to get Word-style icon for document types
export const getDocumentTypeIcon = (extension: string, bgColor: string, defaultIcon: React.ReactNode): React.ReactNode => {
  const ext = extension.toLowerCase();
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) {
    return (
      <div className="w-11 h-11 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
        <span className="text-white font-bold text-xl">W</span>
      </div>
    );
  }
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) {
    return (
      <div className="w-11 h-11 rounded-lg bg-green-600 flex items-center justify-center flex-shrink-0">
        <span className="text-white font-bold text-xl">X</span>
      </div>
    );
  }
  if (['ppt', 'pptx', 'odp'].includes(ext)) {
    return (
      <div className="w-11 h-11 rounded-lg bg-orange-600 flex items-center justify-center flex-shrink-0">
        <span className="text-white font-bold text-xl">P</span>
      </div>
    );
  }
  return (
    <div className={`w-11 h-11 rounded-lg ${bgColor} flex items-center justify-center flex-shrink-0`}>
      {defaultIcon}
    </div>
  );
};

// Helper component for timestamp overlay inside media
export const MediaTimestampOverlay: React.FC<{
  timestamp: string;
  status?: MediaTimestampStatus;
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

// Type alias for image renderer status
export type ImageRendererStatus = MessageStatus;

// Extracted Image renderer component
export const ImageRenderer: React.FC<{
  url: string;
  thumbnail?: string;
  caption?: string;
  imageDimensions: { width: number; height: number } | null;
  propWidth?: number;
  propHeight?: number;
  imageLoaded: boolean;
  imageError: boolean;
  timestamp: string;
  status?: ImageRendererStatus;
  isOwn: boolean;
  isStarred: boolean;
  showHoverActions: boolean;
  onOpenMenu?: (e: React.MouseEvent) => void;
  onImageLoad?: (e: React.SyntheticEvent) => void;
  onImageError: () => void;
  onImageClick: () => void;
  // New props for optimization
  preloadNext?: boolean;
  nextImageUrl?: string;
}> = ({
  url, thumbnail, caption, imageDimensions, propWidth, propHeight,
  imageLoaded, imageError, timestamp, status, isOwn, isStarred,
  showHoverActions, onOpenMenu, onImageLoad, onImageError, onImageClick,
  preloadNext, nextImageUrl
}) => {
  // Preload next image when this one loads
  useEffect(() => {
    if (imageLoaded && preloadNext && nextImageUrl) {
      const img = new Image();
      img.src = nextImageUrl;
    }
  }, [imageLoaded, preloadNext, nextImageUrl]);
  
  // Generate srcSet for responsive loading
  const srcSet = generateSrcSet(url);
  const blurPlaceholder = thumbnail || generateBlurPlaceholder(url);
  
  const hasKnownDimensions = !!imageDimensions;
  
  return (
    <>
      <button
        type="button"
        className="relative cursor-pointer overflow-hidden rounded-xl border-[3px] border-[#787add] group message-media-container text-left w-full bg-transparent p-0"
        onClick={onImageClick}
        aria-label="Afficher l'image en plein écran"
      >
        {onOpenMenu && (
          <MessageHoverActions
            isVisible={showHoverActions}
            isOwn={isOwn}
            onOpenMenu={onOpenMenu}
          />
        )}
        {/* Blur-up placeholder - shows tiny thumbnail while loading */}
        {!imageLoaded && !imageError && blurPlaceholder && (
          <div
            className="absolute inset-0 bg-cover bg-center transition-opacity duration-300"
            style={{
              backgroundImage: `url(${blurPlaceholder})`,
              filter: 'blur(10px)',
              transform: 'scale(1.1)',
            }}
          />
        )}
        {!imageLoaded && !imageError && !thumbnail && (
          <div
            className="absolute inset-0 bg-gradient-to-br from-[#1a1a1a] to-[#2a2a2a] animate-pulse"
            style={hasKnownDimensions ? {} : { aspectRatio: '4/3' }}
          />
        )}
        {!imageLoaded && !imageError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-10">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}
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
        <img
          src={url}
          srcSet={srcSet}
          sizes="(max-width: 480px) 100vw, (max-width: 768px) 50vw, 33vw"
          alt=""
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          loading="lazy"
          decoding="async"
          onLoad={(e) => {
            if (onImageLoad) {
              onImageLoad(e);
            }
          }}
          onError={onImageError}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
        {imageLoaded && !imageError && (
          <MediaTimestampOverlay
            timestamp={timestamp}
            status={status}
            isOwn={isOwn}
          />
        )}
      </button>
      {caption && (
        <p className="mt-1.5 text-sm whitespace-pre-wrap break-words">{caption}</p>
      )}
    </>
  );
};

// Type alias for video renderer status
export type VideoRendererStatus = MessageStatus;

// Extracted Video renderer component
export const VideoRenderer: React.FC<{
  url: string;
  caption?: string;
  videoDuration: string;
  timestamp: string;
  status?: VideoRendererStatus;
  isOwn: boolean;
  showHoverActions: boolean;
  onOpenMenu?: (e: React.MouseEvent) => void;
  onVideoClick: () => void;
}> = ({
  url, caption, videoDuration, timestamp, status, isOwn,
  showHoverActions, onOpenMenu, onVideoClick
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  return (
    <>
      <button
        type="button"
        className="relative cursor-pointer overflow-hidden rounded-xl border-[3px] border-[#787add] max-w-[280px] group message-media-container text-left w-full bg-transparent p-0"
        onClick={onVideoClick}
        aria-label="Lire la vidéo"
      >
        {onOpenMenu && (
          <MessageHoverActions
            isVisible={showHoverActions}
            isOwn={isOwn}
            onOpenMenu={onOpenMenu}
          />
        )}
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
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-black/60 flex items-center justify-center backdrop-blur-sm">
              <Play size={28} className="text-white ml-1" fill="white" />
            </div>
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" />
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 bg-white/90 text-black text-[10px] font-bold rounded">
              HD
            </span>
            {videoDuration && (
              <span className="text-white text-xs font-medium drop-shadow-lg">
                {videoDuration}
              </span>
            )}
          </div>
          <MediaTimestampOverlay
            timestamp={timestamp}
            status={status}
            isOwn={isOwn}
          />
          <div className="absolute top-2 left-2">
            <Copy size={16} className="text-white drop-shadow-lg" />
          </div>
        </div>
      </button>
      {caption && (
        <p className="mt-1.5 text-sm whitespace-pre-wrap break-words">{caption}</p>
      )}
    </>
  );
};

interface FileMessageProps {
  fileName?: string;
  fileSize?: number;
  timestamp: string;
  status?: 'sent' | 'delivered' | 'read';
  isOwn: boolean;
  thumbnail?: string;
  caption?: string;
  handleOpenFile: () => void;
  handleDownload: () => void;
  onOpenMenu?: (e: React.MouseEvent) => void;
  showHoverActions: boolean;
}

export const FileMessage: React.FC<FileMessageProps> = ({
  fileName,
  fileSize,
  timestamp,
  status,
  isOwn,
  thumbnail,
  caption,
  handleOpenFile,
  handleDownload,
  onOpenMenu,
  showHoverActions,
}) => {
  const extension = getFileExtension(fileName);
  const { bgColor, icon } = getFileIconConfig(extension);
  const isPDF = extension === 'pdf';
  const hasThumbnail = isPDF && thumbnail;

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
          <button
            className="relative w-full bg-white cursor-pointer block"
            onClick={handleOpenFile}
            aria-label="Ouvrir le fichier"
          >
            <img
              src={thumbnail}
              alt={fileName || 'PDF'}
              className="w-full h-auto max-h-[200px] object-cover object-top"
            />
          </button>
          
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
                  {formatMessageTimestamp(timestamp)}
                </span>
                {renderStatusCheckmark(isOwn ? status : undefined)}
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
              {getDocumentTypeIcon(extension, bgColor, icon)}
              
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
                  {formatMessageTimestamp(timestamp)}
                </span>
                {renderStatusCheckmark(isOwn ? status : undefined)}
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
