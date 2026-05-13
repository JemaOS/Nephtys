// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Document, Page } from 'react-pdf';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2 } from 'lucide-react';
import { configurePDFWorker } from './pdfWorkerConfig';

configurePDFWorker();

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
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);

  // Pré-télécharger le PDF en ArrayBuffer côté React, puis passer le buffer
  // à react-pdf via `{ data }`. Ça évite que pdf.js fasse son propre fetch
  // depuis le worker (ce qui était bloqué par la CSP `connect-src` quand
  // le `file` était une `blob:` URL ou une signed URL Supabase).
  // Pour les `File` objects, on utilise directement le file (déjà local).
  useEffect(() => {
    if (typeof file !== 'string') {
      setPdfData(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const response = await fetch(file, { credentials: 'omit' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        if (cancelled) return;
        setPdfData(new Uint8Array(buffer));
      } catch (err) {
        if (cancelled) return;
        console.error('PDF prefetch error:', err);
        const message = err instanceof Error ? err.message : 'Erreur réseau';
        setError(`Impossible de charger le PDF (${message})`);
        setLoading(false);
        onLoadError?.(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file, onLoadError]);

  // Source pour react-pdf : Uint8Array si on a pré-fetché (mode string),
  // ou le File directement (mode File). On stabilise via useMemo pour
  // éviter qu'un nouveau objet `{ data }` recrée la doc à chaque render.
  const fileSource = useMemo(() => {
    if (typeof file !== 'string') return file;
    if (!pdfData) return null;
    return { data: pdfData };
  }, [file, pdfData]);

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

        {/* PDF Document — on attend que le prefetch soit terminé pour
            avoir un Uint8Array stable. Si fileSource est null, c'est que
            le prefetch est en cours, on ne rend rien (le loader ci-dessus
            s'affiche déjà). */}
        {fileSource && (
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
        )}
      </div>
    </div>
  );
};