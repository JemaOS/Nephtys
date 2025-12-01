import React, { useEffect, useRef } from 'react';

interface DeleteMessageDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onDeleteForEveryone: () => void;
  onDeleteForMe: () => void;
  isOwn: boolean;
  hasMedia?: boolean;
  messageCount?: number;
}

export const DeleteMessageDialog: React.FC<DeleteMessageDialogProps> = ({
  isOpen,
  onClose,
  onDeleteForEveryone,
  onDeleteForMe,
  isOwn,
  hasMedia = false,
  messageCount = 1,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close dialog when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
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
      // Prevent body scroll when dialog is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleDeleteForEveryone = () => {
    onDeleteForEveryone();
    onClose();
  };

  const handleDeleteForMe = () => {
    onDeleteForMe();
    onClose();
  };

  return (
    <>
      {/* Backdrop with blur effect */}
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        {/* Dialog */}
        <div
          ref={dialogRef}
          className="w-full max-w-[320px] bg-[#233138] rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        >
          {/* Title */}
          <div className="px-6 pt-6 pb-4">
            <h2 className="text-lg font-medium text-white text-center">
              {messageCount > 1
                ? `Supprimer ${messageCount} messages ?`
                : 'Supprimer le message ?'
              }
            </h2>
            {hasMedia && (
              <p className="text-sm text-[#8696a0] text-center mt-2">
                {messageCount > 1
                  ? 'Les fichiers associés seront également supprimés.'
                  : 'Le fichier associé sera également supprimé.'
                }
              </p>
            )}
          </div>

          {/* Buttons */}
          <div className="px-4 pb-4 space-y-2">
            {/* Delete for everyone - Only show if user owns the message */}
            {isOwn && (
              <button
                onClick={handleDeleteForEveryone}
                className="w-full py-3.5 px-4 rounded-xl bg-[#182229] hover:bg-[#1f2c33] transition-colors text-[#6b6fdb] font-medium text-sm border border-[#2a3942]"
                type="button"
              >
                Supprimer pour tout le monde
              </button>
            )}

            {/* Delete for me */}
            <button
              onClick={handleDeleteForMe}
              className="w-full py-3.5 px-4 rounded-xl bg-[#182229] hover:bg-[#1f2c33] transition-colors text-[#6b6fdb] font-medium text-sm border border-[#2a3942]"
              type="button"
            >
              Supprimer pour moi
            </button>

            {/* Cancel */}
            <button
              onClick={onClose}
              className="w-full py-3.5 px-4 rounded-xl bg-transparent hover:bg-[#182229] transition-colors text-[#8696a0] font-medium text-sm"
              type="button"
            >
              Annuler
            </button>
          </div>
        </div>
      </div>
    </>
  );
};