import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, ChevronLeft, ChevronRight, Forward, Star, Pin, Smile, Share2, Download, Play, Pause, Volume2, VolumeX, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
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
  const audioRef = useRef<HTMLAudioElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const swipeVelocityRef = useRef<number>(0);
  const lastTouchTimeRef = useRef<number>(0);
  const lastTouchXRef = useRef<number>(0);

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
          e.preventDefault();
          if (allMedia && currentIndex > 0 && onNavigate) {
            onNavigate(currentIndex - 1);
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (allMedia && currentIndex < allMedia.length - 1 && onNavigate) {
            onNavigate(currentIndex + 1);
          }
          break;
        case ' ':
          e.preventDefault();
          // Toggle play/pause for video/audio
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
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentIndex, allMedia, onNavigate, onClose, mediaType]);

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

  // Handle touch move for pinch-to-zoom, pan, and swipe navigation (WhatsApp-like)
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // IMPORTANT: Stop propagation to prevent parent components from receiving touch events
    e.stopPropagation();
    
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
    } else if (e.touches.length === 1 && touchStartX !== null && touchStartY !== null) {
      const touch = e.touches[0];
      const currentX = touch.clientX;
      const currentY = touch.clientY;
      
      if (zoom > 1 && isDragging) {
        // Pan when zoomed in - single finger drag
        e.preventDefault();
        setPosition({
          x: currentX - dragStart.x,
          y: currentY - dragStart.y
        });
      } else if (zoom <= 1 && allMedia && allMedia.length > 1 && isSwipeActive) {
        // Single touch swipe for navigation - WhatsApp-like instant following
        const diffX = currentX - touchStartX;
        const diffY = currentY - touchStartY;
        
        // Determine swipe direction on first significant movement
        if (swipeDirection === null && (Math.abs(diffX) > 10 || Math.abs(diffY) > 10)) {
          if (Math.abs(diffX) > Math.abs(diffY)) {
            setSwipeDirection('horizontal');
          } else {
            setSwipeDirection('vertical');
            setIsSwipeActive(false);
            return;
          }
        }
        
        // Only process horizontal swipes
        if (swipeDirection === 'horizontal') {
          e.preventDefault();
          
          // Calculate velocity for momentum
          const now = Date.now();
          const timeDelta = now - lastTouchTimeRef.current;
          if (timeDelta > 0) {
            swipeVelocityRef.current = (currentX - lastTouchXRef.current) / timeDelta;
          }
          lastTouchTimeRef.current = now;
          lastTouchXRef.current = currentX;
          
          // Apply resistance at edges (WhatsApp-like behavior)
          let adjustedOffset = diffX;
          const isAtStart = currentIndex === 0 && diffX > 0;
          const isAtEnd = currentIndex === allMedia.length - 1 && diffX < 0;
          
          if (isAtStart || isAtEnd) {
            // Apply rubber band effect at edges
            adjustedOffset = diffX * 0.3;
          }
          
          setSwipeOffset(adjustedOffset);
        }
      }
    }
  }, [initialPinchDistance, initialZoom, pinchCenter, touchStartX, touchStartY, zoom, allMedia, currentIndex, isSwipeActive, swipeDirection, isDragging, dragStart]);

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
      const velocity = swipeVelocityRef.current;
      const shouldNavigate = Math.abs(swipeOffset) > SWIPE_THRESHOLD || Math.abs(velocity) > SWIPE_VELOCITY_THRESHOLD;
      
      if (shouldNavigate) {
        // Determine direction based on offset or velocity
        const goNext = swipeOffset < 0 || (swipeOffset === 0 && velocity < 0);
        const goPrev = swipeOffset > 0 || (swipeOffset === 0 && velocity > 0);
        
        if (goPrev && currentIndex > 0) {
          // Swipe right - go to previous - INSTANT navigation
          onNavigate?.(currentIndex - 1);
          setSwipeOffset(0);
        } else if (goNext && currentIndex < allMedia.length - 1) {
          // Swipe left - go to next - INSTANT navigation
          onNavigate?.(currentIndex + 1);
          setSwipeOffset(0);
        } else {
          // At edge, snap back
          setSwipeOffset(0);
        }
      } else {
        // Not enough swipe distance/velocity, snap back
        setSwipeOffset(0);
      }
    } else {
      setSwipeOffset(0);
    }
    
    // Reset touch state
    setTouchStartX(null);
    setTouchStartY(null);
    setIsSwipeActive(false);
    setSwipeDirection(null);
  }, [initialPinchDistance, touchStartX, zoom, allMedia, currentIndex, onNavigate, swipeOffset, swipeDirection]);

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

  // Track fullscreen state
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Toggle fullscreen mode
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        
        // Try to lock orientation to landscape for videos
        // Using type assertion because lock() is part of the experimental Screen Orientation API
        if (mediaType === 'video' && window.screen?.orientation) {
          const orientation = window.screen.orientation as ScreenOrientation & {
            lock?: (orientation: string) => Promise<void>;
            unlock?: () => void;
          };
          if (orientation.lock) {
            try {
              await orientation.lock('landscape');
            } catch (e) {
              // Orientation lock not supported or not allowed
              console.log('Orientation lock not available');
            }
          }
        }
      } else {
        await document.exitFullscreen();
        
        // Unlock orientation
        if (window.screen?.orientation) {
          const orientation = window.screen.orientation as ScreenOrientation & {
            unlock?: () => void;
          };
          if (orientation.unlock) {
            orientation.unlock();
          }
        }
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
    }
  }, [mediaType]);

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
      } ${isFullscreen ? 'fullscreen-active' : ''}`}
      onClick={() => setShowControls(true)}
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
          <div className="flex items-center gap-0.5 md:gap-2 flex-shrink-0">
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
                onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                className="w-9 h-9 md:w-10 md:h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
                title={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
              >
                <Maximize2 size={18} className={`text-white ${isFullscreen ? 'rotate-45' : ''}`} />
              </button>
            )}
            {/* Share - visible on mobile */}
            <button
              onClick={(e) => { e.stopPropagation(); handleShare(); }}
              className="w-9 h-9 md:w-10 md:h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
              title="Partager"
            >
              <Share2 size={18} className="md:hidden text-white" />
              <Share2 size={20} className="hidden md:block text-white" />
            </button>
            {/* Download - visible on mobile */}
            <button
              onClick={(e) => { e.stopPropagation(); handleDownload(); }}
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
          <div className={`relative ${isLandscape && isMobile ? 'w-full h-full' : 'max-w-full max-h-full'}`}>
            <video
              ref={videoRef}
              src={mediaUrl}
              className={`object-contain ${
                isLandscape && isMobile
                  ? 'w-full h-full max-w-none max-h-none'
                  : 'max-w-full max-h-[80vh]'
              }`}
              playsInline
              webkit-playsinline="true"
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