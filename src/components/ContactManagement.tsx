// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState } from 'react';
import { Star, Ban, Trash2, MessageCircle, Phone, Video } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/i18n';

interface ContactManagementProps {
  contactId: string;
  contactUserId: string;
  username: string;
  displayName: string | null;
  isFavorite: boolean;
  isBlocked: boolean;
  onClose: () => void;
  onStartChat: () => void;
}

export const ContactManagement: React.FC<ContactManagementProps> = ({
  contactId,
  contactUserId,
  username,
  displayName,
  isFavorite,
  isBlocked,
  onClose,
  onStartChat,
}) => {
  const [favorite, setFavorite] = useState(isFavorite);
  const [blocked, setBlocked] = useState(isBlocked);
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);

  const handleToggleFavorite = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('contacts')
        .update({ is_favorite: !favorite })
        .eq('id', contactId);

      if (!error) {
        setFavorite(!favorite);
      }
    } catch (error) {
      console.error('Error toggling favorite:', error);
      alert(t('updateErrorShort'));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleBlock = async () => {
    if (!confirm(blocked ? t('unblockContactConfirm') : t('blockContactConfirm'))) {
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('contacts')
        .update({ is_blocked: !blocked })
        .eq('id', contactId);

      if (!error) {
        setBlocked(!blocked);
        alert(blocked ? t('contactUnblocked') : t('contactBlocked'));
      }
    } catch (error) {
      console.error('Error toggling block:', error);
      alert(t('updateErrorShort'));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteContact = async () => {
    if (!confirm(t('deleteContactConfirmShort'))) {
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('contacts')
        .delete()
        .eq('id', contactId);

      if (!error) {
        alert(t('contactDeleted'));
        onClose();
      }
    } catch (error) {
      console.error('Error deleting contact:', error);
      alert(t('deleteError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-glass-surface-light backdrop-blur-[30px] border border-glass-border rounded-2xl p-6 max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-4xl mb-4">
            {(displayName || username)[0].toUpperCase()}
          </div>
          <h2 className="text-2xl font-bold">{displayName || username}</h2>
          <p className="text-sm text-text-tertiary">@{username}</p>
          
          {/* Status badges */}
          <div className="flex items-center justify-center gap-2 mt-3">
            {favorite && (
              <span className="px-3 py-1 rounded-full bg-yellow-500/20 text-yellow-500 text-xs font-medium flex items-center gap-1">
                <Star size={12} fill="currentColor" />
                {t('favoriteBadge')}
              </span>
            )}
            {blocked && (
              <span className="px-3 py-1 rounded-full bg-red-500/20 text-red-500 text-xs font-medium flex items-center gap-1">
                <Ban size={12} />
                {t('blockedBadge')}
              </span>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        {!blocked && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <button
              onClick={onStartChat}
              className="flex flex-col items-center gap-2 p-4 rounded-xl bg-glass-surface-medium hover:bg-white/10 transition-colors"
            >
              <MessageCircle size={24} className="text-primary-500" />
              <span className="text-xs">{t('messageAction')}</span>
            </button>
            <button
              className="flex flex-col items-center gap-2 p-4 rounded-xl bg-glass-surface-medium hover:bg-white/10 transition-colors"
            >
              <Phone size={24} className="text-primary-500" />
              <span className="text-xs">{t('callAction')}</span>
            </button>
            <button
              className="flex flex-col items-center gap-2 p-4 rounded-xl bg-glass-surface-medium hover:bg-white/10 transition-colors"
            >
              <Video size={24} className="text-primary-500" />
              <span className="text-xs">{t('videoShort')}</span>
            </button>
          </div>
        )}

        {/* Management Actions */}
        <div className="space-y-3">
          <button
            onClick={handleToggleFavorite}
            disabled={loading || blocked}
            className="w-full py-3 rounded-xl bg-glass-surface-medium hover:bg-white/10 border border-glass-border transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Star size={20} className={favorite ? 'text-yellow-500' : 'text-text-tertiary'} fill={favorite ? 'currentColor' : 'none'} />
            {favorite ? t('removeFromFavorites') : t('addToFavorites')}
          </button>

          <button
            onClick={handleToggleBlock}
            disabled={loading}
            className={`w-full py-3 rounded-xl border transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${
              blocked
                ? 'bg-green-500/10 hover:bg-green-500/20 border-green-500/30 text-green-500'
                : 'bg-red-500/10 hover:bg-red-500/20 border-red-500/30 text-red-500'
            }`}
          >
            <Ban size={20} />
            {blocked ? t('unblockContact') : t('blockContact')}
          </button>

          <button
            onClick={handleDeleteContact}
            disabled={loading}
            className="w-full py-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Trash2 size={20} />
            {t('deleteContactAction')}
          </button>
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="w-full mt-4 py-3 rounded-xl bg-glass-surface-medium hover:bg-white/10 transition-colors"
        >
          {t('close')}
        </button>
      </div>
    </div>
  );
};