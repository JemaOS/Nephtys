// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Maximize2, Minimize2, Move } from 'lucide-react';

interface YouTubePlayerProps {
  videoId: string;
  title?: string;
  onClose: () => void;
}

interface Position {
  x: number;
  y: number;
}

/**
 * Extract YouTube video ID from various URL formats
 * Uses native URL API for better performance and security
 */
export const extractYouTubeVideoId = (url: string): string | null => {
  try {
    const urlObj = new URL(url);
    const { hostname, pathname, searchParams } = urlObj;
    
    // Handle youtu.be/VIDEO_ID
    if (hostname.includes('youtu.be')) {
      const videoId = pathname.slice(1);
      return videoId.length === 11 ? videoId : null;
    }
    
    // Handle youtube.com domains
    if (hostname.includes('youtube.com') || hostname.includes('youtube-nocookie.com')) {
      // Handle /watch?v=VIDEO_ID
      if (pathname === '/watch') {
        const videoId = searchParams.get('v');
        return videoId?.length === 11 ? videoId : null;
      }
      
      // Handle /embed/, /v/, /shorts/, /live/
      const pathParts = pathname.split('/');
      const validPrefixes = ['embed', 'v', 'shorts', 'live'];
      // pathParts[0] is empty string because pathname starts with /
      if (validPrefixes.includes(pathParts[1]) && pathParts[2]?.length === 11) {
        return pathParts[2];
      }
    }
  } catch {
    // Invalid URL
  }
  
  return null;
};

/**
 * Check if a URL is a YouTube video
 * Uses native URL API for better performance
 */
export const isYouTubeUrl = (url: string): boolean => {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const isYouTube = hostname === 'youtube.com' || hostname === 'www.youtube.com' || 
                      hostname.includes('youtube.com') || hostname.includes('youtube-nocookie.com') || 
                      hostname === 'youtu.be' || hostname.includes('youtu.be');
    return isYouTube && extractYouTubeVideoId(url) !== null;
  } catch {
    return false;
  }
};

/**
 * YouTubePlayer Component
 * Fullscreen video player with Picture-in-Picture support
 */
