// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Image utility functions for compression, dimension extraction, and optimization
 */

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ProcessedImage {
  blob: Blob;
  dimensions: ImageDimensions;
  thumbnailDataUrl?: string;
}

/**
 * Maximum dimensions for uploaded images
 */
const MAX_IMAGE_WIDTH = 1920;
const MAX_IMAGE_HEIGHT = 1920;
const COMPRESSION_QUALITY = 0.85;
const THUMBNAIL_SIZE = 40;
const THUMBNAIL_QUALITY = 0.3;

/**
 * Get image dimensions from a File or Blob
 */
export function getImageDimensions(file: File | Blob): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    
    img.src = url;
  });
}

/**
 * Create a low-quality blur placeholder (LQIP) for an image
 */
export function createBlurPlaceholder(
  file: File | Blob,
  size: number = THUMBNAIL_SIZE
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      // Calculate dimensions maintaining aspect ratio
      const aspectRatio = img.naturalWidth / img.naturalHeight;
      let width = size;
      let height = size;
      
      if (aspectRatio > 1) {
        height = size / aspectRatio;
      } else {
        width = size * aspectRatio;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      // Draw scaled down image
      ctx.drawImage(img, 0, 0, width, height);
      
      // Convert to data URL with low quality
      const dataUrl = canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY);
      resolve(dataUrl);
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for thumbnail'));
    };
    
    img.src = url;
  });
}

/**
 * Compress and resize an image while maintaining aspect ratio
 */
export function compressImage(
  file: File | Blob,
  maxWidth: number = MAX_IMAGE_WIDTH,
  maxHeight: number = MAX_IMAGE_HEIGHT,
  quality: number = COMPRESSION_QUALITY
): Promise<ProcessedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = async () => {
      URL.revokeObjectURL(url);
      
      let { naturalWidth: width, naturalHeight: height } = img;
      
      // Calculate new dimensions if image is too large
      if (width > maxWidth || height > maxHeight) {
        const aspectRatio = width / height;
        
        if (width > height) {
          width = maxWidth;
          height = Math.round(maxWidth / aspectRatio);
        } else {
          height = maxHeight;
          width = Math.round(maxHeight * aspectRatio);
        }
      }
      
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      // Use better image smoothing for downscaling
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      // Draw the image
      ctx.drawImage(img, 0, 0, width, height);
      
      // Convert to blob
      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            reject(new Error('Failed to compress image'));
            return;
          }
          
          // Create blur placeholder
          let thumbnailDataUrl: string | undefined;
          try {
            thumbnailDataUrl = await createBlurPlaceholder(blob);
          } catch (e) {
            console.warn('Failed to create blur placeholder:', e);
          }
          
          resolve({
            blob,
            dimensions: { width, height },
            thumbnailDataUrl,
          });
        },
        'image/jpeg',
        quality
      );
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for compression'));
    };
    
    img.src = url;
  });
}

/**
 * Process an image file: compress if needed and extract dimensions
 * Returns the original file if it's small enough, or a compressed version
 */
export async function processImageForUpload(
  file: File,
  options?: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    maxSizeBytes?: number;
  }
): Promise<ProcessedImage> {
  const {
    maxWidth = MAX_IMAGE_WIDTH,
    maxHeight = MAX_IMAGE_HEIGHT,
    quality = COMPRESSION_QUALITY,
    maxSizeBytes = 2 * 1024 * 1024, // 2MB default
  } = options || {};
  
  // Get original dimensions
  const originalDimensions = await getImageDimensions(file);
  
  // Check if compression is needed
  const needsResize = originalDimensions.width > maxWidth || originalDimensions.height > maxHeight;
  const needsCompression = file.size > maxSizeBytes;
  
  // If image is already small enough and doesn't need resizing, just get dimensions
  if (!needsResize && !needsCompression && file.type === 'image/jpeg') {
    let thumbnailDataUrl: string | undefined;
    try {
      thumbnailDataUrl = await createBlurPlaceholder(file);
    } catch (e) {
      console.warn('Failed to create blur placeholder:', e);
    }
    
    return {
      blob: file,
      dimensions: originalDimensions,
      thumbnailDataUrl,
    };
  }
  
  // Compress the image
  return compressImage(file, maxWidth, maxHeight, quality);
}

/**
 * Calculate container dimensions for displaying an image
 * while respecting max constraints and maintaining aspect ratio
 */
export function calculateDisplayDimensions(
  imageDimensions: ImageDimensions,
  maxWidth: number = 280,
  maxHeight: number = 400,
  minWidth: number = 150
): { width: number; height: number } {
  const { width, height } = imageDimensions;
  const aspectRatio = width / height;
  
  let containerWidth: number;
  let containerHeight: number;
  
  if (aspectRatio > 1) {
    // Landscape image
    containerWidth = Math.min(maxWidth, width);
    containerHeight = containerWidth / aspectRatio;
  } else if (aspectRatio < 1) {
    // Portrait image
    containerHeight = Math.min(maxHeight, height);
    containerWidth = containerHeight * aspectRatio;
    
    // Ensure minimum width
    if (containerWidth < minWidth) {
      containerWidth = minWidth;
      containerHeight = containerWidth / aspectRatio;
    }
  } else {
    // Square image
    containerWidth = Math.min(maxWidth, width);
    containerHeight = containerWidth;
  }
  
  return {
    width: Math.round(containerWidth),
    height: Math.round(containerHeight),
  };
}

/**
 * Parse image metadata from a message's metadata field
 */
export function parseImageMetadata(metadataString: string | null): {
  width?: number;
  height?: number;
  thumbnail?: string;
} | null {
  if (!metadataString) return null;
  
  try {
    const metadata = JSON.parse(metadataString);
    return {
      width: metadata.width,
      height: metadata.height,
      thumbnail: metadata.thumbnail,
    };
  } catch {
    return null;
  }
}

/**
 * Create image metadata string for storage
 */
export function createImageMetadata(
  dimensions: ImageDimensions,
  thumbnailDataUrl?: string
): string {
  return JSON.stringify({
    width: dimensions.width,
    height: dimensions.height,
    thumbnail: thumbnailDataUrl,
  });
}