import React, { useState } from 'react';
import { Download, File, Play, X } from 'lucide-react';
import { MediaViewer } from './MediaViewer';

interface MediaMessageProps {
  url: string;
  type: 'image' | 'video' | 'file';
  fileName?: string;
  fileSize?: number;
  caption?: string;
  // Optional props for MediaViewer
  senderName?: string;
  senderAvatar?: string;
  timestamp?: string;
  isOwn?: boolean;
  messageId?: string;
  onForward?: () => void;
  onStar?: () => void;
  onPin?: () => void;
  onReaction?: (emoji: string) => void;
}

export const MediaMessage: React.FC<MediaMessageProps> = ({
  url,
  type,
  fileName,
  fileSize,
  caption,
  senderName = 'Utilisateur',
  senderAvatar,
  timestamp = new Date().toISOString(),
  isOwn = false,
  messageId,
  onForward,
  onStar,
  onPin,
  onReaction,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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

  if (type === 'image') {
    return (
      <>
        <div className="relative cursor-pointer max-w-[240px] sm:max-w-[280px]" onClick={() => setIsFullscreen(true)}>
          <img
            src={url}
            alt="Image"
            className="w-full h-auto rounded-lg max-h-[200px] sm:max-h-[240px] object-cover"
            loading="lazy"
          />
          {caption && (
            <p className="mt-1.5 text-sm">{caption}</p>
          )}
        </div>

        {/* MediaViewer for fullscreen */}
        <MediaViewer
          isOpen={isFullscreen}
          mediaUrl={url}
          mediaType={getViewerMediaType()}
          senderName={senderName}
          senderAvatar={senderAvatar}
          timestamp={timestamp}
          isOwn={isOwn}
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
        <div className="relative max-w-[240px] sm:max-w-[280px] cursor-pointer" onClick={() => setIsFullscreen(true)}>
          {/* Video thumbnail with play button overlay */}
          <div className="relative">
            <video
              src={url}
              className="w-full h-auto rounded-lg max-h-[200px] sm:max-h-[240px] object-cover"
              muted
              playsInline
              preload="metadata"
            />
            {/* Play button overlay */}
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-lg">
              <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                <Play size={24} className="text-white ml-1" />
              </div>
            </div>
          </div>
          {caption && (
            <p className="mt-1.5 text-sm">{caption}</p>
          )}
        </div>

        {/* MediaViewer for fullscreen video */}
        <MediaViewer
          isOpen={isFullscreen}
          mediaUrl={url}
          mediaType="video"
          senderName={senderName}
          senderAvatar={senderAvatar}
          timestamp={timestamp}
          isOwn={isOwn}
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