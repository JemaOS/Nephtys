// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useRef, useEffect } from 'react';
import { Smile } from 'lucide-react';

interface EmojiPickerProps {
  onEmojiSelect: (emoji: string) => void;
  onClose?: () => void;
}

// Liste réduite des emojis essentiels (sans défilement)
const POPULAR_EMOJIS = [
  '😊', '😂', '😍', '🤔', '😢', '😭',
  '😡', '😎', '🥳', '😮', '😱', '😴',
  '👍', '👎', '👋', '👌', '🙏', '💪',
  '❤️', '💔', '✨', '🎉', '🔥', '💯'
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
          className="absolute bottom-full left-0 mb-2 bg-glass-surface-light backdrop-blur-xl rounded-2xl p-2 shadow-2xl border border-glass-border z-50 flex flex-col"
          style={{ width: 'max-content' }}
        >
          {/* Emoji Grid */}
          <div className="grid grid-cols-6 gap-1 p-1">
            {POPULAR_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleEmojiClick(emoji)}
                className="w-8 h-8 flex items-center justify-center text-xl hover:bg-white/10 rounded-md transition-all hover:scale-110 active:scale-95"
                type="button"
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};