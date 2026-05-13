// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useEffect, useRef, useState } from 'react';
import { 
  Reply, 
  User, 
  MessageSquare, 
  Copy, 
  Forward, 
  Pin, 
  Star, 
  CheckSquare, 
  Download, 
  Flag, 
  Trash2,
  Plus
} from 'lucide-react';
import { downloadMedia } from '@/lib/downloadMedia';

interface MessageContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  messageId: string;
  messageContent: string;
  messageType: 'text' | 'image' | 'video' | 'file' | 'audio';
  isOwn: boolean;
  isGroupChat?: boolean;
  senderName?: string;
  mediaUrl?: string;
  /** Nom de fichier original (pour les pièces jointes) */
  fileName?: string | null;
  /** True si le média est chiffré E2EE — déchiffrement requis avant DL */
  isEncrypted?: boolean;
  /** ID utilisateur courant — requis pour déchiffrer un média E2EE */
  currentUserId?: string;
  onClose: () => void;
  onReply: () => void;
  onReplyPrivately?: () => void;
  onSendMessage?: () => void;
  onCopy: () => void;
  onForward: () => void;
  onPin: () => void;
  onStar: () => void;
  onSelect: () => void;
  onSaveAs?: () => void;
  onReport: () => void;
  onDelete: () => void;
  onReaction: (emoji: string) => void;
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const EXTENDED_EMOJIS = [
  '👍', '❤️', '😂', '😮', '😢', '🙏', '😊', '🔥', '👏', '🎉',
  '💯', '✨', '😍', '🤔', '😎', '🥳', '😭', '💪', '👌', '✅',
  '❌', '⭐', '💙', '💚', '💛', '💜', '🧡', '🖤', '🤍', '💖'
];

export const MessageContextMenu: React.FC<MessageContextMenuProps> = ({
  isOpen,
  position,
  messageId,
  messageContent,
  messageType,
  isOwn,
  isGroupChat = false,
  senderName,
  mediaUrl,
  fileName,
  isEncrypted,
  currentUserId,
  onClose,
  onReply,
  onReplyPrivately,
  onSendMessage,
  onCopy,
  onForward,
  onPin,
  onStar,
  onSelect,
  onSaveAs,
  onReport,
  onDelete,
  onReaction,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showExtendedEmojis, setShowExtendedEmojis] = useState(false);
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  // Adjust menu position to stay within viewport
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

  // Close menu when clicking outside
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

  const handleReaction = (emoji: string) => {
    onReaction(emoji);
    onClose();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(messageContent);
    onCopy();
    onClose();
  };

  const handleSaveAs = async () => {
    if (mediaUrl) {
      // Helper centralisé : gère paths nus, URLs expirées, médias chiffrés,
      // et donne un retour utilisateur clair en cas d'échec.
      await downloadMedia({
        mediaUrl,
        fileName,
        mediaType: messageType,
        messageId,
        userId: currentUserId,
        isEncrypted,
      });
    }
    onSaveAs?.();
    onClose();
  };

  const menuItems = [
    {
      icon: Reply,
      label: 'Répondre',
      onClick: () => { onReply(); onClose(); },
      show: true,
    },
    {
      icon: User,
      label: 'Répondre en privé',
      onClick: () => { onReplyPrivately?.(); onClose(); },
      show: isGroupChat && !isOwn,
    },
    {
      icon: MessageSquare,
      label: `Envoyer un message à ${senderName || 'l\'utilisateur'}`,
      onClick: () => { onSendMessage?.(); onClose(); },
      show: isGroupChat && !isOwn,
    },
    {
      icon: Copy,
      label: 'Copier',
      onClick: handleCopy,
      show: messageType === 'text' && messageContent.length > 0,
    },
    {
      icon: Forward,
      label: 'Transférer',
      onClick: () => { onForward(); onClose(); },
      show: true,
    },
    {
      icon: Pin,
      label: 'Épingler',
      onClick: () => { onPin(); onClose(); },
      show: true,
    },
    {
      icon: Star,
      label: 'Marquer comme important',
      onClick: () => { onStar(); onClose(); },
      show: true,
    },
    {
      icon: CheckSquare,
      label: 'Sélectionner',
      onClick: () => { onSelect(); onClose(); },
      show: true,
    },
    {
      icon: Download,
      label: 'Enregistrer sous',
      onClick: handleSaveAs,
      show: ['image', 'video', 'file', 'audio'].includes(messageType) && !!mediaUrl,
    },
    {
      icon: Flag,
      label: 'Signaler',
      onClick: () => { onReport(); onClose(); },
      show: !isOwn,
    },
    {
      icon: Trash2,
      label: 'Supprimer',
      onClick: () => { onDelete(); onClose(); },
      show: true,
      danger: true,
    },
  ];

  const visibleItems = menuItems.filter(item => item.show);

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        className="fixed inset-0 z-50 w-full h-full cursor-default"
        onClick={onClose}
        aria-label="Fermer le menu"
      />
      
      {/* Context Menu */}
      <div
        ref={menuRef}
        className="fixed z-50 min-w-[220px] max-w-[280px] bg-bg-surface rounded-2xl shadow-2xl border border-bg-hover overflow-hidden"
        style={{
          left: adjustedPosition.x,
          top: adjustedPosition.y,
        }}
      >
        {/* Emoji Reaction Bar */}
        <div className="p-3 border-b border-[#3b4a54]">
          {showExtendedEmojis ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#8696a0]">Toutes les réactions</span>
                <button
                  onClick={() => setShowExtendedEmojis(false)}
                  className="text-xs text-[#787add] hover:underline"
                  type="button"
                >
                  Retour
                </button>
              </div>
              <div className="grid grid-cols-6 gap-1 max-h-[150px] overflow-y-auto">
                {EXTENDED_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    className="w-9 h-9 flex items-center justify-center text-xl hover:bg-bg-hover rounded-lg transition-all hover:scale-110 active:scale-95"
                    type="button"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-1">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleReaction(emoji)}
                  className="w-10 h-10 flex items-center justify-center text-2xl hover:bg-bg-hover rounded-full transition-all hover:scale-110 active:scale-95"
                  type="button"
                >
                  {emoji}
                </button>
              ))}
              <button
                onClick={() => setShowExtendedEmojis(true)}
                className="w-10 h-10 flex items-center justify-center hover:bg-bg-hover rounded-full transition-all"
                type="button"
              >
                <Plus size={20} className="text-[#8696a0]" />
              </button>
            </div>
          )}
        </div>

        {/* Menu Items */}
        <div className="py-2 max-h-[300px] overflow-y-auto">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={item.onClick}
                className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors text-left ${
                  item.danger ? 'text-[#ea4335]' : 'text-text-primary'
                }`}
                type="button"
              >
                <Icon size={18} className={item.danger ? 'text-[#ea4335]' : 'text-[#8696a0]'} />
                <span className="text-sm">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
};