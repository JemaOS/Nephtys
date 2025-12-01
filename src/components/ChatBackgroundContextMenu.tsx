import React, { useEffect, useRef, useState } from 'react';
import { CheckSquare, XCircle } from 'lucide-react';

interface ChatBackgroundContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  onSelectMessages: () => void;
  onCloseDiscussion: () => void;
}

export const ChatBackgroundContextMenu: React.FC<ChatBackgroundContextMenuProps> = ({
  isOpen,
  position,
  onClose,
  onSelectMessages,
  onCloseDiscussion,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  // Position adjustment logic
  useEffect(() => {
    if (isOpen && menuRef.current) {
      const menu = menuRef.current;
      const rect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = position.x;
      let newY = position.y;

      // Adjust horizontal position
      if (position.x + rect.width > viewportWidth - 10) {
        newX = viewportWidth - rect.width - 10;
      }
      if (newX < 10) {
        newX = 10;
      }

      // Adjust vertical position
      if (position.y + rect.height > viewportHeight - 10) {
        newY = viewportHeight - rect.height - 10;
      }
      if (newY < 10) {
        newY = 10;
      }

      setAdjustedPosition({ x: newX, y: newY });
    }
  }, [isOpen, position]);

  // Close handlers
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const menuItems = [
    {
      icon: CheckSquare,
      label: 'Sélectionner des messages',
      onClick: () => {
        onSelectMessages();
        onClose();
      },
    },
    {
      icon: XCircle,
      label: 'Fermer la discussion',
      onClick: () => {
        onCloseDiscussion();
        onClose();
      },
    },
  ];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50" onClick={onClose} />

      {/* Context Menu */}
      <div
        ref={menuRef}
        className="fixed z-50 min-w-[220px] bg-bg-surface rounded-lg shadow-2xl border border-bg-hover py-2"
        style={{
          left: adjustedPosition.x,
          top: adjustedPosition.y,
        }}
      >
        {menuItems.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={index}
              onClick={item.onClick}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors text-left text-text-primary"
              type="button"
            >
              <Icon size={18} className="text-[#8696a0]" />
              <span className="text-sm">{item.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
};