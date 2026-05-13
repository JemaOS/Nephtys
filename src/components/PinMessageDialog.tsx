// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState } from 'react';

interface PinMessageDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onPin: (duration: number) => void;
}

type PinDuration = '24h' | '7d' | '30d';

const PIN_DURATIONS: { value: PinDuration; label: string; seconds: number }[] = [
  { value: '24h', label: '24 heures', seconds: 24 * 60 * 60 },
  { value: '7d', label: '7 jours', seconds: 7 * 24 * 60 * 60 },
  { value: '30d', label: '30 jours', seconds: 30 * 24 * 60 * 60 },
];

export const PinMessageDialog: React.FC<PinMessageDialogProps> = ({
  isOpen,
  onClose,
  onPin,
}) => {
  const [selectedDuration, setSelectedDuration] = useState<PinDuration>('7d');
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  // showModal() place le dialog dans le CSS top layer, au-dessus de tout
  // autre élément y compris les autres dialogs (MediaViewer).
  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (isOpen) {
      if (!el.open) el.showModal();
    } else {
      if (el.open) el.close();
    }
  }, [isOpen]);

  // Fermer sur Escape natif
  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const onCancel = (e: Event) => { e.preventDefault(); onClose(); };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [onClose]);

  if (!isOpen) return null;

  const handlePin = () => {
    const duration = PIN_DURATIONS.find(d => d.value === selectedDuration);
    if (duration) {
      onPin(duration.seconds);
    }
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="bg-transparent border-none p-0 m-0 max-w-none max-h-none w-full h-full"
      style={{ width: '100vw', height: '100dvh', maxWidth: '100vw', maxHeight: '100dvh' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Centrage */}
      <div className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none">
      {/* Dialog Content */}
      <div className="bg-bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden cursor-auto text-left border-none flex flex-col pointer-events-auto">
          {/* Header */}
          <div className="px-6 py-4">
            <h2 className="text-xl font-medium text-text-primary">
              Choisissez la durée d'épinglage
            </h2>
            <p className="text-sm text-text-secondary mt-2">
              Vous pouvez à tout moment détacher ce qui a été épinglé.
            </p>
          </div>

          {/* Duration Options */}
          <div className="px-6 py-4 space-y-3">
            {PIN_DURATIONS.map((duration) => (
              <label
                key={duration.value}
                htmlFor={`pin-duration-${duration.value}`}
                className="flex items-center gap-3 cursor-pointer group"
              >
                <div className="relative">
                  <input
                    type="radio"
                    id={`pin-duration-${duration.value}`}
                    name="pin-duration"
                    value={duration.value}
                    checked={selectedDuration === duration.value}
                    onChange={() => setSelectedDuration(duration.value)}
                    className="sr-only"
                  />
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                      selectedDuration === duration.value
                        ? 'border-[#5a5ec9] bg-transparent'
                        : 'border-text-tertiary bg-transparent'
                    }`}
                  >
                    {selectedDuration === duration.value && (
                      <div className="w-2.5 h-2.5 rounded-full bg-[#5a5ec9]" />
                    )}
                  </div>
                </div>
                <span className="text-text-primary text-base">
                  {duration.label}
                </span>
              </label>
            ))}
          </div>

          {/* Actions */}
          <div className="px-6 py-4 flex items-center justify-end gap-4">
            <button
              onClick={onClose}
              className="px-6 py-2.5 text-[#5a5ec9] hover:bg-bg-hover rounded-full transition-colors font-medium"
            >
              Annuler
            </button>
            <button
              onClick={handlePin}
              className="px-6 py-2.5 bg-[#5a5ec9] hover:bg-[#5a5ec9]/90 text-white rounded-full transition-colors font-medium"
            >
              Épingler
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
};