export const YouTubePlayer: React.FC<YouTubePlayerProps> = ({
  videoId,
  title,
  onClose,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [isPiP, setIsPiP] = useState(false);
  const [pipPosition, setPipPosition] = useState<Position>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pipRef = useRef<HTMLDivElement>(null);

  // Initialize PiP position to bottom-right
  useEffect(() => {
    if (isPiP && pipPosition.x === 0 && pipPosition.y === 0) {
      const windowWidth = globalThis.innerWidth;
      const windowHeight = globalThis.innerHeight;
      const pipWidth = 280;
      const pipHeight = 158; // 16:9 aspect ratio
      setPipPosition({
        x: windowWidth - pipWidth - 16,
        y: windowHeight - pipHeight - 80, // Above bottom nav
      });
    }
  }, [isPiP]);

  // Handle drag start
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!pipRef.current) return;
    
    setIsDragging(true);
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    setDragOffset({
      x: clientX - pipPosition.x,
      y: clientY - pipPosition.y,
    });
  }, [pipPosition]);

  // Handle drag move
  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDragging) return;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const pipWidth = 280;
    const pipHeight = 158;
    const windowWidth = globalThis.innerWidth;
    const windowHeight = globalThis.innerHeight;
    
    // Calculate new position with bounds checking
    let newX = clientX - dragOffset.x;
    let newY = clientY - dragOffset.y;
    
    // Keep within screen bounds
    newX = Math.max(8, Math.min(windowWidth - pipWidth - 8, newX));
    newY = Math.max(8, Math.min(windowHeight - pipHeight - 8, newY));
    
    setPipPosition({ x: newX, y: newY });
  }, [isDragging, dragOffset]);

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add/remove drag event listeners
  useEffect(() => {
    if (isDragging) {
      globalThis.addEventListener('mousemove', handleDragMove);
      globalThis.addEventListener('mouseup', handleDragEnd);
      globalThis.addEventListener('touchmove', handleDragMove);
      globalThis.addEventListener('touchend', handleDragEnd);
    }
    
    return () => {
      globalThis.removeEventListener('mousemove', handleDragMove);
      globalThis.removeEventListener('mouseup', handleDragEnd);
      globalThis.removeEventListener('touchmove', handleDragMove);
      globalThis.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);


  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    globalThis.addEventListener('keydown', handleKeyDown);
    return () => globalThis.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Toggle PiP mode
  const togglePiP = () => {
    setIsPiP(!isPiP);
    setIsFullscreen(false);
  };

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (isPiP) {
      setIsPiP(false);
      setIsFullscreen(true);
    } else {
      setIsFullscreen(!isFullscreen);
    }
  };

  // YouTube embed URL with autoplay
  const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1&rel=0&modestbranding=1&playsinline=1`;

  // PiP mode - small floating player with drag support
  if (isPiP) {
    return (
      <div
        ref={pipRef}
        className={`fixed z-[100] w-[280px] rounded-xl overflow-hidden shadow-2xl bg-black ${
          isDragging ? 'cursor-grabbing' : ''
        }`}
        style={{
          aspectRatio: '16/9',
          left: `${pipPosition.x}px`,
          top: `${pipPosition.y}px`,
          transition: isDragging ? 'none' : 'box-shadow 0.2s',
          boxShadow: isDragging ? '0 25px 50px -12px rgba(0, 0, 0, 0.5)' : undefined,
        }}
      >
        {/* Drag Handle - Full header area */}
        <button
          type="button"
          className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/80 to-transparent p-2 flex items-center justify-between cursor-grab active:cursor-grabbing text-left"
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
          aria-label="Déplacer le lecteur"
        >
          {/* Drag indicator */}
          <div className="flex items-center gap-1.5 flex-1 mr-2">
            <Move size={12} className="text-white/60" />
            <span className="text-white text-xs truncate">{title || 'YouTube'}</span>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleFullscreen();
              }}
              className="w-7 h-7 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors"
              aria-label="Plein écran"
            >
              <Maximize2 size={14} className="text-white" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="w-7 h-7 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors"
              aria-label="Fermer"
            >
              <X size={14} className="text-white" />
            </button>
          </div>
        </button>

        {/* Video iframe */}
        <iframe
          ref={iframeRef}
          src={embedUrl}
          title="YouTube video player"
          className="w-full h-full pointer-events-auto"
          style={{ pointerEvents: isDragging ? 'none' : 'auto' }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
          allowFullScreen
        />
      </div>
    );
  }

  // Fullscreen mode
  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] bg-black flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent absolute top-0 left-0 right-0 z-10">
        <button
          type="button"
          onClick={togglePiP}
          className="w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors"
          title="Picture-in-Picture"
          aria-label="Mode Picture-in-Picture"
        >
          <Minimize2 size={20} className="text-white" />
        </button>
        
        <button
          type="button"
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors"
          aria-label="Fermer"
        >
          <X size={20} className="text-white" />
        </button>
      </div>

      {/* Video Container */}
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-4xl" style={{ aspectRatio: '16/9' }}>
          <iframe
            ref={iframeRef}
            src={embedUrl}
            title="YouTube video player"
            className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
          allowFullScreen
          />
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
        {/* Title */}
        {title && (
          <p className="text-white text-sm mb-2 truncate">{title}</p>
        )}
        
        {/* PiP button */}
        <div className="flex items-center justify-end text-white text-xs">
          <button
            type="button"
            onClick={togglePiP}
            className="px-3 py-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white text-xs flex items-center gap-1 transition-colors"
          >
            <Minimize2 size={14} />
            <span>PiP</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default YouTubePlayer;
