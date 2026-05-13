// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MediaViewer } from './MediaViewer';
import {
  ImageRenderer,
  VideoRenderer,
  FileMessage,
  getMimeTypeFromExtension,
  formatVideoDuration
} from './MediaMessageComponents';
import { useDecryptedMedia } from '@/hooks/useDecryptedMedia';
import { PDFPreview } from './DocumentPreview/PDFPreview';
import { downloadMedia } from '@/lib/downloadMedia';
import { X, Download } from 'lucide-react';

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
    fileName?: string | null;
    isEncrypted?: boolean;
  }>;
  currentIndex?: number;
  onNavigate?: (index: number) => void;
  /** Indique si le média est chiffré E2EE (déchiffrement à la volée requis) */
  isEncrypted?: boolean;
  /** ID du user courant (requis pour le déchiffrement E2EE) */
  currentUserId?: string;
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
  isEncrypted = false,
  currentUserId,
}) => {
  // Résolution de l'URL : si chiffré, on déchiffre à la volée pour obtenir
  // un blob URL local. Sinon, useMediaUrl renvoie une URL signée du bucket privé.
  const { url: resolvedUrl, loading: urlLoading, error: urlError } = useDecryptedMedia({
    encrypted: isEncrypted,
    messageId,
    userId: currentUserId,
    src: url,
  });
  const effectiveUrl = resolvedUrl || url;

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPdfViewer, setShowPdfViewer] = useState(false);
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
  const isPWA = globalThis.matchMedia('(display-mode: standalone)').matches ||
                (globalThis.navigator as any).standalone === true;

  const handleDownload = async () => {
    // Helper centralisé : feedback utilisateur + gestion paths nus, URLs
    // expirées et médias chiffrés. effectiveUrl est déjà résolu (signed ou
    // blob URL déchiffré) donc on passe isEncrypted=false pour éviter
    // de re-déchiffrer ce qui est déjà déchiffré.
    await downloadMedia({
      mediaUrl: effectiveUrl,
      fileName,
      mediaType: type,
    });
  };

  // Helper to fetch file as blob - extracted for complexity reduction
  const fetchFileBlob = async (): Promise<{ blob: Blob; mimeType: string } | null> => {
    try {
      const response = await fetch(effectiveUrl);
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
    
    const shareFile = new globalThis.File([blob], fileName || 'document', { type: mimeType });
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
    const newWindow = globalThis.open(fileUrl, '_blank');
    
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

  // Detect if the file is a PDF
  const isPDF = (fileName?.toLowerCase().endsWith('.pdf')) ||
    effectiveUrl.toLowerCase().includes('.pdf');

  // Open file — uses effectiveUrl (signed or decrypted blob), never the raw path
  const handleOpenFile = useCallback(async () => {
    // PDFs : ouvrir dans le viewer interne intégré (plus fiable que window.open)
    if (isPDF) {
      setShowPdfViewer(true);
      return;
    }

    // Autres fichiers : Web Share sur mobile, nouvel onglet sur desktop
    if (isMobile || isPWA) {
      const fileData = await fetchFileBlob();
      if (!fileData) {
        handleDownload();
        return;
      }
      const { blob, mimeType } = fileData;
      const shareResult = await shareFileWithAPI(blob, mimeType);
      if (shareResult === true) return;
      if (shareResult === 'aborted') return;
      await openFileWithFallback(blob, mimeType);
    } else {
      // Utilise effectiveUrl (URL signée ou blob URL), PAS le path nu
      globalThis.open(effectiveUrl, '_blank', 'noopener,noreferrer');
    }
  }, [effectiveUrl, fileName, isMobile, isPWA, isPDF]);


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

  // Helper: Get current media info (from allMedia or defaults) - extracted to reduce complexity
  // Pour les médias E2EE, on force l'usage du blob URL local (effectiveUrl) car
  // les autres entrées de allMedia pointent vers des paths chiffrés qui ne peuvent
  // pas être affichés directement par le viewer.
  const getCurrentMediaInfo = () => {
    if (isEncrypted) {
      return {
        url: effectiveUrl,
        type: getViewerMediaType(),
        senderName,
        senderAvatar,
        timestamp,
        isOwn,
      };
    }
    const media = allMedia?.[viewerIndex];
    return {
      url: media?.url ?? effectiveUrl,
      type: media?.type ?? getViewerMediaType(),
      senderName: media?.senderName ?? senderName,
      senderAvatar: media?.senderAvatar ?? senderAvatar,
      timestamp: media?.timestamp ?? timestamp,
      isOwn: media?.isOwn ?? isOwn,
    };
  };

  // Helper: Render MediaViewer - extracted to reduce complexity
  // Note : on ferme le viewer plein écran AVANT de propager l'action (forward,
  // star, pin, react) pour éviter que le modal cible (ex. ForwardMessageModal)
  // se retrouve sous le top layer du <dialog showModal()> du viewer.
  const closeFullscreen = () => {
    setIsFullscreen(false);
    if (currentIndex !== undefined) {
      setViewerIndex(currentIndex);
    }
  };

  const renderMediaViewer = (mediaInfo: ReturnType<typeof getCurrentMediaInfo>) => (
    <MediaViewer
      isOpen={isFullscreen}
      mediaUrl={mediaInfo.url}
      mediaType={mediaInfo.type}
      senderName={mediaInfo.senderName}
      senderAvatar={mediaInfo.senderAvatar}
      timestamp={mediaInfo.timestamp}
      isOwn={mediaInfo.isOwn}
      isStarred={isStarred}
      fileName={fileName}
      messageId={messageId}
      currentUserId={currentUserId}
      isEncrypted={isEncrypted}
      onClose={closeFullscreen}
      onForward={onForward ? () => { closeFullscreen(); onForward(); } : undefined}
      onStar={onStar}
      onPin={onPin}
      onReaction={onReaction}
      allMedia={allMedia}
      currentIndex={viewerIndex}
      onNavigate={handleNavigate}
    />
  );

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

  // Erreur de déchiffrement : on rend quand même le composant de fichier
  // (il affichera son état normal et l'action télécharger sera disponible)
  // Rien de visible lié au chiffrement — on ne divulgue pas cette info.

  // Pendant le chargement/déchiffrement : spinner discret intégré dans la
  // bulle — pas de message texte visible.
  if (urlLoading) {
    return (
      <div
        className="block w-[260px] sm:w-[330px] max-w-full rounded-xl border-[3px] border-[#787add] bg-bg-hover flex items-center justify-center"
        style={{ aspectRatio: type === 'image' || type === 'video' ? '4/3' : undefined, minHeight: type === 'file' ? '72px' : undefined }}
      >
        <div className="w-8 h-8 border-2 border-[#787add]/40 border-t-[#787add] rounded-full animate-spin" />
      </div>
    );
  }

  // Use extracted ImageRenderer component - reduces cognitive complexity
  if (type === 'image') {
    const mediaInfo = getCurrentMediaInfo();
    return (
      <>
        <ImageRenderer
          url={effectiveUrl}
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
          onImageLoad={(e: any) => {
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
        {renderMediaViewer(mediaInfo)}
      </>
    );
  }

  // Use extracted VideoRenderer component - reduces cognitive complexity
  if (type === 'video') {
    const mediaInfo = getCurrentMediaInfo();
    return (
      <>
        <VideoRenderer
          url={effectiveUrl}
          caption={caption}
          videoDuration={videoDuration}
          timestamp={timestamp}
          status={status}
          isOwn={isOwn}
          isStarred={isStarred}
          showHoverActions={showHoverActions}
          onOpenMenu={onOpenMenu}
          onVideoClick={() => setIsFullscreen(true)}
        />

        {/* MediaViewer for fullscreen video */}
        {renderMediaViewer(mediaInfo)}
      </>
    );
  }

  return (
    <>
      <FileMessage
        fileName={fileName}
        fileSize={fileSize}
        timestamp={timestamp}
        status={status}
        isOwn={isOwn}
        isStarred={isStarred}
        thumbnail={thumbnail}
        caption={caption}
        handleOpenFile={handleOpenFile}
        handleDownload={handleDownload}
        onOpenMenu={onOpenMenu}
        showHoverActions={showHoverActions}
      />

      {/* Viewer PDF interne — s'ouvre quand on clique "Ouvrir" sur un PDF */}
      {showPdfViewer && isPDF && effectiveUrl && (
        <div
          className="fixed inset-0 bg-black/90 z-[100] flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="Visionneur PDF"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#1f2c34] flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-md bg-red-500 flex items-center justify-center flex-shrink-0">
                <span className="text-white text-[9px] font-bold">PDF</span>
              </div>
              <div className="min-w-0">
                <p className="text-white text-sm font-medium truncate">{fileName || 'Document.pdf'}</p>
                {fileSize && (
                  <p className="text-white/50 text-xs">{(fileSize / 1024).toFixed(0)} ko • PDF</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleDownload}
                className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/70 hover:text-white"
                aria-label="Télécharger"
              >
                <Download size={20} />
              </button>
              <button
                onClick={() => setShowPdfViewer(false)}
                className="p-2 rounded-full hover:bg-white/10 transition-colors text-white"
                aria-label="Fermer"
              >
                <X size={22} />
              </button>
            </div>
          </div>

          {/* PDF Content */}
          <div className="flex-1 overflow-hidden">
            <PDFPreview
              file={effectiveUrl}
              showAllPages={false}
              maxHeight={globalThis.innerHeight - 80}
              className="h-full"
            />
          </div>
        </div>
      )}
    </>
  );
};
