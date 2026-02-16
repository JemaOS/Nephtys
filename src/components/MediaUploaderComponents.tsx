import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Music, Play, Pause, Search, Loader2 } from 'lucide-react';

// Helper function to format file size
export const formatFileSizeDisplay = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' ko';
  return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
};

// Custom Audio Preview Player Component - Minimalist design
export const AudioPreviewPlayer: React.FC<{ file: File; preview: string | null }> = ({ file, preview }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current && !isDragging) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = Number.parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="p-6">
      <div className="flex flex-col items-center gap-5">
        {/* Album art / Music icon */}
        <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-accent/30 to-accent/10 flex items-center justify-center">
          <Music size={48} className="text-accent" />
        </div>
        
        {/* File name */}
        <div className="text-center max-w-full px-4">
          <p className="text-text-primary font-medium truncate">
            {file.name.replace(/\.[^/.]+$/, '')}
          </p>
          <p className="text-text-tertiary text-sm mt-1">
            {formatFileSizeDisplay(file.size)}
          </p>
        </div>
        
        {/* Custom audio player */}
        <div className="w-full max-w-sm">
          {/* Progress bar */}
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            onMouseDown={() => setIsDragging(true)}
            onMouseUp={() => setIsDragging(false)}
            onTouchStart={() => setIsDragging(true)}
            onTouchEnd={() => setIsDragging(false)}
            className="w-full h-1.5 rounded-full cursor-pointer appearance-none bg-bg-hover"
            style={{
              backgroundSize: `${progress}% 100%`,
              backgroundImage: `linear-gradient(#6b6fdb, #6b6fdb)`,
              backgroundRepeat: 'no-repeat'
            }}
          />
          
          {/* Time display */}
          <div className="flex justify-between text-xs text-text-tertiary mt-2">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
          
          {/* Play/Pause button */}
          <div className="flex justify-center mt-4">
            <button
              onClick={togglePlay}
              className="w-14 h-14 rounded-full bg-accent hover:bg-[#6a6ec8] flex items-center justify-center transition-colors"
            >
              {isPlaying ? (
                <Pause size={24} className="text-white" fill="white" />
              ) : (
                <Play size={24} className="text-white ml-1" fill="white" />
              )}
            </button>
          </div>
        </div>
        
        {/* Hidden audio element */}
        <audio
          ref={audioRef}
          src={preview || URL.createObjectURL(file)}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          className="hidden"
        >
          <track kind="captions" src="" label="English" />
        </audio>
      </div>
    </div>
  );
};

interface EmojiPickerProps {
  onEmojiSelect: (emoji: string) => void;
  onCancel: () => void;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onEmojiSelect, onCancel }) => {
  const emojiCategories = {
    recent: ['👍', '❤️', '😂', '😮', '😢', '🙏'],
    smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐'],
    gestures: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝'],
    hearts: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️'],
    objects: ['🎉', '🎊', '🎁', '🎈', '🎀', '🏆', '🥇', '🥈', '🥉', '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🎮', '🎯', '🎲', '🧩'],
    nature: ['🌸', '🌺', '🌻', '🌹', '🌷', '🌼', '💐', '🌿', '🍀', '🌴', '🌵', '🌲', '🌳', '🍁', '🍂', '🍃', '🌾', '🌱', '🌊', '🔥'],
    food: ['🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🥑', '🍕', '🍔', '🍟', '🌭'],
  };

  const getEmojiCategoryLabel = (category: string): string => {
    const labels: Record<string, string> = {
      recent: 'Récents',
      smileys: 'Smileys',
      gestures: 'Gestes',
      hearts: 'Cœurs',
      objects: 'Objets',
      nature: 'Nature',
      food: 'Nourriture',
    };
    return labels[category] || category;
  };

  const handleEmojiClick = (emoji: string) => {
    onEmojiSelect(emoji);
    onCancel();
  };

  return (
    <div className="space-y-4">
      {Object.entries(emojiCategories).map(([category, emojis]) => (
        <div key={category}>
          <h4 className="text-xs text-text-secondary uppercase mb-2">
            {getEmojiCategoryLabel(category)}
          </h4>
          <div className="grid grid-cols-8 gap-1">
            {emojis.map((emoji, idx) => (
              <button
                key={idx}
                onClick={() => handleEmojiClick(emoji)}
                className="w-10 h-10 flex items-center justify-center text-2xl hover:bg-bg-hover rounded-lg transition-all hover:scale-110 active:scale-95"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

interface StickerPickerProps {
  stickerCategories: string[];
  selectedStickerCategory: string;
  setSelectedStickerCategory: (category: any) => void;
  stickerSearchQuery: string;
  setStickerSearchQuery: (query: string) => void;
  loadingStickers: boolean;
  stickers: any[];
  handleStickerSelect: (sticker: any) => void;
}

export const StickerPicker: React.FC<StickerPickerProps> = ({
  stickerCategories,
  selectedStickerCategory,
  setSelectedStickerCategory,
  stickerSearchQuery,
  setStickerSearchQuery,
  loadingStickers,
  stickers,
  handleStickerSelect,
}) => {
  const getStickerCategoryLabel = (category: string): string => {
    const labels: Record<string, string> = {
      love: '❤️ Amour',
      happy: '😊 Joyeux',
      sad: '😢 Triste',
      angry: '😠 Fâché',
      cute: '🥰 Mignon',
      funny: '😂 Drôle',
      hello: '👋 Salut',
      bye: '👋 Au revoir',
      thanks: '🙏 Merci',
      sorry: '😔 Désolé',
    };
    return labels[category] || category;
  };

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
        <input
          type="text"
          value={stickerSearchQuery}
          onChange={(e) => setStickerSearchQuery(e.target.value)}
          placeholder="Rechercher des stickers..."
          className="w-full pl-10 pr-4 py-2 rounded-xl bg-bg-surface text-text-primary placeholder:text-text-secondary outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {/* Category selector */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
        {stickerCategories.map((category) => (
          <button
            key={category}
            onClick={() => {
              setSelectedStickerCategory(category);
              setStickerSearchQuery('');
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              selectedStickerCategory === category && !stickerSearchQuery
                ? 'bg-accent text-white'
                : 'bg-bg-surface text-text-secondary hover:bg-bg-hover'
            }`}
          >
            {getStickerCategoryLabel(category)}
          </button>
        ))}
      </div>
      
      {/* Stickers grid */}
      {loadingStickers ? (
        <div className="flex justify-center py-8">
          <Loader2 size={32} className="animate-spin text-accent" />
        </div>
      ) : stickers.length > 0 ? (
        <div className="grid grid-cols-3 gap-3">
          {stickers.map((sticker) => (
            <button
              key={sticker.id}
              onClick={() => handleStickerSelect(sticker)}
              className="aspect-square rounded-xl overflow-hidden bg-transparent hover:bg-bg-hover transition-all p-2"
            >
              <img
                src={sticker.media_formats?.tinywebp?.url || sticker.media_formats?.tinygif?.url}
                alt={sticker.content_description || 'Sticker'}
                className="w-full h-full object-contain"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-text-secondary">
          <p>Aucun sticker trouvé</p>
          <p className="text-xs mt-1">Essayez une autre recherche</p>
        </div>
      )}
      
      {/* Tenor attribution */}
      <p className="text-xs text-text-secondary text-center">
        Powered by Tenor
      </p>
    </div>
  );
};
