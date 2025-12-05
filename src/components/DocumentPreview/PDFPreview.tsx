// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2 } from 'lucide-react';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface PDFPreviewProps {
  file: File | string; // File object or URL
  showAllPages?: boolean; // Show all pages or single page with navigation
  initialPage?: number;
  maxHeight?: number;
  onLoadSuccess?: (numPages: number) => void;
  onLoadError?: (error: Error) => void;
  className?: string;
}

export const PDFPreview: React.FC<PDFPreviewProps> = ({
  file,
  showAllPages = false,
  initialPage = 1,
  maxHeight = 600,
  onLoadSuccess,
  onLoadError,
  className = '',
}) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [scale, setScale] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Create file source for react-pdf
  const fileSource = typeof file === 'string' ? file : file;

  const handleLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setLoading(false);
    setError(null);
    onLoadSuccess?.(numPages);
  }, [onLoadSuccess]);

  const handleLoadError = useCallback((err: Error) => {
    console.error('PDF load error:', err);
    setLoading(false);
    setError('Impossible de charger le PDF');
    onLoadError?.(err);
  }, [onLoadError]);

  const goToPreviousPage = () => {
    setCurrentPage((prev) => Math.max(1, prev - 1));
  };

  const goToNextPage = () => {
    setCurrentPage((prev) => Math.min(numPages, prev + 1));
  };

  const zoomIn = () => {
    setScale((prev) => Math.min(2, prev + 0.25));
  };

  const zoomOut = () => {
    setScale((prev) => Math.max(0.5, prev - 0.25));
  };

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Controls */}
      {!loading && !error && numPages > 0 && (
        <div className="flex items-center justify-between px-4 py-2 bg-bg-surface/80 backdrop-blur-sm border-b border-bg-hover">
          {/* Page navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={goToPreviousPage}
              disabled={currentPage <= 1 || showAllPages}
              className="p-1.5 rounded-lg hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Page précédente"
            >
              <ChevronLeft size={20} className="text-text-primary" />
            </button>
            <span className="text-sm text-text-primary min-w-[80px] text-center">
              {showAllPages ? `${numPages} pages` : `${currentPage} / ${numPages}`}
            </span>
            <button
              onClick={goToNextPage}
              disabled={currentPage >= numPages || showAllPages}
              className="p-1.5 rounded-lg hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Page suivante"
            >
              <ChevronRight size={20} className="text-text-primary" />
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={zoomOut}
              disabled={scale <= 0.5}
              className="p-1.5 rounded-lg hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Zoom arrière"
            >
              <ZoomOut size={18} className="text-text-primary" />
            </button>
            <span className="text-xs text-text-secondary min-w-[50px] text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={zoomIn}
              disabled={scale >= 2}
              className="p-1.5 rounded-lg hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Zoom avant"
            >
              <ZoomIn size={18} className="text-text-primary" />
            </button>
          </div>
        </div>
      )}

      {/* PDF Content */}
      <div
        className="flex-1 overflow-auto bg-[#525659]"
        style={{ maxHeight: `${maxHeight}px` }}
      >
        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={32} className="animate-spin text-accent" />
              <span className="text-sm text-text-secondary">Chargement du PDF...</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3 text-center px-4">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                <span className="text-2xl">📄</span>
              </div>
              <span className="text-sm text-text-secondary">{error}</span>
            </div>
          </div>
        )}

        {/* PDF Document */}
        <Document
          file={fileSource}
          onLoadSuccess={handleLoadSuccess}
          onLoadError={handleLoadError}
          loading={null}
          error={null}
          className="flex flex-col items-center py-4 gap-4"
        >
          {showAllPages ? (
            // Render all pages
            Array.from(new Array(numPages), (_, index) => (
              <Page
                key={`page_${index + 1}`}
                pageNumber={index + 1}
                scale={scale}
                className="shadow-lg"
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
            ))
          ) : (
            // Render single page
            <Page
              pageNumber={currentPage}
              scale={scale}
              className="shadow-lg"
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
          )}
        </Document>
      </div>
    </div>
  );
};