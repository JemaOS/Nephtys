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

  const truncateText = (text: string, maxLength: number = 50) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  if (isPreview) {
    // Affichage dans la barre d'input (avant d'envoyer)
    return (
      <div className="bg-bg-surface border-t border-bg-hover p-3 flex items-start gap-3">
        <div className="w-1 h-full bg-accent rounded-full" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-accent mb-1">
            Répondre à {replyToMessage.senderName || 'Utilisateur'}
          </div>
          <div className="text-sm text-text-primary truncate">
            {truncateText(replyToMessage.content)}
          </div>
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            className="p-1 rounded-full hover:bg-bg-hover transition-colors flex-shrink-0"
            aria-label="Annuler la réponse"
          >
            <X size={16} className="text-text-secondary" />
          </button>
        )}
      </div>
    );
  }

  // Affichage dans le message (citation)
  return (
    <div className="mb-2 pl-3 border-l-4 border-accent bg-bg-hover/30 rounded-r-xl p-2.5">
      <div className="text-xs font-semibold text-accent mb-1">
        {replyToMessage.senderName || 'Utilisateur'}
      </div>
      <div className="text-sm text-text-primary truncate">
        {truncateText(replyToMessage.content, 100)}
      </div>
    </div>
  );
};