import React, { useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface MediaItem {
  id: string;
  url: string;
  type: 'image' | 'video';
  fileName?: string;
  caption?: string;
}

interface MediaMessageGroupProps {
  items: MediaItem[];
  isOwn: boolean;
}

export const MediaMessageGroup: React.FC<MediaMessageGroupProps> = ({
  items,
  isOwn,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  const maxVisible = 4; // Maximum images to show in grid
  const hasMore = items.length > maxVisible;
  const visibleItems = items.slice(0, maxVisible);
  const remainingCount = items.length - maxVisible;

  const openFullscreen = (index: number) => {
    setCurrentIndex(index);
    setIsFullscreen(true);
  };

  const closeFullscreen = () => {
    setIsFullscreen(false);
  };

  const goToPrevious = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
  };

  const goToNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
  };

  // Single image
  if (items.length === 1) {
    const item = items[0];
    return (
      <>
        <div
          className="relative cursor-pointer max-w-[240px] sm:max-w-[280px] rounded-xl overflow-hidden border-[3px] border-[#787add]"
          onClick={() => openFullscreen(0)}
        >
          {item.type === 'image' ? (
            <img
              src={item.url}
              alt="Image"
              className="w-full h-auto max-h-[200px] sm:max-h-[240px] object-cover"
              loading="lazy"
            />
          ) : (
            <video
              src={item.url}
              className="w-full h-auto max-h-[200px] sm:max-h-[240px]"
              controls
            />
          )}
          {item.caption && (
            <p className="mt-1.5 text-sm">{item.caption}</p>
          )}
        </div>
        {renderFullscreenModal()}
      </>
    );
  }

  // Two images - side by side
  if (items.length === 2) {
    return (
      <>
        <div className="flex gap-0.5 max-w-[280px] sm:max-w-[320px] rounded-xl overflow-hidden border-[3px] border-[#787add]">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="flex-1 cursor-pointer relative"
              onClick={() => openFullscreen(index)}
            >
              {item.type === 'image' ? (
                <img
                  src={item.url}
                  alt={`Image ${index + 1}`}
                  className="w-full h-[140px] sm:h-[160px] object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-[140px] sm:h-[160px] bg-black flex items-center justify-center">
                  <video src={item.url} className="w-full h-full object-cover" />
                </div>
              )}
            </div>
          ))}
        </div>
        {renderFullscreenModal()}
      </>
    );
  }

  // 3-4 images - 2x2 grid
  if (items.length <= 4) {
    return (
      <>
        <div className="grid grid-cols-2 gap-0.5 max-w-[280px] sm:max-w-[320px] rounded-xl overflow-hidden border-[3px] border-[#787add]">
          {visibleItems.map((item, index) => (
            <div
              key={item.id}
              className="cursor-pointer relative aspect-square"
              onClick={() => openFullscreen(index)}
            >
              {item.type === 'image' ? (
                <img
                  src={item.url}
                  alt={`Image ${index + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full bg-black flex items-center justify-center">
                  <video src={item.url} className="w-full h-full object-cover" />
                </div>
              )}
            </div>
          ))}
        </div>
        {renderFullscreenModal()}
      </>
    );
  }

  // More than 4 images - 2x2 grid with "+X" overlay on last item
  return (
    <>
      <div className="grid grid-cols-2 gap-0.5 max-w-[280px] sm:max-w-[320px] rounded-xl overflow-hidden border-[3px] border-[#787add]">
        {visibleItems.map((item, index) => (
          <div
            key={item.id}
            className="cursor-pointer relative aspect-square"
            onClick={() => openFullscreen(index)}
          >
            {item.type === 'image' ? (
              <img
                src={item.url}
                alt={`Image ${index + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full bg-black flex items-center justify-center">
                <video src={item.url} className="w-full h-full object-cover" />
              </div>
            )}
            
            {/* "+X" overlay on the last visible item */}
            {index === maxVisible - 1 && hasMore && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <span className="text-white text-2xl sm:text-3xl font-semibold">
                  +{remainingCount}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
      {renderFullscreenModal()}
    </>
  );

  function renderFullscreenModal() {
    if (!isFullscreen) return null;

    const currentItem = items[currentIndex];

    return (
      <div
        className="fixed inset-0 bg-black z-[200] flex flex-col"
        onClick={closeFullscreen}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 safe-area-top">
          <button
            onClick={closeFullscreen}
            className="p-2 rounded-full bg-white/10 backdrop-blur-sm hover:bg-white/20 transition-colors"
          >
            <X size={24} className="text-white" />
          </button>
          <span className="text-white text-sm">
            {currentIndex + 1} / {items.length}
          </span>
          <div className="w-10" /> {/* Spacer for centering */}
        </div>

        {/* Main content */}
        <div className="flex-1 flex items-center justify-center relative px-4">
          {/* Previous button */}
          {items.length > 1 && (
            <button
              onClick={goToPrevious}
              className="absolute left-2 sm:left-4 p-2 rounded-full bg-white/10 backdrop-blur-sm hover:bg-white/20 transition-colors z-10"
            >
              <ChevronLeft size={24} className="text-white" />
            </button>
          )}

          {/* Media */}
          <div className="max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
            {currentItem.type === 'image' ? (
              <img
                src={currentItem.url}
                alt={`Image ${currentIndex + 1}`}
                className="max-w-full max-h-[70vh] object-contain"
              />
            ) : (
              <video
                src={currentItem.url}
                controls
                autoPlay
                className="max-w-full max-h-[70vh]"
              />
            )}
          </div>

          {/* Next button */}
          {items.length > 1 && (
            <button
              onClick={goToNext}
              className="absolute right-2 sm:right-4 p-2 rounded-full bg-white/10 backdrop-blur-sm hover:bg-white/20 transition-colors z-10"
            >
              <ChevronRight size={24} className="text-white" />
            </button>
          )}
        </div>

        {/* Thumbnails */}
        {items.length > 1 && (
          <div className="p-4 safe-area-bottom">
            <div className="flex justify-center gap-2 overflow-x-auto">
              {items.map((item, index) => (
                <button
                  key={item.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentIndex(index);
                  }}
                  className={`w-12 h-12 sm:w-14 sm:h-14 rounded-lg overflow-hidden flex-shrink-0 border-2 transition-all ${
                    index === currentIndex ? 'border-white' : 'border-transparent opacity-60'
                  }`}
                >
                  {item.type === 'image' ? (
                    <img
                      src={item.url}
                      alt={`Thumbnail ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                      <span className="text-white text-xs">Video</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Caption */}
        {currentItem.caption && (
          <div className="p-4 text-center">
            <p className="text-white text-sm">{currentItem.caption}</p>
          </div>
        )}
      </div>
    );
  }
};