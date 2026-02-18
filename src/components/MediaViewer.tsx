// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MediaViewerHeader, ImageViewer, VideoPlayer, AudioPlayer } from './MediaViewerComponents';

// Constants for zoom levels - extracted to module level
const MIN_ZOOM_DEFAULT = 0.5;
const MAX_ZOOM_DEFAULT = 5;
const ZOOM_STEP_DEFAULT = 0.25;
const SWIPE_THRESHOLD_DEFAULT = 50;
const SWIPE_VELOCITY_THRESHOLD_DEFAULT = 0.3;

// Calculate touch distance helper - extracted to module level
const getTouchDistance = (touches: React.TouchList): number => {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
};

// Get touch center helper - extracted to module level
const getTouchCenter = (touches: React.TouchList): { x: number; y: number } => {
  if (touches.length < 2) return { x: 0, y: 0 };
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
};

// Check fullscreen state helper - extracted to module level
const checkFullscreenState = (): boolean => {
  return !!(
    document.fullscreenElement ||
    (document as any).webkitFullscreenElement ||
    (document as any).mozFullScreenElement ||
    (document as any).msFullscreenElement
  );
};

// Custom hook for mobile detection
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      // Check for touch capability and screen width
      const hasTouchScreen = 'ontouchstart' in globalThis || navigator.maxTouchPoints > 0;
      const isSmallScreen = globalThis.innerWidth < 768;
      setIsMobile(hasTouchScreen && isSmallScreen);
    };

    checkMobile();
    globalThis.addEventListener('resize', checkMobile);
    return () => globalThis.removeEventListener('resize', checkMobile);
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
      if (globalThis.screen?.orientation?.type) {
        const type = globalThis.screen.orientation.type;
        const landscape = type.includes('landscape');
        setOrientation(landscape ? 'landscape' : 'portrait');
        setIsLandscape(landscape);
      } else if (globalThis.matchMedia) {
        const landscape = globalThis.matchMedia('(orientation: landscape)').matches;
        setOrientation(landscape ? 'landscape' : 'portrait');
        setIsLandscape(landscape);
      } else {
        // Fallback: compare window dimensions
        const landscape = globalThis.innerWidth > globalThis.innerHeight;
        setOrientation(landscape ? 'landscape' : 'portrait');
        setIsLandscape(landscape);
      }
    };

    updateOrientation();

    // Listen for orientation changes
    if (globalThis.screen?.orientation) {
      globalThis.screen.orientation.addEventListener('change', updateOrientation);
    }
    globalThis.addEventListener('orientationchange', updateOrientation);
    globalThis.addEventListener('resize', updateOrientation);

    return () => {
      if (globalThis.screen?.orientation) {
        globalThis.screen.orientation.removeEventListener('change', updateOrientation);
      }
      globalThis.removeEventListener('orientationchange', updateOrientation);
      globalThis.removeEventListener('resize', updateOrientation);
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
  const { isLandscape } = useScreenOrientation();
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
  
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const imageContainerRef = useRef<HTMLButtonElement>(null);
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
    } else if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
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
  }, [mediaUrl, isOpen]);

  // Robust auto-play handling
  useEffect(() => {
    if (!isOpen || !mediaUrl) return;

    const playMedia = async (element: HTMLMediaElement) => {
      try {
        // Check if source is valid
        if (!element.src || element.src === globalThis.location.href) {
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

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, [mediaType]);

  // Detect if running as installed PWA
  const isPWA = useMemo(() => {
    return globalThis.matchMedia('(display-mode: standalone)').matches ||
           globalThis.matchMedia('(display-mode: fullscreen)').matches ||
           (globalThis.navigator as any).standalone === true;
  }, []);

  // Detect Android specifically
  const isAndroid = useMemo(() => {
    return /Android/i.test(navigator.userAgent);
  }, []);

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
    if (globalThis.screen?.orientation && !isPWA) {
      try {
        globalThis.screen.orientation.unlock();
      } catch (e) {
        // Ignore unlock errors - orientation unlock is optional
        console.log('Orientation unlock not available:', e);
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
    if (!isPWA && globalThis.screen?.orientation) {
      try {
        // @ts-expect-error - lock is experimental API not in TypeScript types
        await globalThis.screen.orientation.lock('landscape');
      } catch (e) {
        console.log('Orientation lock not available:', e);
      }
    }
  };

  // Toggle fullscreen mode - refactored for reduced complexity
  const toggleFullscreen = useCallback(async () => {
    try {
      const isCurrentlyFullscreen = checkFullscreenState();
      
      if (isCurrentlyFullscreen) {
        // Exit fullscreen
        await doExitFullscreen();
        setIsFullscreen(false);
        return;
      }
      
      // Enter fullscreen for video
      if (mediaType === 'video' && videoRef.current) {
        await enterVideoFullscreen();
        return;
      }
      
      // For images, use document fullscreen
      const docSuccess = await tryDocumentFullscreen();
      if (docSuccess) {
        setIsFullscreen(true);
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
      // Even if fullscreen fails, try to toggle the state for UI feedback
      setIsFullscreen(!isFullscreen);
    }
  }, [mediaType, isFullscreen]);

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
    const currentRateIndex = rates.indexOf(playbackRate);
    const nextIndex = (currentRateIndex + 1) % rates.length;
    const newRate = rates[nextIndex];
    
    setPlaybackRate(newRate);
    if (videoRef.current) {
      videoRef.current.playbackRate = newRate;
    }
  }, [playbackRate]);

  // Helper: Get file extension based on media type - extracted to reduce complexity
  const getMediaExtension = (type: string): string => {
    if (type === 'video') return 'mp4';
    if (type === 'audio') return 'webm';
    if (type === 'gif') return 'gif';
    return 'jpg';
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(mediaUrl);
      const blob = await response.blob();
      const url = globalThis.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const extension = getMediaExtension(mediaType);
      a.download = `media-${Date.now()}.${extension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      globalThis.URL.revokeObjectURL(url);
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
        // User cancelled share or share failed - log for debugging
        console.log('Share cancelled or failed:', error);
      }
    } else {
      // Fallback: copy URL to clipboard
      try {
        await navigator.clipboard.writeText(mediaUrl);
        alert('Lien copié !');
        onShare?.();
      } catch (clipboardError) {
        console.error('Failed to copy to clipboard:', clipboardError);
      }
    }
  };

  const quickEmojis = ['❤️', '😂', '😮', '😢', '🙏', '👍'];

  // Focus the viewer on mount for keyboard accessibility
  const viewerRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (isOpen && viewerRef.current) {
      // Use native dialog showModal method for proper accessibility
      if (!(viewerRef.current as HTMLDialogElement & { open?: boolean }).open) {
        (viewerRef.current as HTMLDialogElement).showModal();
      }
    }
    return () => {
      if (viewerRef.current && (viewerRef.current as HTMLDialogElement & { open?: boolean }).open) {
        (viewerRef.current as HTMLDialogElement).close();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const landscapeModeClass = isLandscape && isMobile ? 'landscape-mode' : '';
  const fullscreenActiveClass = isFullscreen ? 'fullscreen-active' : '';
  const cursorNoneClass = showControls ? '' : 'cursor-none';

  return (
    <dialog
      ref={viewerRef}
      className={`fixed inset-0 z-[200] bg-black flex flex-col media-viewer-fullscreen m-0 p-0 w-full h-full max-w-none max-h-none text-left ${landscapeModeClass} ${fullscreenActiveClass} ${cursorNoneClass}`}
      aria-modal="true"
      aria-label="Visionneuse de médias"
      onClick={(e) => {
        // Close only if clicking directly on the dialog backdrop
        if (e.target === e.currentTarget) {
          onClose();
        }
        setShowControls(true);
      }}
      onMouseMove={handleContainerMouseMove}
      style={{
        // Ensure the viewer takes full screen on mobile in any orientation
        width: '100%',
        height: '100%',
        // Use viewport units that account for mobile browser chrome
        minHeight: isMobile ? '100dvh' : '100vh',
      }}
    >
      <MediaViewerHeader
        showControls={showControls}
        setIsHoveringControls={setIsHoveringControls}
        senderName={senderName}
        senderAvatar={senderAvatar}
        timestamp={timestamp}
        headerActionsProps={{
          onForward,
          onStar,
          onPin,
          onReaction,
          onShare: handleShare,
          onDownload: handleDownload,
          onClose,
          onToggleFullscreen: toggleFullscreen,
          isStarred: isStarred || false,
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
        }}
      />

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
            aria-label="Média précédent"
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
            aria-label="Média suivant"
          >
            <ChevronRight size={28} className="text-white" />
          </button>
        </>
      )}

      <section
        aria-label="Visualisation du média"
        aria-roledescription="Zone de visualisation - Cliquez ou utilisez les touches pour interagir"
        className={`flex-1 flex items-center justify-center overflow-hidden media-content-container ${
          isLandscape && isMobile ? 'p-0' : 'p-4 md:p-8'
        }`}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        // Add keyboard handler for accessibility
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onClose();
          }
        }}
        style={{
          // Always use touch-action: none to prevent browser default behaviors and ensure we handle all touch events
          touchAction: 'none',
        }}
      >
        {/* Image, GIF, Sticker - all displayed fullscreen with zoom and swipe */}
        {(mediaType === 'image' || mediaType === 'gif' || mediaType === 'sticker') && (
          <ImageViewer
            mediaUrl={mediaUrl}
            zoom={zoom}
            position={position}
            isDragging={isDragging}
            swipeOffset={swipeOffset}
            isSwipeActive={isSwipeActive}
            handleMouseDown={handleMouseDown}
            handleMouseMove={handleMouseMove}
            handleMouseUp={handleMouseUp}
            handleTouchStart={handleTouchStart}
            handleTouchMove={handleTouchMove}
            handleTouchEnd={handleTouchEnd}
            handleResetZoom={handleResetZoom}
            imageContainerRef={imageContainerRef}
            allMedia={allMedia}
            isMobile={isMobile}
            showControls={showControls}
          />
        )}

        {/* Video */}
        {mediaType === 'video' && (
          <VideoPlayer
            mediaUrl={mediaUrl}
            isMuted={isMuted}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            playbackRate={playbackRate}
            isFullscreen={isFullscreen}
            showControls={showControls}
            videoRef={videoRef}
            videoContainerRef={videoContainerRef}
            progressBarRef={progressBarRef}
            togglePlayPause={togglePlayPause}
            toggleMute={toggleMute}
            toggleFullscreen={toggleFullscreen}
            handleTimeUpdate={handleTimeUpdate}
            handleLoadedMetadata={handleLoadedMetadata}
            handleProgressBarClick={handleProgressBarClick}
            handleProgressBarTouchStart={handleProgressBarTouchStart}
            handleProgressBarTouchMove={handleProgressBarTouchMove}
            handleProgressBarTouchEnd={handleProgressBarTouchEnd}
            cyclePlaybackRate={cyclePlaybackRate}
            setIsHoveringControls={setIsHoveringControls}
            isLandscape={isLandscape}
            isMobile={isMobile}
            setIsPlaying={setIsPlaying}
            setCurrentTime={setCurrentTime}
            lastClickTimeRef={lastClickTimeRef}
          />
        )}

        {/* Audio */}
        {mediaType === 'audio' && (
          <AudioPlayer
            mediaUrl={mediaUrl}
            isMuted={isMuted}
            isPlaying={isPlaying}
            audioRef={audioRef}
            togglePlayPause={togglePlayPause}
            setIsPlaying={setIsPlaying}
          />
        )}
      </section>

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
    </dialog>
  );
};