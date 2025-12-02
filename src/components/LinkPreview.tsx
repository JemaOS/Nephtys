import React, { useState } from 'react';
import { X, ExternalLink, Play } from 'lucide-react';
import { LinkPreviewData } from '@/lib/linkPreview';
import { YouTubePlayer, isYouTubeUrl, extractYouTubeVideoId } from './YouTubePlayer';

interface LinkPreviewProps {
  preview: LinkPreviewData;
  onDismiss?: () => void;
  isInMessage?: boolean;
  isOwn?: boolean;
}

/**
 * LinkPreview Component
 * Displays a rich preview card for URLs with Open Graph metadata
 * Used both in the input area (while typing) and in sent messages
 * For YouTube links, opens an in-app video player with PiP support
 */
export const LinkPreview: React.FC<LinkPreviewProps> = ({
  preview,
  onDismiss,
  isInMessage = false,
  isOwn = false,
}) => {
  const { url, title, description, image, siteName, domain } = preview;
  const [showYouTubePlayer, setShowYouTubePlayer] = useState(false);

  // Check if this is a YouTube link
  const isYouTube = isYouTubeUrl(url);
  const youtubeVideoId = isYouTube ? extractYouTubeVideoId(url) : null;

  // Truncate description to 2 lines (approximately 100 characters)
  const truncatedDescription = description
    ? description.length > 100
      ? description.substring(0, 100) + '...'
      : description
    : null;

  const handleClick = () => {
    // For YouTube links, open in-app player
    if (isYouTube && youtubeVideoId) {
      setShowYouTubePlayer(true);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // Input preview style (above the input field)
  if (!isInMessage) {
    return (
      <div className="relative mx-2 mb-2 rounded-xl overflow-hidden bg-bg-hover border border-bg-hover shadow-lg">
        {/* Dismiss button */}
        {onDismiss && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors"
            aria-label="Dismiss preview"
          >
            <X size={14} className="text-white" />
          </button>
        )}

        <div
          className="flex cursor-pointer hover:bg-bg-surface/50 transition-colors"
          onClick={handleClick}
        >
          {/* Thumbnail */}
          {image && (
            <div className="w-20 h-20 flex-shrink-0 bg-bg-surface">
              <img
                src={image}
                alt={title || 'Link preview'}
                className="w-full h-full object-cover"
                onError={(e) => {
                  // Hide image on error
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          )}

          {/* Content */}
          <div className="flex-1 p-3 min-w-0">
            {/* Site name / Domain */}
            <p className="text-xs text-text-tertiary uppercase tracking-wide mb-1">
              {siteName || domain}
            </p>

            {/* Title */}
            {title && (
              <h4 className="text-sm font-semibold text-text-primary line-clamp-1 mb-1">
                {title}
              </h4>
            )}

            {/* Description */}
            {truncatedDescription && (
              <p className="text-xs text-text-secondary line-clamp-2">
                {truncatedDescription}
              </p>
            )}
          </div>
        </div>

        {/* Green accent bar on the left */}
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-accent" />
      </div>
    );
  }

  // Truncate URL for display (keep domain + short path)
  const truncateUrl = (fullUrl: string, maxLength: number = 50): string => {
    if (fullUrl.length <= maxLength) return fullUrl;
    try {
      const urlObj = new URL(fullUrl);
      const base = urlObj.hostname + urlObj.pathname;
      if (base.length <= maxLength) return base;
      return base.substring(0, maxLength - 3) + '...';
    } catch {
      return fullUrl.substring(0, maxLength - 3) + '...';
    }
  };

  // In-message preview style - WhatsApp-like compact design
  return (
    <>
      <div className="mt-1.5 max-w-[240px] sm:max-w-[280px]">
        {/* Preview Card */}
        <div
          className={`rounded-lg overflow-hidden cursor-pointer relative ${
            isOwn
              ? 'bg-[#5a5ab8]'
              : 'bg-bg-hover'
          }`}
          onClick={handleClick}
        >
          {/* YouTube Play Overlay - smaller and more subtle */}
          {isYouTube && image && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="w-10 h-10 rounded-full bg-red-600/90 flex items-center justify-center shadow-lg">
                <Play size={18} className="text-white ml-0.5" fill="white" />
              </div>
            </div>
          )}
          
          {/* For YouTube, show compact thumbnail with play button overlay */}
          {isYouTube && image ? (
            <div className="relative">
              <img
                src={image}
                alt={title || 'YouTube video'}
                className="w-full h-auto max-h-[140px] object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              {/* Duration/PiP badge - more subtle */}
              <div className="absolute bottom-1 right-1 px-1 py-0.5 rounded text-[8px] bg-black/80 text-white/90">
                PiP
              </div>
              {/* Title and domain below image - compact */}
              <div className={`px-2 py-1.5 ${isOwn ? 'bg-[#5a5ab8]' : 'bg-bg-hover'}`}>
                {title && (
                  <h4 className={`text-[12px] font-medium line-clamp-1 ${
                    isOwn ? 'text-white' : 'text-text-primary'
                  }`}>
                    {title}
                  </h4>
                )}
                <p className={`text-[10px] mt-0.5 ${
                  isOwn ? 'text-[#8eb8b3]' : 'text-text-tertiary'
                }`}>
                  youtube.com
                </p>
              </div>
            </div>
          ) : (
            /* Regular link preview layout - compact */
            <div className="flex">
              {/* Thumbnail - Square on the left */}
              {image && (
                <div className="w-[50px] h-[50px] flex-shrink-0">
                  <img
                    src={image}
                    alt={title || 'Link preview'}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              )}

              {/* Content */}
              <div className="flex-1 px-2 py-1.5 min-w-0 flex flex-col justify-center">
                {/* Title - Bold at top */}
                {title && (
                  <h4 className={`text-[11px] font-medium line-clamp-1 ${
                    isOwn ? 'text-white' : 'text-text-primary'
                  }`}>
                    {title}
                  </h4>
                )}

                {/* Description - shorter */}
                {truncatedDescription && (
                  <p className={`text-[10px] line-clamp-1 mt-0.5 ${
                    isOwn ? 'text-[#d1e7e4]' : 'text-text-secondary'
                  }`}>
                    {truncatedDescription}
                  </p>
                )}

                {/* Domain at bottom */}
                <p className={`text-[9px] mt-0.5 ${
                  isOwn ? 'text-[#8eb8b3]' : 'text-text-tertiary'
                }`}>
                  {domain}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Truncated clickable URL below the card */}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-block text-[11px] mt-1 underline truncate max-w-full ${
            isOwn ? 'text-[#53bdeb]' : 'text-accent'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            // For YouTube, also open in-app player
            if (isYouTube && youtubeVideoId) {
              e.preventDefault();
              setShowYouTubePlayer(true);
            }
          }}
        >
          {truncateUrl(url, 35)}
        </a>
      </div>

      {/* YouTube Player Modal */}
      {showYouTubePlayer && youtubeVideoId && (
        <YouTubePlayer
          videoId={youtubeVideoId}
          title={title || undefined}
          onClose={() => setShowYouTubePlayer(false)}
        />
      )}
    </>
  );
};

/**
 * LinkPreviewSkeleton Component
 * Shows a loading skeleton while fetching link preview data
 */
export const LinkPreviewSkeleton: React.FC<{ isInMessage?: boolean }> = ({
  isInMessage = false,
}) => {
  if (!isInMessage) {
    return (
      <div className="relative mx-2 mb-2 rounded-xl overflow-hidden bg-bg-hover border border-bg-hover shadow-lg animate-pulse">
        <div className="flex">
          {/* Thumbnail skeleton */}
          <div className="w-20 h-20 flex-shrink-0 bg-bg-surface" />

          {/* Content skeleton */}
          <div className="flex-1 p-3">
            <div className="h-3 w-16 bg-bg-surface rounded mb-2" />
            <div className="h-4 w-3/4 bg-bg-surface rounded mb-2" />
            <div className="h-3 w-full bg-bg-surface rounded" />
          </div>
        </div>

        {/* Green accent bar */}
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-accent" />
      </div>
    );
  }

  return (
    <div className="mt-1 mb-2 rounded-lg overflow-hidden bg-bg-hover animate-pulse">
      <div className="flex">
        <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 bg-bg-surface" />
        <div className="flex-1 p-2">
          <div className="h-2 w-12 bg-bg-surface rounded mb-1" />
          <div className="h-3 w-3/4 bg-bg-surface rounded mb-1" />
          <div className="h-2 w-full bg-bg-surface rounded" />
        </div>
      </div>
    </div>
  );
};

export default LinkPreview;