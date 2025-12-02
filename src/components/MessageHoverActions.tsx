import React from 'react';
import { ChevronDown } from 'lucide-react';

interface MessageHoverActionsProps {
  isVisible: boolean;
  isOwn: boolean;
  onOpenMenu: (e: React.MouseEvent) => void;
}

export const MessageHoverActions: React.FC<MessageHoverActionsProps> = ({
  isVisible,
  isOwn,
  onOpenMenu,
}) => {
  // Show button when isVisible is true (controlled by hover state from parent)
  // The button is always rendered but only visible when isVisible is true
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onOpenMenu(e);
      }}
      className={`absolute top-1 right-1 z-20 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
        isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      } ${
        isOwn
          ? 'bg-[#787add]/80 hover:bg-[#787add] text-white/80 hover:text-white'
          : 'bg-bg-surface/80 hover:bg-bg-surface text-text-tertiary hover:text-text-secondary'
      }`}
      type="button"
      aria-label="Options du message"
    >
      <ChevronDown size={16} />
    </button>
  );
};