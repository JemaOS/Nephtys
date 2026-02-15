// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useEffect, useCallback } from 'react';
import { X, Send, Plus, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, Loader2, FileText, FileSpreadsheet, Presentation, File, FileArchive } from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Helper functions to reduce component complexity

// Format file size helper
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' ko';
  return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
};

// Touch distance helper
const getTouchDistance = (touches: React.TouchList): number => {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
};

// Get file type info based on extension
const getFileTypeInfo = (fileName: string): { type: 'pdf' | 'word' | 'excel' | 'powerpoint' | 'text' | 'archive' | 'other'; label: string; color: string; icon: React.ReactNode } => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  
  if (ext === 'pdf') {
    return { type: 'pdf', label: 'PDF', color: 'bg-red-500', icon: <FileText size={32} className="text-white" /> };
  }
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) {
    return { type: 'word', label: 'Word', color: 'bg-blue-600', icon: <FileText size={32} className="text-white" /> };
  }
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) {
    return { type: 'excel', label: 'Excel', color: 'bg-green-600', icon: <FileSpreadsheet size={32} className="text-white" /> };
  }
  if (['ppt', 'pptx', 'odp'].includes(ext)) {
    return { type: 'powerpoint', label: 'PowerPoint', color: 'bg-orange-500', icon: <Presentation size={32} className="text-white" /> };
  }
  if (['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts'].includes(ext)) {
    return { type: 'text', label: ext.toUpperCase(), color: 'bg-gray-500', icon: <FileText size={32} className="text-white" /> };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return { type: 'archive', label: ext.toUpperCase(), color: 'bg-yellow-600', icon: <FileArchive size={32} className="text-white" /> };
  }
  return { type: 'other', label: ext.toUpperCase() || 'FILE', color: 'bg-gray-500', icon: <File size={32} className="text-white" /> };
};

// Get preview message based on file type
const getPreviewMessage = (fileType: string): string => {
  switch (fileType) {
    case 'word':
      return "Les fichiers Word ne peuvent pas être prévisualisés. Envoyez-le pour l'ouvrir avec une application compatible.";
    case 'excel':
      return "Les fichiers Excel ne peuvent pas être prévisualisés. Envoyez-le pour l'ouvrir avec une application compatible.";
    case 'powerpoint':
      return "Les fichiers PowerPoint ne peuvent pas être prévisualisés. Envoyez-le pour l'ouvrir avec une application compatible.";
    case 'archive':
      return "Les archives ne peuvent pas être prévisualisées. Envoyez-la pour l'extraire avec une application compatible.";
    default:
      return "Ce fichier ne peut pas être prévisualisé. Envoyez-le pour l'ouvrir avec une application compatible.";
  }
};

// Load file and get URL
const loadFileUrl = async (file: File, isText: boolean): Promise<{ url: string; textContent: string | null; error: string | null }> => {
  const url = URL.createObjectURL(file);
  
  if (isText) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        resolve({ url, textContent: e.target?.result as string, error: null });
      };
      reader.onerror = () => {
        resolve({ url, textContent: null, error: 'Impossible de lire le fichier' });
      };
      reader.readAsText(file);
    });
  }
  
  return { url, textContent: null, error: null };
};


interface DocumentPreviewModalProps {
  file: File;
  onClose: () => void;
  onSend: (caption: string) => void;
  uploading?: boolean;
  uploadProgress?: number;
  uploadPhase?: 'idle' | 'compressing' | 'uploading';
}


