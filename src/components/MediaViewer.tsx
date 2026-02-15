// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, ChevronLeft, ChevronRight, Forward, Star, Pin, Smile, Share2, Download, Play, Pause, Volume2, VolumeX, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

// Helper component for header actions - extracted to reduce complexity
const HeaderActions: React.FC<{
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
}> = ({
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
          disabled={zoom <= MIN_ZOOM}
        >
          <ZoomOut size={20} className="text-white" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); handleZoomIn(); }}
          className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
          title="Zoom avant"
          disabled={zoom >= MAX_ZOOM}
        >
          <ZoomIn size={20} className="text-white" />
        </button>
        {zoom !== 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); handleResetZoom(); }}
            className="px-2 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors text-white text-sm"
            title="Réinitialiser le zoom"
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
      >
        <Forward size={20} className="text-white" />
      </button>
    )}
    {onStar && (
      <button
        onClick={(e) => { e.stopPropagation(); onStar(); }}
        className="hidden md:flex w-10 h-10 rounded-full hover:bg-white/10 items-center justify-center transition-colors"
        title={isStarred ? "Retirer des favoris" : "Ajouter aux favoris"}
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
      >
        <Maximize2 size={18} className={`text-white ${isFullscreen ? 'rotate-45' : ''}`} />
      </button>
    )}
    {/* Share - visible on mobile */}
    <button
      onClick={(e) => { e.stopPropagation(); onShare(); }}
      className="w-9 h-9 md:w-10 md:h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
      title="Partager"
    >
      <Share2 size={18} className="md:hidden text-white" />
      <Share2 size={20} className="hidden md:block text-white" />
    </button>
    {/* Download - visible on mobile */}
    <button
      onClick={(e) => { e.stopPropagation(); onDownload(); }}
      className="w-9 h-9 md:w-10 md:h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
      title="Télécharger"
    >
      <Download size={18} className="md:hidden text-white" />
      <Download size={20} className="hidden md:block text-white" />
    </button>
    {/* Close button - always visible */}
    <button
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      className="w-9 h-9 md:w-10 md:h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
      title="Fermer"
    >
      <X size={22} className="md:hidden text-white" />
      <X size={24} className="hidden md:block text-white" />
    </button>
  </div>
);

// Custom hook for mobile detection
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      // Check for touch capability and screen width
      const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth < 768;
      setIsMobile(hasTouchScreen && isSmallScreen);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
};

// Custom hook for screen orientation
const useScreenOrientation = () => {
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    const updateOrientation = () => {
      // Check orientation using multiple methods for better compatibility
      if (window.screen?.orientation?.type) {
        const type = window.screen.orientation.type;
        const landscape = type.includes('landscape');
        setOrientation(landscape ? 'landscape' : 'portrait');
        setIsLandscape(landscape);
      } else if (window.matchMedia) {
        const landscape = window.matchMedia('(orientation: landscape)').matches;
        setOrientation(landscape ? 'landscape' : 'portrait');
        setIsLandscape(landscape);
      } else {
        // Fallback: compare window dimensions
        const landscape = window.innerWidth > window.innerHeight;
        setOrientation(landscape ? 'landscape' : 'portrait');
        setIsLandscape(landscape);
      }
    };

    updateOrientation();

    // Listen for orientation changes
    if (window.screen?.orientation) {
      window.screen.orientation.addEventListener('change', updateOrientation);
    }
    window.addEventListener('orientationchange', updateOrientation);
    window.addEventListener('resize', updateOrientation);

    return () => {
      if (window.screen?.orientation) {
        window.screen.orientation.removeEventListener('change', updateOrientation);
      }
      window.removeEventListener('orientationchange', updateOrientation);
      window.removeEventListener('resize', updateOrientation);
    };
  }, []);

  return { orientation, isLandscape };
};

