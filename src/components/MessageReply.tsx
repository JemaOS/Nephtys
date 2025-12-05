// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React from 'react';
import { X } from 'lucide-react';

interface MessageReplyProps {
  replyToMessage: {
    id: string;
    content: string;
    sender_id: string;
    senderName?: string;
  } | null;
  onCancel?: () => void;
  isPreview?: boolean; // true = dans la barre d'input, false = dans le message
}

export const MessageReply: React.FC<MessageReplyProps> = ({
  replyToMessage,
  onCancel,
  isPreview = false,
}) => {
  if (!replyToMessage) return null;

  const truncateText = (text: string, maxLength: number = 100) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  if (isPreview) {
    // Affichage dans la barre d'input (avant d'envoyer) - Style JemaOS
    return (
      <div className="mb-2 mx-1 bg-bg-hover rounded-xl overflow-hidden">
        <div className="flex items-stretch">
          {/* Left accent border */}
          <div className="w-1 bg-accent flex-shrink-0" />
          
          {/* Content */}
          <div className="flex-1 min-w-0 px-3 py-2">
            <div className="text-sm font-medium text-accent mb-0.5">
              {replyToMessage.senderName || 'Utilisateur'}
            </div>
            <div className="text-sm text-text-secondary truncate">
              {truncateText(replyToMessage.content)}
            </div>
          </div>
          
          {/* Close button */}
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-3 flex items-center justify-center hover:bg-bg-surface/50 transition-colors flex-shrink-0"
              aria-label="Annuler la réponse"
            >
              <X size={20} className="text-text-secondary" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // Affichage dans le message (citation) - Style JemaOS
  return (
    <div className="mb-2 rounded-lg overflow-hidden bg-black/10">
      <div className="flex items-stretch">
        {/* Left accent border */}
        <div className="w-1 bg-accent flex-shrink-0" />
        
        {/* Content */}
        <div className="flex-1 min-w-0 px-3 py-2">
          <div className="text-xs font-semibold text-accent mb-0.5">
            {replyToMessage.senderName || 'Utilisateur'}
          </div>
          <div className="text-sm text-text-primary/80 truncate">
            {truncateText(replyToMessage.content, 150)}
          </div>
        </div>
      </div>
    </div>
  );
};