// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React from 'react';
import { Bell, BellOff, Check } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';

export const NotificationSettings: React.FC = () => {
  const { permission, isSupported, requestPermission } = useNotifications();

  const handleEnableNotifications = async () => {
    const granted = await requestPermission();
    if (granted) {
      alert('Notifications activées avec succès!');
    } else {
      alert('Permission refusée. Activez les notifications dans les paramètres de votre navigateur.');
    }
  };

  if (!isSupported) {
    return (
      <div className="p-4 rounded-xl bg-glass-surface-medium border border-glass-border">
        <div className="flex items-center gap-3">
          <BellOff size={24} className="text-text-tertiary" />
          <div className="flex-1">
            <h3 className="font-semibold">Notifications non supportées</h3>
            <p className="text-sm text-text-tertiary">Votre navigateur ne supporte pas les notifications</p>
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
              <h3 className="font-semibold">Notifications push</h3>
              <p className="text-sm text-text-tertiary">
                {(() => {
                  if (permission === 'granted') {
                    return 'Activées - Vous recevrez des notifications pour les nouveaux messages';
                  }
                  if (permission === 'denied') {
                    return 'Refusées - Activez-les dans les paramètres de votre navigateur';
                  }
                  return 'Désactivées - Activez pour recevoir des notifications';
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
                  Activer
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