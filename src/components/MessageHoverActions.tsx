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
  if (!isVisible) return null;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onOpenMenu(e);
      }}
      className={`absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 ${
        isOwn
          ? 'bg-[#005c4b]/80 hover:bg-[#005c4b] text-white/80 hover:text-white'
          : 'bg-bg-surface/80 hover:bg-bg-surface text-text-tertiary hover:text-text-secondary'
      }`}
      type="button"
      aria-label="Options du message"
    >
      <ChevronDown size={16} />
    </button>
  );
};