interface MediaViewerProps {
  isOpen: boolean;
  mediaUrl: string;
  mediaType: 'image' | 'video' | 'audio' | 'gif' | 'sticker';
  senderName: string;
  senderAvatar?: string;
  timestamp: string;
  isOwn: boolean;
  isStarred?: boolean;
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
  isStarred = false,
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
  const isMobile = useIsMobile();
  const { orientation, isLandscape } = useScreenOrientation();
  const [showControls, setShowControls] = useState(true);
  const [isHoveringControls, setIsHoveringControls] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  // Video progress state
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isSeeking, setIsSeeking] = useState(false);
  const progressBarRef = useRef<HTMLDivElement>(null);
  
  // Touch/swipe state for navigation - WhatsApp-like
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwipeActive, setIsSwipeActive] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'horizontal' | 'vertical' | null>(null);
  
  // Pinch-to-zoom state
  const [initialPinchDistance, setInitialPinchDistance] = useState<number | null>(null);
  const [initialZoom, setInitialZoom] = useState(1);
  const [pinchCenter, setPinchCenter] = useState<{ x: number; y: number } | null>(null);
  
  // Navigation transition state
  const [isNavigating, setIsNavigating] = useState(false);
  const [navigationDirection, setNavigationDirection] = useState<'left' | 'right' | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const swipeVelocityRef = useRef<number>(0);
  const lastTouchTimeRef = useRef<number>(0);
  const lastTouchXRef = useRef<number>(0);
  const lastClickTimeRef = useRef<number>(0);

  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 5;
  const ZOOM_STEP = 0.25;
  const SWIPE_THRESHOLD = 50; // Minimum swipe distance to trigger navigation
  const SWIPE_VELOCITY_THRESHOLD = 0.3; // Minimum velocity for quick swipe

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

  // Helper to start the auto-hide timer
  const startHideTimer = useCallback(() => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (mediaType === 'video' || mediaType === 'audio') {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  }, [mediaType]);

  // Auto-hide controls logic
  useEffect(() => {
    if (showControls && !isHoveringControls) {
      startHideTimer();
    } else {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    }
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [showControls, isHoveringControls, startHideTimer]);

  // Handle mouse move to show controls
  const handleContainerMouseMove = useCallback(() => {
    if (!showControls) {
      setShowControls(true);
    } else if (!isHoveringControls) {
      // Reset timer if controls are already shown and not hovering controls
      startHideTimer();
    }
  }, [showControls, isHoveringControls, startHideTimer]);

  // Helper: Handle keyboard navigation
  const handleKeyboardNavigation = useCallback((key: string): boolean => {
    if (key === 'ArrowLeft') {
      if (allMedia && currentIndex > 0 && onNavigate) {
        onNavigate(currentIndex - 1);
        return true;
      }
    } else if (key === 'ArrowRight') {
      if (allMedia && currentIndex < allMedia.length - 1 && onNavigate) {
        onNavigate(currentIndex + 1);
        return true;
      }
    }
    return false;
  }, [allMedia, currentIndex, onNavigate]);

  // Helper: Toggle media playback (video/audio)
  const toggleMediaPlayback = useCallback(() => {
    if (mediaType === 'video' && videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
    } else if (mediaType === 'audio' && audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play();
      } else {
        audioRef.current.pause();
      }
    }
  }, [mediaType]);

  // Handle keyboard events
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return;
    
    switch (e.key) {
      case 'Escape':
        onClose();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault();
        handleKeyboardNavigation(e.key);
        break;
      case ' ':
        e.preventDefault();
        toggleMediaPlayback();
        break;
    }
  }, [isOpen, onClose, handleKeyboardNavigation, toggleMediaPlayback]);

  // Handle keyboard navigation
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Reset zoom and swipe state when media changes or viewer closes
  useEffect(() => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
    setSwipeOffset(0);
    setTouchStartX(null);
    setTouchStartY(null);
    setIsSwipeActive(false);
    setSwipeDirection(null);
    setIsNavigating(false);
    setNavigationDirection(null);
  }, [mediaUrl, isOpen]);

  // Robust auto-play handling
  useEffect(() => {
    if (!isOpen || !mediaUrl) return;

    const playMedia = async (element: HTMLMediaElement) => {
      try {
        // Check if source is valid
        if (!element.src || element.src === window.location.href) {
          console.warn("Media source is empty or invalid");
          return;
        }

        if (element.readyState >= 3) { // HAVE_FUTURE_DATA
          await element.play();
        } else {
          // Wait for canplay event
          const handleCanPlay = async () => {
            try {
              await element.play();
            } catch (e) {
              console.error("Auto-play failed in listener:", e);
            }
          };
          element.addEventListener('canplay', handleCanPlay, { once: true });
        }
      } catch (error) {
        console.error("Auto-play failed:", error);
      }
    };

    // Small timeout to ensure ref is populated
    const timer = setTimeout(() => {
      if (mediaType === 'video' && videoRef.current) {
        playMedia(videoRef.current);
      } else if (mediaType === 'audio' && audioRef.current) {
        playMedia(audioRef.current);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [isOpen, mediaUrl, mediaType]);

  // Handle mouse wheel zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    if (mediaType !== 'image' && mediaType !== 'gif' && mediaType !== 'sticker') return;
    
    e.preventDefault();
    
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom(prevZoom => {
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prevZoom + delta));
      
      // Reset position if zooming back to 1 or below
      if (newZoom <= 1) {
        setPosition({ x: 0, y: 0 });
      }
      
      return newZoom;
    });
  }, [mediaType]);

  // Add wheel event listener
  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container || !isOpen) return;

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [isOpen, handleWheel]);

  // Handle drag to pan when zoomed
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [zoom, position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || zoom <= 1) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  }, [isDragging, dragStart, zoom]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(MAX_ZOOM, prev + ZOOM_STEP));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => {
      const newZoom = Math.max(MIN_ZOOM, prev - ZOOM_STEP);
      if (newZoom <= 1) {
        setPosition({ x: 0, y: 0 });
      }
      return newZoom;
    });
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  // Calculate distance between two touch points
  const getTouchDistance = (touches: React.TouchList): number => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Get center point between two touches
  const getTouchCenter = (touches: React.TouchList): { x: number; y: number } => {
    if (touches.length < 2) return { x: 0, y: 0 };
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  };

  // Handle touch start for pinch-to-zoom, pan, and swipe navigation (WhatsApp-like)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // IMPORTANT: Stop propagation to prevent parent components (like chat view) from receiving touch events
    e.stopPropagation();
    
    if (e.touches.length === 2) {
      // Pinch gesture started
      e.preventDefault();
      const distance = getTouchDistance(e.touches);
      setInitialPinchDistance(distance);
      setInitialZoom(zoom);
      setPinchCenter(getTouchCenter(e.touches));
      setIsSwipeActive(false);
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      setTouchStartX(touch.clientX);
      setTouchStartY(touch.clientY);
      
      if (zoom > 1) {
        // When zoomed in, single touch is for panning
        e.preventDefault(); // Prevent any default behavior when zoomed
        setIsDragging(true);
        setDragStart({ x: touch.clientX - position.x, y: touch.clientY - position.y });
        setIsSwipeActive(false);
      } else {
        // When not zoomed, single touch is for swipe navigation
        setSwipeDirection(null);
        setIsSwipeActive(true);
        lastTouchTimeRef.current = Date.now();
        lastTouchXRef.current = touch.clientX;
        swipeVelocityRef.current = 0;
      }
    }
  }, [zoom, position]);

  // Helper: Handle pinch-to-zoom gesture
  const handlePinchZoom = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialPinchDistance !== null) {
      // Pinch gesture in progress
      e.preventDefault();
      const currentDistance = getTouchDistance(e.touches);
      const scale = currentDistance / initialPinchDistance;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, initialZoom * scale));
      setZoom(newZoom);
      
      // Update position based on pinch center
      if (pinchCenter && newZoom > 1) {
        const center = getTouchCenter(e.touches);
        setPosition({
          x: (center.x - pinchCenter.x) * (newZoom - 1),
          y: (center.y - pinchCenter.y) * (newZoom - 1),
        });
      }
    }
  }, [initialPinchDistance, initialZoom, pinchCenter]);

  // Helper: Handle pan gesture when zoomed in
  const handlePanGesture = useCallback((e: React.TouchEvent, currentX: number, currentY: number) => {
    if (zoom > 1 && isDragging) {
      // Pan when zoomed in - single finger drag
      e.preventDefault();
      setPosition({
        x: currentX - dragStart.x,
        y: currentY - dragStart.y
      });
    }
  }, [zoom, isDragging, dragStart]);

  // Helper: Determine swipe direction - extracted to reduce complexity
  const determineSwipeDirection = useCallback((diffX: number, diffY: number): 'horizontal' | 'vertical' | null => {
    if (Math.abs(diffX) > Math.abs(diffY)) {
      return 'horizontal';
    }
    return 'vertical';
  }, []);

  // Helper: Calculate adjusted swipe offset with edge resistance - extracted
  const calculateSwipeOffset = useCallback((diffX: number): number => {
    const isAtStart = currentIndex === 0 && diffX > 0;
    const isAtEnd = currentIndex === allMedia.length - 1 && diffX < 0;
    
    // Apply rubber band effect at edges
    if (isAtStart || isAtEnd) {
      return diffX * 0.3;
    }
    return diffX;
  }, [currentIndex, allMedia]);

  // Helper: Update swipe with velocity tracking - extracted
  const updateSwipeWithVelocity = useCallback((currentX: number) => {
    const now = Date.now();
    const timeDelta = now - lastTouchTimeRef.current;
    if (timeDelta > 0) {
      swipeVelocityRef.current = (currentX - lastTouchXRef.current) / timeDelta;
    }
    lastTouchTimeRef.current = now;
    lastTouchXRef.current = currentX;
  }, []);

  // Helper: Handle horizontal swipe navigation - extracted to reduce complexity
  const handleHorizontalSwipe = useCallback((diffX: number) => {
    if (!allMedia || allMedia.length <= 1 || zoom > 1) return;
    
    const adjustedOffset = calculateSwipeOffset(diffX);
    updateSwipeWithVelocity(touchStartX + diffX);
    setSwipeOffset(adjustedOffset);
  }, [allMedia, zoom, touchStartX, calculateSwipeOffset, updateSwipeWithVelocity]);

  // Helper: Handle vertical swipe or direction detection - extracted
  const handleSwipeDirectionDetection = useCallback((diffX: number, diffY: number) => {
    if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
      const direction = determineSwipeDirection(diffX, diffY);
      if (direction === 'horizontal') {
        setSwipeDirection('horizontal');
      } else {
        setSwipeDirection('vertical');
        setIsSwipeActive(false);
      }
    }
  }, [determineSwipeDirection]);

  // Handle touch move for pinch-to-zoom, pan, and swipe navigation (WhatsApp-like)
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // IMPORTANT: Stop propagation to prevent parent components from receiving touch events
    e.stopPropagation();
    
    // Handle pinch-to-zoom
    handlePinchZoom(e);
    
    // Handle single touch events
    if (e.touches.length === 1 && touchStartX !== null && touchStartY !== null) {
      const touch = e.touches[0];
      const currentX = touch.clientX;
      const currentY = touch.clientY;
      
      // Handle pan when zoomed in
      handlePanGesture(e, currentX, currentY);
      
      // Handle swipe navigation when not zoomed
      const canSwipe = zoom <= 1 && allMedia && allMedia.length > 1 && isSwipeActive;
      
      if (canSwipe && swipeDirection === 'horizontal') {
        const diffX = currentX - touchStartX;
        handleHorizontalSwipe(diffX);
      } else if (canSwipe && swipeDirection === null) {
        const diffX = currentX - touchStartX;
        const diffY = currentY - touchStartY;
        handleSwipeDirectionDetection(diffX, diffY);
      }
    }
  }, [handlePinchZoom, handlePanGesture, touchStartX, touchStartY, zoom, allMedia, isSwipeActive, swipeDirection, handleHorizontalSwipe, handleSwipeDirectionDetection]);

  // Helper: Check if navigation should happen based on swipe - extracted to reduce complexity
  const shouldNavigateFromSwipe = useCallback((currentIndex: number, allMediaLength: number): 'prev' | 'next' | null => {
    const velocity = swipeVelocityRef.current;
    const hasEnoughDistance = Math.abs(swipeOffset) > SWIPE_THRESHOLD;
    const hasEnoughVelocity = Math.abs(velocity) > SWIPE_VELOCITY_THRESHOLD;
    
    if (!hasEnoughDistance && !hasEnoughVelocity) {
      return null;
    }
    
    const goingNext = swipeOffset < 0 || (swipeOffset === 0 && velocity < 0);
    const goingPrev = swipeOffset > 0 || (swipeOffset === 0 && velocity > 0);
    
    if (goingPrev && currentIndex > 0) {
      return 'prev';
    }
    if (goingNext && currentIndex < allMediaLength - 1) {
      return 'next';
    }
    return null;
  }, [swipeOffset, swipeOffset]);

  // Handle touch end for pinch-to-zoom, pan, and swipe navigation (WhatsApp-like)
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // IMPORTANT: Stop propagation to prevent parent components from receiving touch events
    e.stopPropagation();
    
    // Reset pinch state
    if (initialPinchDistance !== null) {
      setInitialPinchDistance(null);
      setPinchCenter(null);
      
      // Reset position if zoom is back to 1 or below
      if (zoom <= 1) {
        setPosition({ x: 0, y: 0 });
      }
    }
    
    // Reset dragging state
    setIsDragging(false);
    
    // Handle swipe navigation with velocity consideration - INSTANT navigation like WhatsApp
    if (touchStartX !== null && zoom <= 1 && allMedia && allMedia.length > 1 && swipeDirection === 'horizontal') {
      const navigation = shouldNavigateFromSwipe(currentIndex, allMedia.length);
      
      if (navigation === 'prev') {
        onNavigate?.(currentIndex - 1);
      } else if (navigation === 'next') {
        onNavigate?.(currentIndex + 1);
      }
      
      // Always reset swipe offset
      setSwipeOffset(0);
    } else {
      setSwipeOffset(0);
    }
    
    // Reset touch state
    setTouchStartX(null);
    setTouchStartY(null);
    setIsSwipeActive(false);
    setSwipeDirection(null);
  }, [initialPinchDistance, touchStartX, zoom, allMedia, currentIndex, onNavigate, swipeDirection, shouldNavigateFromSwipe]);

  // Prevent body scroll when viewer is open and handle fullscreen
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.body.classList.add('media-viewer-open');
      
      // On mobile, try to enable fullscreen for better landscape experience
      if (isMobile && document.documentElement.requestFullscreen) {
        // Don't auto-fullscreen, let user control it
      }
    } else {
      document.body.style.overflow = '';
      document.body.classList.remove('media-viewer-open');
      
      // Exit fullscreen when closing
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    }
    return () => {
      document.body.style.overflow = '';
      document.body.classList.remove('media-viewer-open');
    };
  }, [isOpen, isMobile]);

  // Track fullscreen state - with vendor prefix support
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
      setIsFullscreen(isCurrentlyFullscreen);
    };

    // Also handle video-specific fullscreen events (iOS)
    const handleVideoFullscreenChange = () => {
      if (videoRef.current) {
        // Check if video is in fullscreen mode
        const video = videoRef.current as HTMLVideoElement & {
          webkitDisplayingFullscreen?: boolean;
        };
        if (video.webkitDisplayingFullscreen !== undefined) {
          setIsFullscreen(video.webkitDisplayingFullscreen);
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    // iOS video fullscreen events
    if (videoRef.current) {
      videoRef.current.addEventListener('webkitbeginfullscreen', () => setIsFullscreen(true));
      videoRef.current.addEventListener('webkitendfullscreen', () => setIsFullscreen(false));
    }
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      
      if (videoRef.current) {
        videoRef.current.removeEventListener('webkitbeginfullscreen', () => setIsFullscreen(true));
        videoRef.current.removeEventListener('webkitendfullscreen', () => setIsFullscreen(false));
      }
    };
  }, [mediaType]);

  // Detect if running as installed PWA
  const isPWA = useMemo(() => {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.matchMedia('(display-mode: fullscreen)').matches ||
           (window.navigator as any).standalone === true;
  }, []);

  // Detect Android specifically
  const isAndroid = useMemo(() => {
    return /Android/i.test(navigator.userAgent);
  }, []);

  // Helper: Check if currently in fullscreen mode
  const checkFullscreenState = (): boolean => {
    return !!(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement
    );
  };

  // Helper: Request fullscreen for video element on mobile - extracted to reduce complexity
  const requestVideoFullscreen = async (video: HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitRequestFullscreen?: () => Promise<void>; mozRequestFullScreen?: () => Promise<void>; msRequestFullscreen?: () => Promise<void>; webkitSupportsFullscreen?: boolean; webkitDisplayingFullscreen?: boolean; }, isCurrentlyFullscreen: boolean): Promise<boolean> => {
    // iOS Safari native fullscreen
    if (video.webkitEnterFullscreen && video.webkitSupportsFullscreen !== false) {
      try {
        video.webkitEnterFullscreen();
        return true;
      } catch (e) {
        console.log('webkitEnterFullscreen failed:', e);
      }
    }

    // Android PWA: Request fullscreen on video element
    if (isAndroid && isPWA) {
      if (video.requestFullscreen) {
        await video.requestFullscreen();
        return true;
      } else if (video.webkitRequestFullscreen) {
        await video.webkitRequestFullscreen();
        return true;
      }
    }

    // Other mobile browsers - try standard fullscreen
    if (video.requestFullscreen) {
      await video.requestFullscreen();
      return true;
    } else if (video.webkitRequestFullscreen) {
      await video.webkitRequestFullscreen();
      return true;
    }

    return false;
  };

  // Helper: Try fullscreen with container - extracted to reduce complexity
  const tryFullscreenWithContainer = async (): Promise<boolean> => {
    const container = videoContainerRef.current;
    if (!container) return false;

    if (container.requestFullscreen) {
      await container.requestFullscreen();
      return true;
    } else if ((container as any).webkitRequestFullscreen) {
      await (container as any).webkitRequestFullscreen();
      return true;
    } else if ((container as any).mozRequestFullScreen) {
      await (container as any).mozRequestFullScreen();
      return true;
    } else if ((container as any).msRequestFullscreen) {
      await (container as any).msRequestFullscreen();
      return true;
    }
    return false;
  };

  // Helper: Request document fullscreen - extracted to reduce complexity
  const tryDocumentFullscreen = async (): Promise<boolean> => {
    const docEl = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
      mozRequestFullScreen?: () => Promise<void>;
      msRequestFullscreen?: () => Promise<void>;
    };
    
    if (docEl.requestFullscreen) {
      await docEl.requestFullscreen();
      return true;
    } else if (docEl.webkitRequestFullscreen) {
      await docEl.webkitRequestFullscreen();
      return true;
    } else if (docEl.mozRequestFullScreen) {
      await docEl.mozRequestFullScreen();
      return true;
    } else if (docEl.msRequestFullscreen) {
      await docEl.msRequestFullscreen();
      return true;
    }
    return false;
  };

  // Helper: Exit fullscreen - extracted to reduce complexity
  const doExitFullscreen = async (): Promise<void> => {
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void>;
      mozCancelFullScreen?: () => Promise<void>;
      msExitFullscreen?: () => Promise<void>;
    };
    
    if (doc.exitFullscreen) {
      await doc.exitFullscreen();
    } else if (doc.webkitExitFullscreen) {
      await doc.webkitExitFullscreen();
    } else if (doc.mozCancelFullScreen) {
      await doc.mozCancelFullScreen();
    } else if (doc.msExitFullscreen) {
      await doc.msExitFullscreen();
    }
    
    // Unlock orientation (only if not PWA)
    if (window.screen?.orientation && !isPWA) {
      try {
        // @ts-ignore - unlock is experimental
        window.screen.orientation.unlock();
      } catch (e) {
        // Ignore unlock errors
      }
    }
  };

  // Helper: Enter fullscreen for video - extracted to reduce complexity
  const enterVideoFullscreen = async (): Promise<boolean> => {
    if (!videoRef.current) return false;
    
    const video = videoRef.current;
    const success = await requestVideoFullscreen(video, false);
    
    if (success) {
      setIsFullscreen(true);
      return true;
    }
    
    // Fallback to container fullscreen
    const containerSuccess = await tryFullscreenWithContainer();
    if (containerSuccess) {
      setIsFullscreen(true);
      return true;
    }
    
    // Try orientation lock
    await tryOrientationLock();
    setIsFullscreen(true);
    return true;
  };

  // Try orientation lock - extracted to reduce complexity
  const tryOrientationLock = async (): Promise<void> => {
    if (!isPWA && window.screen?.orientation) {
      try {
        // @ts-ignore - lock is experimental
        await window.screen.orientation.lock('landscape');
      } catch (e) {
        console.log('Orientation lock not available:', e);
      }
    }
  };

  // Toggle fullscreen mode - refactored for reduced complexity
  const toggleFullscreen = useCallback(async () => {
    try {
      const isCurrentlyFullscreen = checkFullscreenState();
      
      if (!isCurrentlyFullscreen) {
        // Enter fullscreen
        if (mediaType === 'video' && videoRef.current) {
          await enterVideoFullscreen();
        } else {
          // For images, use document fullscreen
          const docSuccess = await tryDocumentFullscreen();
          if (docSuccess) {
            setIsFullscreen(true);
          }
        }
      } else {
        // Exit fullscreen
        await doExitFullscreen();
        setIsFullscreen(false);
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
      // Even if fullscreen fails, try to toggle the state for UI feedback
      setIsFullscreen(!isFullscreen);
    }
  }, [mediaType, isFullscreen, isMobile, isPWA, isAndroid]);

  // Desktop navigation - instant like WhatsApp
  const handlePrevious = useCallback(() => {
    if (allMedia && currentIndex > 0 && onNavigate) {
      onNavigate(currentIndex - 1);
    }
  }, [allMedia, currentIndex, onNavigate]);

  const handleNext = useCallback(() => {
    if (allMedia && currentIndex < allMedia.length - 1 && onNavigate) {
      onNavigate(currentIndex + 1);
    }
  }, [allMedia, currentIndex, onNavigate]);

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

  // Format time for video progress (MM:SS)
  const formatVideoTime = (seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle video time update
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current && !isSeeking) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, [isSeeking]);

  // Handle video loaded metadata
  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  }, []);

  // Handle seeking via progress bar
  const handleProgressBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !videoRef.current) return;
    
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = percentage * duration;
    
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration]);

  // Handle seeking via touch/drag on progress bar
  const handleProgressBarTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setIsSeeking(true);
    
    if (!progressBarRef.current || !videoRef.current) return;
    
    const rect = progressBarRef.current.getBoundingClientRect();
    const touchX = e.touches[0].clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, touchX / rect.width));
    const newTime = percentage * duration;
    
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration]);

  const handleProgressBarTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!isSeeking || !progressBarRef.current || !videoRef.current) return;
    
    const rect = progressBarRef.current.getBoundingClientRect();
    const touchX = e.touches[0].clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, touchX / rect.width));
    const newTime = percentage * duration;
    
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, [isSeeking, duration]);

  const handleProgressBarTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setIsSeeking(false);
  }, []);

  // Cycle through playback rates
  const cyclePlaybackRate = useCallback(() => {
    const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const currentIndex = rates.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % rates.length;
    const newRate = rates[nextIndex];
    
    setPlaybackRate(newRate);
    if (videoRef.current) {
      videoRef.current.playbackRate = newRate;
    }
  }, [playbackRate]);

  // Calculate progress percentage
  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

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

  const quickEmojis = ['❤️', '😂', '😮', '😢', '🙏', '👍'];

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-[200] bg-black flex flex-col media-viewer-fullscreen ${
        isLandscape && isMobile ? 'landscape-mode' : ''
      } ${isFullscreen ? 'fullscreen-active' : ''} ${!showControls ? 'cursor-none' : ''}`}
      onClick={() => setShowControls(true)}
      onMouseMove={handleContainerMouseMove}
      style={{
        // Ensure the viewer takes full screen on mobile in any orientation
        width: '100%',
        height: '100%',
        // Use viewport units that account for mobile browser chrome
        minHeight: isMobile ? '100dvh' : '100vh',
      }}
    >
      {/* Header */}
      <div
        className={`absolute top-0 left-0 right-0 z-10 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onMouseEnter={() => setIsHoveringControls(true)}
        onMouseLeave={() => setIsHoveringControls(false)}
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

          {/* Right side - Action buttons - using extracted component */}
          <HeaderActions
            onForward={onForward}
            onStar={onStar}
            onPin={onPin}
            onReaction={onReaction}
            onShare={handleShare}
            onDownload={handleDownload}
            onClose={onClose}
            onToggleFullscreen={toggleFullscreen}
            isStarred={isStarred}
            showEmojiPicker={showEmojiPicker}
            setShowEmojiPicker={setShowEmojiPicker}
            isMobile={isMobile}
            mediaType={mediaType}
            isFullscreen={isFullscreen}
            zoom={zoom}
            MIN_ZOOM={MIN_ZOOM}
            MAX_ZOOM={MAX_ZOOM}
            handleZoomIn={handleZoomIn}
            handleZoomOut={handleZoomOut}
            handleResetZoom={handleResetZoom}
            quickEmojis={quickEmojis}
          />
        </div>
      </div>

      {/* Navigation arrows - Desktop only (hidden on mobile) */}
      {allMedia && allMedia.length > 1 && !isMobile && (
        <>
          {/* Previous button */}
          <button
            onClick={(e) => { e.stopPropagation(); handlePrevious(); }}
            disabled={currentIndex === 0}
            className={`absolute left-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-all duration-200 ${
              currentIndex === 0 ? 'opacity-30 cursor-not-allowed' : 'opacity-100 hover:scale-110'
            } ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >
            <ChevronLeft size={28} className="text-white" />
          </button>

          {/* Next button */}
          <button
            onClick={(e) => { e.stopPropagation(); handleNext(); }}
            disabled={currentIndex === allMedia.length - 1}
            className={`absolute right-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-all duration-200 ${
              currentIndex === allMedia.length - 1 ? 'opacity-30 cursor-not-allowed' : 'opacity-100 hover:scale-110'
            } ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >
            <ChevronRight size={28} className="text-white" />
          </button>
        </>
      )}

      {/* Media content */}
      <div
        className={`flex-1 flex items-center justify-center overflow-hidden media-content-container ${
          isLandscape && isMobile ? 'p-0' : 'p-4 md:p-8'
        }`}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={(e) => {
          e.stopPropagation();
          handleTouchEnd(e);
        }}
        style={{
          // Always use touch-action: none to prevent browser default behaviors and ensure we handle all touch events
          touchAction: 'none',
        }}
      >
        {/* Image, GIF, Sticker - all displayed fullscreen with zoom and swipe */}
        {(mediaType === 'image' || mediaType === 'gif' || mediaType === 'sticker') && (
          <div
            ref={imageContainerRef}
            className={`relative flex items-center justify-center w-full h-full ${
              zoom > 1 ? 'cursor-grab' : 'cursor-default'
            } ${isDragging ? 'cursor-grabbing' : ''}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
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
        )}

        {/* Video */}
        {mediaType === 'video' && (
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
                webkit-playsinline="true"
                // Android-specific attributes for better video handling
                // @ts-ignore - x5 attributes for Android WebView/browsers
                x5-video-player-type="h5-page"
                x5-video-player-fullscreen="true"
                x5-video-orientation="landscape"
                // Allow fullscreen on iOS
                // @ts-ignore
                allowsInlineMediaPlayback={true}
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
              />
              
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
            >
              <div className="flex items-center gap-3">
                {/* Current time */}
                <span className="text-white text-sm font-medium min-w-[45px] text-center">
                  {formatVideoTime(currentTime)}
                </span>
                
                {/* Progress bar */}
                <div
                  ref={progressBarRef}
                  className="flex-1 h-8 flex items-center cursor-pointer group"
                  onClick={handleProgressBarClick}
                  onTouchStart={handleProgressBarTouchStart}
                  onTouchMove={handleProgressBarTouchMove}
                  onTouchEnd={handleProgressBarTouchEnd}
                >
                  <div className="w-full h-1 bg-white/30 rounded-full relative">
                    {/* Progress fill - using app accent color */}
                    <div
                      className="absolute left-0 top-0 h-full bg-[#787add] rounded-full transition-all"
                      style={{ width: `${progressPercentage}%` }}
                    />
                    {/* Seek handle - using app accent color */}
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-[#787add] rounded-full shadow-lg transition-transform group-hover:scale-125"
                      style={{ left: `calc(${progressPercentage}% - 8px)` }}
                    />
                  </div>
                </div>
                
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
                >
                  x {playbackRate.toFixed(1).replace('.0', ',0')}
                </button>

                {/* Fullscreen toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen();
                  }}
                  className="text-white hover:bg-white/10 p-1.5 rounded transition-colors ml-1"
                  title={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
                >
                  <Maximize2 size={20} className={isFullscreen ? 'rotate-45' : ''} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Audio */}
        {mediaType === 'audio' && (
          <div className="w-full max-w-md bg-bg-surface rounded-2xl p-6">
            <audio
              ref={audioRef}
              src={mediaUrl}
              muted={isMuted}
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