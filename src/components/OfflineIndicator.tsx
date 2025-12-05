// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React from 'react';
import { WifiOff, Wifi, RefreshCw } from 'lucide-react';
import { useOfflineSync } from '@/hooks/useOfflineSync';

export const OfflineIndicator: React.FC = () => {
  const { isOnline, isSyncing, pendingCount, syncNow } = useOfflineSync();

  if (isOnline && pendingCount === 0) {
    return null; // Ne rien afficher si tout va bien
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 safe-area-top">
      {!isOnline ? (
        <div className="bg-yellow-500/90 backdrop-blur-sm text-white px-4 py-2 flex items-center justify-center gap-2">
          <WifiOff size={16} />
          <span className="text-sm font-medium">Mode hors ligne</span>
          {pendingCount > 0 && (
            <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">
              {pendingCount} message{pendingCount > 1 ? 's' : ''} en attente
            </span>
          )}
        </div>
      ) : isSyncing ? (
        <div className="bg-primary-500/90 backdrop-blur-sm text-white px-4 py-2 flex items-center justify-center gap-2">
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm font-medium">Synchronisation en cours...</span>
        </div>
      ) : pendingCount > 0 ? (
        <div className="bg-green-500/90 backdrop-blur-sm text-white px-4 py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wifi size={16} />
            <span className="text-sm font-medium">Connexion rétablie</span>
          </div>
          <button
            onClick={syncNow}
            className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full transition-colors"
          >
            Synchroniser ({pendingCount})
          </button>
        </div>
      ) : null}
    </div>
  );
};