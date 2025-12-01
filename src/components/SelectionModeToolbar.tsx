import React from 'react';
import { X, Copy, Star, Trash2, Forward, Download } from 'lucide-react';

interface SelectionModeToolbarProps {
  selectedCount: number;
  onCopy: () => void;
  onStar: () => void;
  onDelete: () => void;
  onForward: () => void;
  onDownload: () => void;
  onClose: () => void;
}

export const SelectionModeToolbar: React.FC<SelectionModeToolbarProps> = ({
  selectedCount,
  onCopy,
  onStar,
  onDelete,
  onForward,
  onDownload,
  onClose,
}) => {
  const hasSelection = selectedCount > 0;

  const actions = [
    { icon: Copy, label: 'Copier', onClick: onCopy },
    { icon: Star, label: 'Favoris', onClick: onStar },
    { icon: Trash2, label: 'Supprimer', onClick: onDelete, danger: true },
    { icon: Forward, label: 'Transférer', onClick: onForward },
    { icon: Download, label: 'Télécharger', onClick: onDownload },
  ];

  return (
    <div className="fixed bottom-14 md:bottom-0 left-0 right-0 bg-bg-surface border-t border-bg-hover px-4 py-3 flex items-center justify-between z-50">
      <div className="flex items-center gap-4">
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors"
          type="button"
          aria-label="Fermer le mode sélection"
        >
          <X size={20} className="text-[#8696a0]" />
        </button>
        <span className="text-sm text-[#e9edef]">
          {selectedCount} sélectionné{selectedCount > 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {actions.map((action, index) => {
          const Icon = action.icon;
          return (
            <button
              key={index}
              onClick={action.onClick}
              disabled={!hasSelection}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                hasSelection
                  ? action.danger
                    ? 'hover:bg-red-500/20 text-red-500'
                    : 'hover:bg-bg-hover text-text-tertiary'
                  : 'opacity-50 cursor-not-allowed text-text-tertiary'
              }`}
              type="button"
              aria-label={action.label}
              title={action.label}
            >
              <Icon size={20} />
            </button>
          );
        })}
      </div>
    </div>
  );
};