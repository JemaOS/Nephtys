// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MediaViewer } from './MediaViewer';
import { calculateDisplayDimensions } from '@/lib/imageUtils';
import { MessageHoverActions } from './MessageHoverActions';
import {
  ImageRenderer,
  VideoRenderer,
  FileMessage,
  getMimeTypeFromExtension,
  formatVideoDuration
} from './MediaMessageComponents';

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
  // Track the currently displayed media index in the viewer (for navigation)
  const [viewerIndex, setViewerIndex] = useState(currentIndex ?? 0);
  
  // Reset viewer index when currentIndex prop changes (e.g., when opening a different image)
  useEffect(() => {
    if (currentIndex !== undefined) {
      setViewerIndex(currentIndex);
    }
  }, [currentIndex]);

  // Handle navigation within the viewer - update local state, don't close viewer
  const handleNavigate = (index: number) => {
    setViewerIndex(index);
    // Also notify parent if needed (for state sync)
    if (onNavigate) {
      onNavigate(index);
    }
  };

  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(
    propWidth && propHeight ? { width: propWidth, height: propHeight } : null
  );
  const [videoDuration, setVideoDuration] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement>(null);

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
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Error downloading file:', error);
    }
  };

  // Helper to fetch file as blob - extracted for complexity reduction
  const fetchFileBlob = async (): Promise<{ blob: Blob; mimeType: string } | null> => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const mimeType = blob.type || getMimeTypeFromExtension(fileName || '');
      return { blob, mimeType };
    } catch (error) {
      console.error('Error fetching file:', error);
      return null;
    }
  };

  // Helper to share file using Web Share API - extracted for complexity reduction
  const shareFileWithAPI = async (blob: Blob, mimeType: string): Promise<boolean | 'aborted'> => {
    if (!navigator.canShare) return false;
    
    const shareFile = new window.File([blob], fileName || 'document', { type: mimeType });
    if (!navigator.canShare({ files: [shareFile] })) return false;
    
    try {
      await navigator.share({ files: [shareFile], title: fileName || 'Document' });
      return true;
    } catch (error: any) {
      if (error.name === 'AbortError') return 'aborted';
      throw error;
    }
  };

  // Helper to open file with fallback - extracted for complexity reduction
  const openFileWithFallback = async (blob: Blob, mimeType: string): Promise<void> => {
    const fileUrl = URL.createObjectURL(blob);
    const newWindow = window.open(fileUrl, '_blank');
    
    if (!newWindow) {
      const a = document.createElement('a');
      a.href = fileUrl;
      a.download = fileName || 'document';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    
    setTimeout(() => URL.revokeObjectURL(fileUrl), 5000);
  };

  // Open file with native app using Web Share API (shows "Open with" dialog on mobile)
  const handleOpenFile = useCallback(async () => {
    // On mobile/PWA, try to use Web Share API to show "Open with" dialog
    if (isMobile || isPWA) {
      const fileData = await fetchFileBlob();
      if (!fileData) {
        handleDownload();
        return;
      }
      
      const { blob, mimeType } = fileData;
      
      // Try Web Share API first
      const shareResult = await shareFileWithAPI(blob, mimeType);
      if (shareResult === true) return;
      if (shareResult === 'aborted') return;
      
      // Fallback: try to open directly
      await openFileWithFallback(blob, mimeType);
    } else {
      // On desktop, open in new tab
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [url, fileName, isMobile, isPWA]);

  // Helper: Get container style based on dimensions - extracted to reduce complexity
  // Note: This is intentionally duplicated from ImageRenderer for component independence
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

  // Helper: Determine media type for viewer (handle GIF detection) - extracted
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

  // Handle video metadata load
  useEffect(() => {
    if (type === 'video' && videoRef.current) {
      const video = videoRef.current;
      const handleLoadedMetadata = () => {
        if (video.duration && !Number.isNaN(video.duration)) {
          setVideoDuration(formatVideoDuration(video.duration));
        }
      };
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    }
  }, [type]);

  // Use extracted ImageRenderer component - reduces cognitive complexity
  if (type === 'image') {
    return (
      <>
        <ImageRenderer
          url={url}
          thumbnail={thumbnail}
          caption={caption}
          imageDimensions={imageDimensions}
          propWidth={propWidth}
          propHeight={propHeight}
          imageLoaded={imageLoaded}
          imageError={imageError}
          timestamp={timestamp}
          status={status}
          isOwn={isOwn}
          isStarred={isStarred}
          showHoverActions={showHoverActions}
          onOpenMenu={onOpenMenu}
          onImageLoad={(e) => {
            const img = e.target as HTMLImageElement;
            if (!propWidth || !propHeight) {
              setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
            }
            setImageLoaded(true);
          }}
          onImageError={() => setImageError(true)}
          onImageClick={() => !imageError && setIsFullscreen(true)}
        />

        {/* MediaViewer for fullscreen */}
        <MediaViewer
          isOpen={isFullscreen}
          mediaUrl={allMedia && allMedia[viewerIndex] ? allMedia[viewerIndex].url : url}
          mediaType={allMedia && allMedia[viewerIndex] ? allMedia[viewerIndex].type : getViewerMediaType()}
          senderName={allMedia && allMedia[viewerIndex] ? allMedia[viewerIndex].senderName : senderName}
          senderAvatar={allMedia && allMedia[viewerIndex] ? allMedia[viewerIndex].senderAvatar : senderAvatar}
          timestamp={allMedia && allMedia[viewerIndex] ? allMedia[viewerIndex].timestamp : timestamp}
          isOwn={allMedia && allMedia[viewerIndex] ? allMedia[viewerIndex].isOwn : isOwn}
          isStarred={isStarred}
          onClose={() => {
            setIsFullscreen(false);
            if (currentIndex !== undefined) {
              setViewerIndex(currentIndex);
            }
          }}
          onForward={onForward}
          onStar={onStar}
          onPin={onPin}
          onReaction={onReaction}
          allMedia={allMedia}
          currentIndex={viewerIndex}
          onNavigate={handleNavigate}
        />
      </>
    );
  }

  // Use extracted VideoRenderer component - reduces cognitive complexity
  if (type === 'video') {
    return (
      <>
        <VideoRenderer
          url={url}
          caption={caption}
          videoDuration={videoDuration}
          timestamp={timestamp}
          status={status}
          isOwn={isOwn}
          showHoverActions={showHoverActions}
          onOpenMenu={onOpenMenu}
          onVideoClick={() => setIsFullscreen(true)}
        />

        {/* MediaViewer for fullscreen video */}
        <MediaViewer
          isOpen={isFullscreen}
          mediaUrl={allMedia && allMedia[viewerIndex] ? allMedia[viewerIndex].url : url}
          mediaType={allMedia && allMedia[viewerIndex] ? allMedia[viewerIndex].type : 'video'}
          senderName={allMedia && allMedia[viewerIndex] ? allMedia[viewerIndex].senderName : senderName}
          senderAvatar={allMedia && allMedia[viewerIndex] ? allMedia[viewerIndex].senderAvatar : senderAvatar}
          timestamp={allMedia && allMedia[viewerIndex] ? allMedia[viewerIndex].timestamp : timestamp}
          isOwn={allMedia && allMedia[viewerIndex] ? allMedia[viewerIndex].isOwn : isOwn}
          isStarred={isStarred}
          onClose={() => {
            setIsFullscreen(false);
            if (currentIndex !== undefined) {
              setViewerIndex(currentIndex);
            }
          }}
          onForward={onForward}
          onStar={onStar}
          onPin={onPin}
          onReaction={onReaction}
          allMedia={allMedia}
          currentIndex={viewerIndex}
          onNavigate={handleNavigate}
        />
      </>
    );
  }

  return (
    <FileMessage
      fileName={fileName}
      fileSize={fileSize}
      timestamp={timestamp}
      status={status}
      isOwn={isOwn}
      thumbnail={thumbnail}
      caption={caption}
      handleOpenFile={handleOpenFile}
      handleDownload={handleDownload}
      onOpenMenu={onOpenMenu}
      showHoverActions={showHoverActions}
    />
  );
};
