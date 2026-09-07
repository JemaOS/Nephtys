// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React from 'react';
import { WifiOff, Wifi, RefreshCw } from 'lucide-react';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { useI18n } from '@/i18n';

export const OfflineIndicator: React.FC = () => {
  const { isOnline, isSyncing, pendingCount, syncNow } = useOfflineSync();
  const { t } = useI18n();

  if (isOnline && pendingCount === 0) {
    return null; // Ne rien afficher si tout va bien
  }

  const getOfflineIndicator = () => {
    if (!isOnline) {
      return (
        <div className="bg-yellow-500/90 backdrop-blur-sm text-white px-4 py-2 flex items-center justify-center gap-2">
          <WifiOff size={16} />
          <span className="text-sm font-medium">{t('offlineMode')}</span>
          {pendingCount > 0 && (
            <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">
              {t('pendingMessages', { count: pendingCount })}
            </span>
          )}
        </div>
      );
    }
    if (isSyncing) {
      return (
        <div className="bg-primary-500/90 backdrop-blur-sm text-white px-4 py-2 flex items-center justify-center gap-2">
          <RefreshCw size={16} className="animate-spin" />
          <span className="text-sm font-medium">{t('syncing')}</span>
        </div>
      );
    }
    if (pendingCount > 0) {
      return (
        <div className="bg-green-500/90 backdrop-blur-sm text-white px-4 py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wifi size={16} />
            <span className="text-sm font-medium">{t('connectionRestored')}</span>
          </div>
          <button
            onClick={syncNow}
            className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full transition-colors"
          >
            {t('syncNow')} ({pendingCount})
          </button>
        </div>
      );
    }
    return null;
  };

  const indicator = getOfflineIndicator();
  if (!indicator) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 safe-area-top">
      {indicator}
    </div>
  );
};