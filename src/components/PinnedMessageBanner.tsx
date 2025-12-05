// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React from 'react';
import { Pin, X } from 'lucide-react';

interface PinnedMessage {
  id: string;
  content: string;
  sender_name: string;
  pinned_at: string;
  pinned_until: string;
}

interface PinnedMessageBannerProps {
  pinnedMessage: PinnedMessage;
  onUnpin: () => void;
  onClick: () => void;
}

export const PinnedMessageBanner: React.FC<PinnedMessageBannerProps> = ({
  pinnedMessage,
  onUnpin,
  onClick,
}) => {
  // Truncate message content if too long
  const truncatedContent = pinnedMessage.content.length > 100
    ? pinnedMessage.content.substring(0, 100) + '...'
    : pinnedMessage.content;

  return (
    <div 
      className="bg-bg-surface border-b border-bg-hover px-4 py-2 flex items-center gap-3 cursor-pointer hover:bg-bg-hover transition-colors"
      onClick={onClick}
    >
      {/* Pin Icon */}
      <div className="flex-shrink-0">
        <Pin size={18} className="text-text-secondary" />
      </div>

      {/* Message Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary truncate">
          {truncatedContent || 'Message épinglé'}
        </p>
      </div>

      {/* Unpin Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onUnpin();
        }}
        className="flex-shrink-0 p-1.5 rounded-full hover:bg-bg-hover transition-colors"
        aria-label="Désépingler"
      >
        <X size={16} className="text-text-secondary" />
      </button>
    </div>
  );
};