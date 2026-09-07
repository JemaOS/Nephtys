// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React from 'react';
import { Bell, BellOff, Check } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { useI18n } from '@/i18n';

export const NotificationSettings: React.FC = () => {
  const { t } = useI18n();
  const { permission, isSupported, requestPermission } = useNotifications();

  const handleEnableNotifications = async () => {
    const granted = await requestPermission();
    if (granted) {
      alert(t('notificationsEnabledSuccess'));
    } else {
      alert(t('permissionDeniedAlert'));
    }
  };

  if (!isSupported) {
    return (
      <div className="p-4 rounded-xl bg-glass-surface-medium border border-glass-border">
        <div className="flex items-center gap-3">
          <BellOff size={24} className="text-text-tertiary" />
          <div className="flex-1">
            <h3 className="font-semibold">{t('notificationsUnsupported')}</h3>
            <p className="text-sm text-text-tertiary">{t('browserNoNotifications')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-glass-surface-medium border border-glass-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell size={24} className={permission === 'granted' ? 'text-success-500' : 'text-text-tertiary'} />
            <div className="flex-1">
              <h3 className="font-semibold">{t('pushNotifications')}</h3>
              <p className="text-sm text-text-tertiary">
                {(() => {
                  if (permission === 'granted') {
                    return t('notifGrantedDesc');
                  }
                  if (permission === 'denied') {
                    return t('notifDeniedDesc');
                  }
                  return t('notifDefaultDesc');
                })()}
              </p>
            </div>
          </div>
          
          {(() => {
            if (permission === 'granted') {
              return <Check size={24} className="text-success-500" />;
            }
            if (permission === 'default') {
              return (
                <button
                  onClick={handleEnableNotifications}
                  className="px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white transition-colors"
                >
                  {t('enableAction')}
                </button>
              );
            }
            return null;
          })()}
        </div>
      </div>

      {permission === 'granted' && (
        <div className="space-y-3">
          <div className="p-4 rounded-xl bg-glass-surface-medium border border-glass-border">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Messages</h4>
                <p className="text-sm text-text-tertiary">Notifications pour les nouveaux messages</p>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5" />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-glass-surface-medium border border-glass-border">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Groupes</h4>
                <p className="text-sm text-text-tertiary">Notifications pour les messages de groupe</p>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5" />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-glass-surface-medium border border-glass-border">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Appels</h4>
                <p className="text-sm text-text-tertiary">Notifications pour les appels entrants</p>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5" />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-glass-surface-medium border border-glass-border">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Son</h4>
                <p className="text-sm text-text-tertiary">Jouer un son pour les notifications</p>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5" />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-glass-surface-medium border border-glass-border">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Vibration</h4>
                <p className="text-sm text-text-tertiary">Vibrer pour les notifications</p>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};