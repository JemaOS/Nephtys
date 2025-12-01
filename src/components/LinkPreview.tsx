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

  // In-message preview style - WhatsApp-like design
  return (
    <>
      <div className="mt-2 mb-1">
        {/* Preview Card */}
        <div
          className={`rounded-xl overflow-hidden cursor-pointer transition-colors relative ${
            isOwn
              ? 'bg-[#025144]'
              : 'bg-bg-hover'
          }`}
          onClick={handleClick}
        >
          {/* YouTube Play Overlay */}
          {isYouTube && image && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="w-14 h-14 rounded-full bg-black/60 flex items-center justify-center">
                <Play size={28} className="text-white ml-1" fill="white" />
              </div>
            </div>
          )}
          
          {/* For YouTube, show larger thumbnail with play button overlay */}
          {isYouTube && image ? (
            <div className="relative">
              <img
                src={image}
                alt={title || 'YouTube video'}
                className="w-full aspect-video object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              {/* PiP indicator */}
              <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/70 text-white text-[10px] flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                  <rect x="12" y="10" width="8" height="6" rx="1" ry="1"/>
                </svg>
                <span>PiP disponible</span>
              </div>
              {/* Title and domain below image */}
              <div className={`p-2.5 ${isOwn ? 'bg-[#025144]' : 'bg-bg-hover'}`}>
                {title && (
                  <h4 className={`text-sm font-semibold line-clamp-1 mb-0.5 ${
                    isOwn ? 'text-white' : 'text-text-primary'
                  }`}>
                    {title}
                  </h4>
                )}
                <div className={`flex items-center gap-1.5 text-[11px] ${
                  isOwn ? 'text-[#8eb8b3]' : 'text-text-tertiary'
                }`}>
                  <ExternalLink size={12} />
                  <span>{domain}</span>
                </div>
              </div>
            </div>
          ) : (
            /* Regular link preview layout */
            <div className="flex">
              {/* Thumbnail - Square on the left */}
              {image && (
                <div className="w-[72px] h-[72px] sm:w-[80px] sm:h-[80px] flex-shrink-0">
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
              <div className="flex-1 p-2.5 min-w-0 flex flex-col justify-center">
                {/* Title - Bold at top */}
                {title && (
                  <h4 className={`text-sm font-semibold line-clamp-1 mb-0.5 ${
                    isOwn ? 'text-white' : 'text-text-primary'
                  }`}>
                    {title}
                  </h4>
                )}

                {/* Description */}
                {truncatedDescription && (
                  <p className={`text-xs line-clamp-2 mb-1 ${
                    isOwn ? 'text-[#d1e7e4]' : 'text-text-secondary'
                  }`}>
                    {truncatedDescription}
                  </p>
                )}

                {/* Domain at bottom */}
                <p className={`text-[11px] ${
                  isOwn ? 'text-[#8eb8b3]' : 'text-text-tertiary'
                }`}>
                  {domain}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Full clickable URL below the card - underlined like WhatsApp */}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`block text-sm mt-1.5 underline break-all ${
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
          {url}
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