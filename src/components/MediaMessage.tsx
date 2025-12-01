import React, { useState } from 'react';
import { Download, File, Play, X } from 'lucide-react';

interface MediaMessageProps {
  url: string;
  type: 'image' | 'video' | 'file';
  fileName?: string;
  fileSize?: number;
  caption?: string;
}

export const MediaMessage: React.FC<MediaMessageProps> = ({
  url,
  type,
  fileName,
  fileSize,
  caption,
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

        {/* Fullscreen modal */}
        {isFullscreen && (
          <div
            className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
            onClick={() => setIsFullscreen(false)}
          >
            <button
              onClick={() => setIsFullscreen(false)}
              className="absolute top-4 right-4 p-2 rounded-full bg-white/10 backdrop-blur-sm hover:bg-white/20 transition-colors"
            >
              <X size={24} className="text-white" />
            </button>
            <img
              src={url}
              alt="Image"
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </>
    );
  }

  if (type === 'video') {
    return (
      <div className="relative max-w-[240px] sm:max-w-[280px]">
        <video
          src={url}
          controls
          className="w-full h-auto rounded-lg max-h-[200px] sm:max-h-[240px]"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
        {caption && (
          <p className="mt-1.5 text-sm">{caption}</p>
        )}
      </div>
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