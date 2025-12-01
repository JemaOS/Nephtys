import React from 'react';
import { X, ExternalLink } from 'lucide-react';
import { LinkPreviewData } from '@/lib/linkPreview';

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
 */
export const LinkPreview: React.FC<LinkPreviewProps> = ({
  preview,
  onDismiss,
  isInMessage = false,
  isOwn = false,
}) => {
  const { url, title, description, image, siteName, domain } = preview;

  // Truncate description to 2 lines (approximately 100 characters)
  const truncatedDescription = description
    ? description.length > 100
      ? description.substring(0, 100) + '...'
      : description
    : null;

  const handleClick = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
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

  // In-message preview style
  return (
    <div className="mt-1 mb-2">
      <div
        className={`rounded-lg overflow-hidden cursor-pointer transition-colors ${
          isOwn
            ? 'bg-[#004d40] hover:bg-[#00695c]'
            : 'bg-bg-hover hover:bg-bg-surface'
        }`}
        onClick={handleClick}
      >
        <div className="flex">
          {/* Thumbnail */}
          {image && (
            <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0">
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
          <div className="flex-1 p-2 min-w-0">
            {/* Site name / Domain */}
            <p className={`text-[10px] uppercase tracking-wide mb-0.5 ${
              isOwn ? 'text-[#a8d5d0]' : 'text-text-tertiary'
            }`}>
              {siteName || domain}
            </p>

            {/* Title */}
            {title && (
              <h4 className={`text-xs font-semibold line-clamp-1 ${
                isOwn ? 'text-white' : 'text-text-primary'
              }`}>
                {title}
              </h4>
            )}

            {/* Description */}
            {truncatedDescription && (
              <p className={`text-[11px] line-clamp-2 ${
                isOwn ? 'text-[#d1e7e4]' : 'text-text-secondary'
              }`}>
                {truncatedDescription}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Clickable URL below the card */}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1 text-xs mt-1 hover:underline ${
          isOwn ? 'text-[#53bdeb]' : 'text-accent'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <ExternalLink size={12} />
        <span className="truncate max-w-[200px]">{domain}</span>
      </a>
    </div>
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