export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  file,
  onClose,
  onSend,
  uploading = false,
  uploadProgress = 0,
  uploadPhase = 'uploading',
}) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState<string>('');
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [pinchStartDistance, setPinchStartDistance] = useState<number | null>(null);
  const [pinchStartScale, setPinchStartScale] = useState<number>(1);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const pdfWrapperRef = React.useRef<HTMLDivElement>(null);
  
  const fileTypeInfo = getFileTypeInfo(file.name);
  const isPDF = fileTypeInfo.type === 'pdf';
  const isText = fileTypeInfo.type === 'text';
  const canPreview = isPDF || isText;

  // Initialize file - extracted to reduce component complexity
  const initializeFile = useCallback(async (file: File, isTextFile: boolean, isPDFFile: boolean) => {
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    
    if (isTextFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setTextContent(e.target?.result as string);
        setLoading(false);
      };
      reader.onerror = () => {
        setError('Impossible de lire le fichier');
        setLoading(false);
      };
      reader.readAsText(file);
    } else if (!isPDFFile) {
      setLoading(false);
    }
    
    return () => URL.revokeObjectURL(url);
  }, []);

  // Create object URL for the file and load text content if applicable
  useEffect(() => {
    const cleanup = initializeFile(file, isText, isPDF);
    return cleanup;
  }, [file, isText, isPDF, initializeFile]);

  // Track container width for responsive PDF sizing and detect mobile
  useEffect(() => {
    const updateDimensions = () => {
      const windowWidth = window.innerWidth;
      const mobile = windowWidth < 768;
      setIsMobile(mobile);
      
      if (containerRef.current) {
        // Responsive padding: less on mobile, more on desktop
        const padding = mobile ? 16 : 64;
        const width = containerRef.current.clientWidth - padding;
        // Max width varies by screen size
        const maxWidth = mobile ? windowWidth - 16 : Math.min(800, windowWidth - 100);
        setContainerWidth(Math.min(width, maxWidth));
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  const handleLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setLoading(false);
    setError(null);
  };

  const handleLoadError = (err: Error) => {
    console.error('PDF load error:', err);
    setLoading(false);
    setError('Impossible de charger le PDF');
  };

  const goToPreviousPage = () => {
    setCurrentPage((prev) => Math.max(1, prev - 1));
  };

  const goToNextPage = () => {
    setCurrentPage((prev) => Math.min(numPages, prev + 1));
  };

  const zoomIn = () => {
    setScale((prev) => Math.min(2.5, prev + 0.25));
  };

  const zoomOut = () => {
    setScale((prev) => Math.max(0.5, prev - 0.25));
  };

  // Handle mouse wheel zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((prev) => Math.min(3, Math.max(0.25, prev + delta)));
  }, []);

  // Add wheel event listener with passive: false to allow preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

  // Handle drag to pan (hand tool)
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only start drag on left mouse button and not on interactive elements
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'BUTTON') return;
    
    const container = containerRef.current;
    if (container) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX,
        y: e.clientY,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
      });
      container.style.cursor = 'grabbing';
    }
  };

  const handleMouseMove = React.useCallback((e: MouseEvent) => {
    if (!isDragging || !dragStart || !containerRef.current) return;
    
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    
    containerRef.current.scrollLeft = dragStart.scrollLeft - dx;
    containerRef.current.scrollTop = dragStart.scrollTop - dy;
  }, [isDragging, dragStart]);

  const handleMouseUp = React.useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
    if (containerRef.current) {
      containerRef.current.style.cursor = 'grab';
    }
  }, []);

  // Add mouse move and up listeners for drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Touch handlers for pinch-to-zoom
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch start
      const distance = getTouchDistance(e.touches);
      setPinchStartDistance(distance);
      setPinchStartScale(scale);
    } else if (e.touches.length === 1 && isPDF) {
      // Single touch drag
      const container = containerRef.current;
      if (container) {
        setIsDragging(true);
        setDragStart({
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          scrollLeft: container.scrollLeft,
          scrollTop: container.scrollTop,
        });
      }
    }
  }, [scale, isPDF]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDistance !== null) {
      // Pinch zoom
      e.preventDefault();
      const distance = getTouchDistance(e.touches);
      const scaleChange = distance / pinchStartDistance;
      const newScale = Math.min(3, Math.max(0.25, pinchStartScale * scaleChange));
      setScale(newScale);
    } else if (e.touches.length === 1 && isDragging && dragStart && containerRef.current) {
      // Single touch drag
      const dx = e.touches[0].clientX - dragStart.x;
      const dy = e.touches[0].clientY - dragStart.y;
      containerRef.current.scrollLeft = dragStart.scrollLeft - dx;
      containerRef.current.scrollTop = dragStart.scrollTop - dy;
    }
  }, [pinchStartDistance, pinchStartScale, isDragging, dragStart]);

  const handleTouchEnd = useCallback(() => {
    setPinchStartDistance(null);
    setIsDragging(false);
    setDragStart(null);
  }, []);

  // Reset zoom to fit
  const resetZoom = useCallback(() => {
    setScale(1);
    if (containerRef.current) {
      containerRef.current.scrollLeft = 0;
      containerRef.current.scrollTop = 0;
    }
  }, []);

  const handleSend = () => {
    if (!uploading) {
      onSend(caption);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="fixed inset-0 bg-bg-primary z-[120] flex flex-col">
      {/* Header - Dark with file info - Responsive */}
      <div className="flex items-center justify-between px-2 sm:px-4 py-2 sm:py-3 bg-[#1f2c34] safe-area-top">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <button
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-full hover:bg-white/10 transition-colors text-white flex-shrink-0"
            disabled={uploading}
          >
            <X size={isMobile ? 20 : 24} />
          </button>
          <div className="flex flex-col min-w-0">
            <span className="text-white font-medium truncate text-sm sm:text-base">
              {file.name}
            </span>
            <span className="text-white/60 text-[10px] sm:text-xs">
              {formatFileSize(file.size)} • {fileTypeInfo.label}
            </span>
          </div>
        </div>

        {/* Page navigation and zoom controls - Only for PDF */}
        {isPDF && !loading && !error && numPages > 0 && (
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            {/* Zoom controls - Hidden on mobile (use pinch-to-zoom instead) */}
            {!isMobile && (
              <div className="flex items-center gap-2">
                <button
                  onClick={zoomOut}
                  disabled={scale <= 0.25}
                  className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Zoom arrière"
                >
                  <ZoomOut size={18} className="text-white" />
                </button>
                <span className="text-xs text-white/70 min-w-[50px] text-center">
                  {Math.round(scale * 100)}%
                </span>
                <button
                  onClick={zoomIn}
                  disabled={scale >= 3}
                  className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Zoom avant"
                >
                  <ZoomIn size={18} className="text-white" />
                </button>
                {/* Reset zoom button */}
                <button
                  onClick={resetZoom}
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-colors ml-1"
                  aria-label="Réinitialiser le zoom"
                >
                  <RotateCw size={16} className="text-white/70" />
                </button>
              </div>
            )}

            {/* Page navigation - Visible on all screens */}
            {numPages > 1 && (
              <div className="flex items-center gap-1 sm:gap-2">
                <button
                  onClick={goToPreviousPage}
                  disabled={currentPage <= 1}
                  className="p-1.5 sm:p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Page précédente"
                >
                  <ChevronLeft size={20} className="text-white" />
                </button>
                <span className="text-xs sm:text-sm text-white min-w-[50px] sm:min-w-[60px] text-center">
                  {currentPage}/{numPages}
                </span>
                <button
                  onClick={goToNextPage}
                  disabled={currentPage >= numPages}
                  className="p-1.5 sm:p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  aria-label="Page suivante"
                >
                  <ChevronRight size={20} className="text-white" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content Area - Touch enabled */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-auto bg-[#525659] flex justify-center select-none ${canPreview ? 'items-start' : 'items-center'}`}
        style={{ cursor: isPDF ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
        onMouseDown={isPDF ? handleMouseDown : undefined}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center h-full w-full">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={40} className="animate-spin text-white" />
              <span className="text-sm text-white/70">Chargement...</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex items-center justify-center h-full w-full">
            <div className="flex flex-col items-center gap-3 text-center px-4">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                <span className="text-3xl">📄</span>
              </div>
              <span className="text-sm text-white/70">{error}</span>
              <button
                onClick={onClose}
                className="mt-2 px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20 transition-colors"
              >
                Fermer
              </button>
            </div>
          </div>
        )}

        {/* PDF Document - Using CSS transform for smooth zooming - Responsive */}
        {isPDF && fileUrl && containerWidth > 0 && (
          <div
            ref={pdfWrapperRef}
            className="py-2 sm:py-4 transition-transform duration-100 ease-out origin-top touch-none"
            style={{
              transform: `scale(${scale})`,
              transformOrigin: 'top center',
            }}
          >
            <Document
              file={fileUrl}
              onLoadSuccess={handleLoadSuccess}
              onLoadError={handleLoadError}
              loading={null}
              error={null}
            >
              <Page
                pageNumber={currentPage}
                width={containerWidth}
                className="shadow-2xl rounded-sm sm:rounded-lg overflow-hidden"
                renderTextLayer={false}
                renderAnnotationLayer={false}
                loading={
                  <div
                    className="flex items-center justify-center bg-white"
                    style={{
                      width: containerWidth,
                      height: isMobile ? '70vh' : '600px'
                    }}
                  >
                    <Loader2 size={isMobile ? 24 : 32} className="animate-spin text-gray-400" />
                  </div>
                }
              />
            </Document>
          </div>
        )}

        {/* Mobile pinch hint - shown briefly */}
        {isPDF && isMobile && !loading && !error && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none opacity-0 animate-fade-in-out">
            Pincez pour zoomer
          </div>
        )}

        {/* Text file preview - Responsive */}
        {isText && textContent !== null && !loading && (
          <div className="w-full max-w-4xl mx-auto p-2 sm:p-4">
            <pre className="bg-[#1e1e1e] text-gray-200 p-3 sm:p-4 rounded-lg overflow-auto text-xs sm:text-sm font-mono whitespace-pre-wrap break-words shadow-2xl max-h-[70vh]">
              {textContent}
            </pre>
          </div>
        )}

        {/* Non-previewable file info card (Word, Excel, PowerPoint, etc.) - Responsive */}
        {!canPreview && !loading && (
          <div className="p-3 sm:p-4 w-full max-w-sm sm:max-w-md">
            <div className="bg-[#1f2c34] rounded-xl sm:rounded-2xl p-5 sm:p-8 w-full shadow-2xl">
              <div className="flex flex-col items-center text-center">
                {/* File icon - Responsive size */}
                <div className={`w-16 h-16 sm:w-24 sm:h-24 rounded-xl sm:rounded-2xl ${fileTypeInfo.color} flex items-center justify-center mb-4 sm:mb-6 shadow-lg`}>
                  {React.cloneElement(fileTypeInfo.icon as React.ReactElement, {
                    size: isMobile ? 24 : 32
                  })}
                </div>
                
                {/* File name - Responsive text */}
                <h3 className="text-white font-semibold text-base sm:text-lg mb-2 break-all line-clamp-2">
                  {file.name}
                </h3>
                
                {/* File info - Responsive */}
                <div className="text-white/60 text-xs sm:text-sm space-y-0.5 sm:space-y-1 mb-4 sm:mb-6">
                  <p>Taille: {formatFileSize(file.size)}</p>
                  <p>Type: {fileTypeInfo.label}</p>
                </div>
                
                {/* Info message - Responsive */}
                <div className="bg-white/5 rounded-lg p-3 sm:p-4 w-full">
                  <p className="text-white/70 text-xs sm:text-sm leading-relaxed">
                    {getPreviewMessage(fileTypeInfo.type)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom bar with caption input and send button - Responsive */}
      <div className="p-2 sm:p-3 md:p-4 border-t border-[#1f2c34] bg-[#1f2c34] safe-area-bottom">
        {/* Upload progress */}
        {uploading && (
          <div className="mb-2 sm:mb-3">
            <div className="flex items-center justify-between text-xs sm:text-sm mb-1 text-white">
              <span>
                {uploadPhase === 'compressing' ? 'Compression en cours...' : 'Envoi en cours...'}
              </span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="h-1 sm:h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Thumbnail preview - Responsive */}
          <div className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-lg overflow-hidden border-2 border-accent flex-shrink-0 bg-white flex items-center justify-center">
            <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded ${fileTypeInfo.color} flex items-center justify-center`}>
              <span className="text-white text-[8px] sm:text-[10px] font-bold">{fileTypeInfo.label}</span>
            </div>
          </div>

          {/* Add more button - Hidden on very small screens */}
          <button
            onClick={onClose}
            disabled={uploading}
            className="hidden xs:flex w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-lg border-2 border-dashed border-white/30 items-center justify-center text-white/50 hover:bg-white/10 transition-colors flex-shrink-0 disabled:opacity-50"
          >
            <Plus size={isMobile ? 16 : 20} />
          </button>

          {/* Caption input - Responsive */}
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isMobile ? "Légende..." : "Ajouter une légende..."}
              disabled={uploading}
              className="w-full px-3 sm:px-4 py-2 sm:py-2.5 md:py-3 rounded-full bg-[#2a3942] text-white placeholder:text-white/50 outline-none text-sm disabled:opacity-50"
            />
          </div>

          {/* Send button - Responsive */}
          <button
            onClick={handleSend}
            disabled={uploading}
            className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full bg-accent hover:bg-[#5a5ec9] flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 size={isMobile ? 18 : 20} className="text-white animate-spin" />
            ) : (
              <Send size={isMobile ? 18 : 20} className="text-white" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};