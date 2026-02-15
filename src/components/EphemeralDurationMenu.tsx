import React from 'react';
import { Check } from 'lucide-react';

interface EphemeralDurationMenuProps {
  isOpen: boolean;
  onClose: () => void;
  currentDuration: number | null;
  onSelectDuration: (duration: number | null) => void;
}

export const EphemeralDurationMenu: React.FC<EphemeralDurationMenuProps> = ({
  isOpen,
  onClose,
  currentDuration,
  onSelectDuration,
}) => {
  if (!isOpen) return null;

  const renderEphemeralMenuItem = (duration: number | null, label: string) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onSelectDuration(duration);
      }}
      className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors flex items-center justify-between"
    >
      <span className="text-sm text-text-primary">{label}</span>
      {currentDuration === duration && <Check size={18} className="text-accent" />}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div
        className="bg-bg-surface w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="p-4 border-b border-bg-hover">
          <h4 className="text-base font-medium text-text-primary">Durée des messages</h4>
          <p className="text-xs text-text-secondary mt-1">
            Les nouveaux messages disparaîtront après la durée sélectionnée
          </p>
        </div>
        
        <div className="py-2">
          {renderEphemeralMenuItem(null, 'Désactivé')}
          {renderEphemeralMenuItem(3600, '1 heure')}
          {renderEphemeralMenuItem(86400, '24 heures')}
          {renderEphemeralMenuItem(604800, '7 jours')}
          {renderEphemeralMenuItem(7776000, '90 jours')}
        </div>

        <div className="p-4 border-t border-bg-hover">
          <button
            onClick={onClose}
            className="w-full py-2 bg-bg-hover text-text-primary rounded-xl text-sm font-medium hover:bg-bg-hover/80 transition-colors"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
};
