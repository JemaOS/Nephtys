import React, { useState, useRef, useEffect } from 'react';
import { Smile } from 'lucide-react';

interface EmojiPickerProps {
  onEmojiSelect: (emoji: string) => void;
  onClose?: () => void;
}

// Liste des emojis les plus utilisés dans les messageries
const POPULAR_EMOJIS = [
  '👍', '❤️', '😂', '😮', '😢', '🙏',
  '😊', '🔥', '👏', '🎉', '💯', '✨',
  '😍', '🤔', '😎', '🥳', '😭', '💪',
  '👌', '✅', '❌', '⭐', '💙', '💚',
  '💛', '💜', '🧡', '🖤', '🤍', '💖'
];

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onEmojiSelect, onClose }) => {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        onClose?.();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  const handleEmojiClick = (emoji: string) => {
    onEmojiSelect(emoji);
    setIsOpen(false);
    onClose?.();
  };

  return (
    <div className="relative" ref={pickerRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-full hover:bg-white/10 transition-colors"
        aria-label="Add reaction"
        type="button"
      >
        <Smile className="w-5 h-5 text-gray-400" />
      </button>

      {/* Emoji Picker Popup */}
      {isOpen && (
        <div 
          className="absolute bottom-full right-0 mb-2 bg-white/10 backdrop-blur-xl rounded-2xl p-3 shadow-2xl border border-white/20 z-50"
          style={{ minWidth: '280px' }}
        >
          {/* Header */}
          <div className="text-xs text-gray-400 mb-2 px-1">
            Réactions rapides
          </div>

          {/* Emoji Grid */}
          <div className="grid grid-cols-6 gap-1">
            {POPULAR_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleEmojiClick(emoji)}
                className="w-10 h-10 flex items-center justify-center text-2xl hover:bg-white/20 rounded-lg transition-all hover:scale-110 active:scale-95"
                type="button"
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>

          {/* Footer hint */}
          <div className="text-xs text-gray-500 mt-2 px-1 text-center">
            Cliquez pour réagir
          </div>
        </div>
      )}
    </div>
  );
};