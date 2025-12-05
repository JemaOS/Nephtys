// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useEffect, useRef } from 'react';
import { pdfjs } from 'react-pdf';
import { FileText, Loader2 } from 'lucide-react';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Cache for generated thumbnails
const thumbnailCache = new Map<string, string>();

interface DocumentThumbnailProps {
  file: File | string; // File object or URL
  width?: number;
  height?: number;
  className?: string;
  onThumbnailGenerated?: (dataUrl: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Generate a thumbnail from a PDF file
 * @param file - File object or URL string
 * @param width - Target width for the thumbnail
 * @returns Promise<string> - Data URL of the thumbnail image
 */
export const generatePDFThumbnail = async (
  file: File | string,
  width: number = 200
): Promise<string> => {
  // Check cache first
  const cacheKey = typeof file === 'string' ? file : `${file.name}-${file.size}-${file.lastModified}`;
  const cached = thumbnailCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Load the PDF document
    let pdfData: ArrayBuffer | string;
    
    if (typeof file === 'string') {
      // URL - fetch the PDF
      const response = await fetch(file);
      pdfData = await response.arrayBuffer();
    } else {
      // File object - read as ArrayBuffer
      pdfData = await file.arrayBuffer();
    }

    // Load the PDF document using pdf.js
    const loadingTask = pdfjs.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;

    // Get the first page
    const page = await pdf.getPage(1);

    // Calculate scale to achieve desired width
    const viewport = page.getViewport({ scale: 1 });
    const scale = width / viewport.width;
    const scaledViewport = page.getViewport({ scale });

    // Create canvas for rendering
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    if (!context) {
      throw new Error('Could not get canvas context');
    }

    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;

    // Render the page to canvas
    await page.render({
      canvasContext: context,
      viewport: scaledViewport,
      canvas: canvas,
    }).promise;

    // Convert to data URL
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

    // Cache the result
    thumbnailCache.set(cacheKey, dataUrl);

    // Clean up
    pdf.destroy();

    return dataUrl;
  } catch (error) {
    console.error('Error generating PDF thumbnail:', error);
    throw error;
  }
};

/**
 * Upload a thumbnail to storage and return the URL
 * This is a helper function to be used when sending documents
 */
export const uploadThumbnail = async (
  dataUrl: string,
  supabase: any,
  userId: string,
  fileName: string
): Promise<string> => {
  // Convert data URL to blob
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  // Generate unique filename for thumbnail
  const thumbnailFileName = `${userId}/thumbnails/${Date.now()}_${fileName.replace(/\.[^/.]+$/, '')}_thumb.jpg`;

  // Upload to storage
  const { data, error } = await supabase.storage
    .from('media')
    .upload(thumbnailFileName, blob, {
      cacheControl: '3600',
      upsert: false,
      contentType: 'image/jpeg',
    });

  if (error) {
    throw error;
  }

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('media')
    .getPublicUrl(thumbnailFileName);

  return publicUrl;
};

export const DocumentThumbnail: React.FC<DocumentThumbnailProps> = ({
  file,
  width = 200,
  height,
  className = '',
  onThumbnailGenerated,
  onError,
}) => {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    
    const generateThumbnail = async () => {
      setLoading(true);
      setError(false);

      try {
        const dataUrl = await generatePDFThumbnail(file, width);
        
        if (mountedRef.current) {
          setThumbnailUrl(dataUrl);
          setLoading(false);
          onThumbnailGenerated?.(dataUrl);
        }
      } catch (err) {
        console.error('Thumbnail generation failed:', err);
        if (mountedRef.current) {
          setError(true);
          setLoading(false);
          onError?.(err as Error);
        }
      }
    };

    generateThumbnail();

    return () => {
      mountedRef.current = false;
    };
  }, [file, width, onThumbnailGenerated, onError]);

  // Calculate height based on aspect ratio if not provided
  const containerStyle: React.CSSProperties = {
    width: `${width}px`,
    height: height ? `${height}px` : 'auto',
    minHeight: height ? undefined : `${Math.round(width * 1.4)}px`, // Default A4 aspect ratio
  };

  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-bg-surface ${className}`}
      style={containerStyle}
    >
      {/* Loading state */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-surface">
          <Loader2 size={24} className="animate-spin text-accent" />
        </div>
      )}

      {/* Error state - show fallback icon */}
      {error && !loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg-surface">
          <div className="w-12 h-12 rounded-lg bg-red-500 flex items-center justify-center mb-2">
            <FileText size={24} className="text-white" />
          </div>
          <span className="text-xs text-text-secondary">PDF</span>
        </div>
      )}

      {/* Thumbnail image */}
      {thumbnailUrl && !loading && !error && (
        <img
          src={thumbnailUrl}
          alt="PDF thumbnail"
          className="w-full h-full object-cover"
          style={{ objectPosition: 'top' }}
        />
      )}
    </div>
  );
};