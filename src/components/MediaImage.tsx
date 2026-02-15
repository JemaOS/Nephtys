// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useState } from 'react'

// Optimized image component with placeholder to prevent layout shift (flickering)
// Uses fixed dimensions and shows a placeholder until image loads

interface MediaImageProps {
  src: string
  alt: string
  className?: string
  width?: number
  height?: number
  maxWidth?: number
  maxHeight?: number
  objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down'
}

export const MediaImage: React.FC<MediaImageProps> = ({
  src,
  alt,
  className = '',
  width,
  height,
  maxWidth,
  maxHeight,
  objectFit = 'cover'
}) => {
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)

  // Generate placeholder style with fixed dimensions
  const placeholderStyle: React.CSSProperties = {
    width: width || '100%',
    height: height || 'auto',
    maxWidth: maxWidth,
    maxHeight: maxHeight,
    minHeight: height || '150px', // Minimum height to prevent layout shift
    aspectRatio: width && height ? `${width}/${height}` : undefined,
    backgroundColor: 'rgba(120, 122, 221, 0.1)', // Light accent color
  }

  return (
    <div 
      className={`relative overflow-hidden ${className}`}
      style={placeholderStyle}
    >
      {/* Placeholder - shown until image loads */}
      {!isLoaded && !hasError && (
        <div 
          className="absolute inset-0 flex items-center justify-center bg-bg-hover animate-pulse"
        >
          <div className="w-8 h-8 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
        </div>
      )}
      
      {/* Error state - show icon instead of broken image */}
      {hasError && (
        <div 
          className="absolute inset-0 flex items-center justify-center bg-bg-hover"
        >
          <svg 
            className="w-8 h-8 text-text-tertiary" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" 
            />
          </svg>
        </div>
      )}
      
      {/* Actual image - only shown when loaded */}
      <img
        src={src}
        alt={alt}
        className={`w-full h-full transition-opacity duration-300 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ objectFit }}
        onLoad={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
        loading="lazy"
      />
    </div>
  )
}

// Avatar component with placeholder to prevent layout shift
interface AvatarProps {
  src?: string | null
  alt: string
  size?: number
  className?: string
}

export const Avatar: React.FC<AvatarProps> = ({ 
  src, 
  alt, 
  size = 40,
  className = ''
}) => {
  const [isLoaded, setIsLoaded] = useState(false)
  
  const placeholderStyle: React.CSSProperties = {
    width: size,
    height: size,
    minWidth: size, // Prevent layout shift
    minHeight: size,
  }

  const getInitials = (name: string): string => {
    return name.charAt(0).toUpperCase()
  }

  return (
    <div 
      className={`relative rounded-full overflow-hidden flex-shrink-0 ${className}`}
      style={placeholderStyle}
    >
      {/* Placeholder with initials - always visible until image loads */}
      {!src || !isLoaded ? (
        <div 
          className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary-400 to-primary-600 text-white font-semibold"
          style={{ fontSize: size * 0.4 }}
        >
          {getInitials(alt)}
        </div>
      ) : null}
      
      {/* Actual avatar image */}
      {src && (
        <img
          src={src}
          alt={alt}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => setIsLoaded(true)}
          loading="lazy"
        />
      )}
    </div>
  )
}

export default MediaImage
