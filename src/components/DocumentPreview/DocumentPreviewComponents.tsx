import React from 'react';
import { X, Send, Plus, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, Loader2 } from 'lucide-react';
import { Document, Page } from 'react-pdf';

// Helper types
export interface FileTypeInfo {
  type: 'pdf' | 'word' | 'excel' | 'powerpoint' | 'text' | 'archive' | 'other';
  label: string;
  color: string;
  icon: React.ReactNode;
}

interface DocumentPreviewHeaderProps {
  file: File;
  onClose: () => void;
  uploading: boolean;
  isMobile: boolean;
  isPDF: boolean;
  loading: boolean;
  error: string | null;
  numPages: number;
  currentPage: number;
  scale: number;
  zoomOut: () => void;
  zoomIn: () => void;
  resetZoom: () => void;
  goToPreviousPage: () => void;
  goToNextPage: () => void;
  fileTypeInfo: FileTypeInfo;
  formatFileSize: (bytes: number) => string;
}

export const DocumentPreviewHeader: React.FC<DocumentPreviewHeaderProps> = ({
  file,
  onClose,
  uploading,
  isMobile,
  isPDF,
  loading,
  error,
  numPages,
  currentPage,
  scale,
  zoomOut,
  zoomIn,
  resetZoom,
  goToPreviousPage,
  goToNextPage,
  fileTypeInfo,
  formatFileSize,
}) => (
  <div className="flex items-center justify-between px-2 sm:px-4 py-2 sm:py-3 bg-[#1f2c34] safe-area-top">
    <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
      <button
        onClick={onClose}
        className="p-1.5 sm:p-2 rounded-full hover:bg-white/10 transition-colors text-white flex-shrink-0"
        disabled={uploading}
        aria-label="Fermer l'aperçu"
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
);

interface DocumentPreviewFooterProps {
  uploading: boolean;
  uploadPhase: 'idle' | 'compressing' | 'uploading';
  uploadProgress: number;
  fileTypeInfo: FileTypeInfo;
  onClose: () => void;
  isMobile: boolean;
  caption: string;
  setCaption: (val: string) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handleSend: () => void;
}

export const DocumentPreviewFooter: React.FC<DocumentPreviewFooterProps> = ({
  uploading,
  uploadPhase,
  uploadProgress,
  fileTypeInfo,
  onClose,
  isMobile,
  caption,
  setCaption,
  handleKeyDown,
  handleSend,
}) => (
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
        aria-label="Ajouter un autre fichier"
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
          aria-label="Légende du fichier"
        />
      </div>

      {/* Send button - Responsive */}
      <button
        onClick={handleSend}
        disabled={uploading}
        className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full bg-accent hover:bg-[#5a5ec9] flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-50"
        aria-label="Envoyer le fichier"
      >
        {uploading ? (
          <Loader2 size={isMobile ? 18 : 20} className="text-white animate-spin" />
        ) : (
          <Send size={isMobile ? 18 : 20} className="text-white" />
        )}
      </button>
    </div>
  </div>
);

interface DocumentPreviewContentProps {
  containerRef: React.RefObject<HTMLButtonElement>;
  canPreview: boolean;
  getCursorStyle: () => string;
  isPDF: boolean;
  handleMouseDown?: (e: React.MouseEvent) => void;
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchMove: (e: React.TouchEvent) => void;
  handleTouchEnd: () => void;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  fileUrl: string | null;
  containerWidth: number;
  pdfWrapperRef: React.RefObject<HTMLDivElement>;
  scale: number;
  handleLoadSuccess: (data: { numPages: number }) => void;
  handleLoadError: (err: Error) => void;
  currentPage: number;
  isMobile: boolean;
  isText: boolean;
  textContent: string | null;
  file: File;
  fileTypeInfo: FileTypeInfo;
  formatFileSize: (bytes: number) => string;
  getPreviewMessage: (type: string) => string;
}

export const DocumentPreviewContent: React.FC<DocumentPreviewContentProps> = ({
  containerRef,
  canPreview,
  getCursorStyle,
  isPDF,
  handleMouseDown,
  handleTouchStart,
  handleTouchMove,
  handleTouchEnd,
  loading,
  error,
  onClose,
  fileUrl,
  containerWidth,
  pdfWrapperRef,
  scale,
  handleLoadSuccess,
  handleLoadError,
  currentPage,
  isMobile,
  isText,
  textContent,
  file,
  fileTypeInfo,
  formatFileSize,
  getPreviewMessage,
}) => (
  <button
    ref={containerRef}
    type="button"
    className={`flex-1 overflow-auto bg-[#525659] flex justify-center select-none ${canPreview ? 'items-start' : 'items-center'}`}
    style={{ cursor: getCursorStyle() }}
    aria-label="Zone de prévisualisation du document - Appuyez sur Échap pour fermer"
    onMouseDown={isPDF ? handleMouseDown : undefined}
    onTouchStart={handleTouchStart}
    onTouchMove={handleTouchMove}
    onTouchEnd={handleTouchEnd}
    onKeyDown={(e) => {
      // Handle keyboard navigation for accessibility
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }}
  >
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
  </button>
);
