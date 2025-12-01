import React, { useState } from 'react';
import { Star, Trash2, Edit, Copy, Forward, MoreVertical } from 'lucide-react';
import { DeleteMessageDialog } from './DeleteMessageDialog';

interface MessageActionsProps {
  messageId: string;
  content: string;
  isOwn: boolean;
  isPinned: boolean;
  hasMedia?: boolean;
  onEdit?: () => void;
  onDeleteForEveryone?: () => void;
  onDeleteForMe?: () => void;
  onDelete?: () => void; // Legacy support
  onPin?: () => void;
  onForward?: () => void;
  onCopy?: () => void;
}

export const MessageActions: React.FC<MessageActionsProps> = ({
  messageId,
  content,
  isOwn,
  isPinned,
  hasMedia = false,
  onEdit,
  onDeleteForEveryone,
  onDeleteForMe,
  onDelete,
  onPin,
  onForward,
  onCopy,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    alert('Message copié!');
    setIsOpen(false);
  };

  const handleEdit = () => {
    onEdit?.();
    setIsOpen(false);
  };

  const handleDelete = () => {
    setIsOpen(false);
    // If new delete handlers are provided, show the dialog
    if (onDeleteForEveryone || onDeleteForMe) {
      setShowDeleteDialog(true);
    } else {
      // Legacy behavior
      onDelete?.();
    }
  };

  const handleDeleteForEveryone = () => {
    onDeleteForEveryone?.();
    setShowDeleteDialog(false);
  };

  const handleDeleteForMe = () => {
    onDeleteForMe?.();
    setShowDeleteDialog(false);
  };

  const handlePin = () => {
    onPin?.();
    setIsOpen(false);
  };

  const handleForward = () => {
    onForward?.();
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
        aria-label="Actions du message"
      >
        <MoreVertical size={16} className="text-text-tertiary" />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Menu */}
          <div className="absolute right-0 top-full mt-1 bg-white/10 backdrop-blur-xl rounded-xl p-2 shadow-2xl border border-white/20 z-50 min-w-[180px]">
            <button
              onClick={handleCopy}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/10 rounded-lg transition-colors text-left"
            >
              <Copy size={16} className="text-text-tertiary" />
              <span className="text-sm">Copier</span>
            </button>

            <button
              onClick={handlePin}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/10 rounded-lg transition-colors text-left"
            >
              <Star size={16} className={isPinned ? 'text-yellow-500' : 'text-text-tertiary'} fill={isPinned ? 'currentColor' : 'none'} />
              <span className="text-sm">{isPinned ? 'Retirer des favoris' : 'Épingler'}</span>
            </button>

            <button
              onClick={handleForward}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/10 rounded-lg transition-colors text-left"
            >
              <Forward size={16} className="text-text-tertiary" />
              <span className="text-sm">Transférer</span>
            </button>

            {isOwn && (
              <>
                <div className="h-px bg-white/10 my-2" />
                
                <button
                  onClick={handleEdit}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/10 rounded-lg transition-colors text-left"
                >
                  <Edit size={16} className="text-text-tertiary" />
                  <span className="text-sm">Modifier</span>
                </button>

                <button
                  onClick={handleDelete}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-red-500/20 rounded-lg transition-colors text-left"
                >
                  <Trash2 size={16} className="text-red-500" />
                  <span className="text-sm text-red-500">Supprimer</span>
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Delete Message Dialog */}
      <DeleteMessageDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onDeleteForEveryone={handleDeleteForEveryone}
        onDeleteForMe={handleDeleteForMe}
        isOwn={isOwn}
        hasMedia={hasMedia}
      />
    </div>
  );
};