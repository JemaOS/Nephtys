import React, { useState } from 'react';
import { Timer, Check } from 'lucide-react';

interface EphemeralMessageToggleProps {
  onToggle: (enabled: boolean, duration: number) => void;
  currentDuration: number | null;
}

const DURATIONS = [
  { label: '24 heures', value: 86400 },
  { label: '7 jours', value: 604800 },
  { label: '90 jours', value: 7776000 },
];

export const EphemeralMessageToggle: React.FC<EphemeralMessageToggleProps> = ({
  onToggle,
  currentDuration,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleDurationSelect = (duration: number) => {
    onToggle(true, duration);
    setIsOpen(false);
  };

  const handleDisable = () => {
    onToggle(false, 0);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`p-2 rounded-full transition-colors ${
          currentDuration 
            ? 'bg-primary-500/20 text-primary-500' 
            : 'hover:bg-white/10 text-text-tertiary'
        }`}
        aria-label="Messages éphémères"
        type="button"
      >
        <Timer size={20} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 mb-2 bg-white/10 backdrop-blur-xl rounded-2xl p-2 shadow-2xl border border-white/20 z-50 min-w-[200px]">
          <div className="text-xs text-gray-400 mb-2 px-3 py-1">
            Messages éphémères
          </div>

          {DURATIONS.map((duration) => (
            <button
              key={duration.value}
              onClick={() => handleDurationSelect(duration.value)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/10 rounded-lg transition-colors text-left"
              type="button"
            >
              <span className="text-sm text-text-primary">{duration.label}</span>
              {currentDuration === duration.value && (
                <Check size={16} className="text-primary-500" />
              )}
            </button>
          ))}

          {currentDuration && (
            <>
              <div className="h-px bg-white/10 my-2" />
              <button
                onClick={handleDisable}
                className="w-full px-3 py-2 hover:bg-white/10 rounded-lg transition-colors text-left text-sm text-text-primary"
                type="button"
              >
                Désactiver
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};