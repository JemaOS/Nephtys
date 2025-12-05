// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState } from 'react';
import { Archive, ArchiveX, Pin, Trash2, Bell, BellOff, MoreVertical } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface ConversationActionsProps {
  conversationId: string;
  isArchived?: boolean;
  isPinned?: boolean;
  isMuted?: boolean;
  onUpdate?: () => void;
}

export const ConversationActions: React.FC<ConversationActionsProps> = ({
  conversationId,
  isArchived = false,
  isPinned = false,
  isMuted = false,
  onUpdate,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleArchive = async () => {
    setLoading(true);
    try {
      // Note: Nécessite d'ajouter la colonne is_archived à la table conversations
      const { error } = await supabase
        .from('conversations')
        .update({ is_archived: !isArchived })
        .eq('id', conversationId);

      if (!error) {
        alert(isArchived ? 'Conversation désarchivée' : 'Conversation archivée');
        onUpdate?.();
      }
    } catch (error) {
      console.error('Error archiving conversation:', error);
    } finally {
      setLoading(false);
      setIsOpen(false);
    }
  };

  const handlePin = async () => {
    setLoading(true);
    try {
      // Note: Nécessite d'ajouter la colonne is_pinned à la table conversations
      const { error } = await supabase
        .from('conversations')
        .update({ is_pinned: !isPinned })
        .eq('id', conversationId);

      if (!error) {
        alert(isPinned ? 'Conversation désépinglée' : 'Conversation épinglée');
        onUpdate?.();
      }
    } catch (error) {
      console.error('Error pinning conversation:', error);
    } finally {
      setLoading(false);
      setIsOpen(false);
    }
  };

  const handleMute = async () => {
    setLoading(true);
    try {
      // Note: Nécessite d'ajouter la colonne is_muted à la table conversation_members
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('conversation_members')
        .update({ is_muted: !isMuted })
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id);

      if (!error) {
        alert(isMuted ? 'Notifications activées' : 'Notifications désactivées');
        onUpdate?.();
      }
    } catch (error) {
      console.error('Error muting conversation:', error);
    } finally {
      setLoading(false);
      setIsOpen(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Supprimer cette conversation? Cette action est irréversible.')) {
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('conversations')
        .delete()
        .eq('id', conversationId);

      if (!error) {
        alert('Conversation supprimée');
        onUpdate?.();
      }
    } catch (error) {
      console.error('Error deleting conversation:', error);
      alert('Erreur lors de la suppression');
    } finally {
      setLoading(false);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-full hover:bg-white/10 transition-colors"
        aria-label="Actions de la conversation"
      >
        <MoreVertical size={20} className="text-text-tertiary" />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Menu */}
          <div className="absolute right-0 top-full mt-1 bg-bg-surface backdrop-blur-xl rounded-xl p-2 shadow-2xl border border-bg-hover z-50 min-w-[200px]">
            <button
              onClick={handlePin}
              disabled={loading}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-bg-hover rounded-lg transition-colors text-left disabled:opacity-50 text-text-primary"
            >
              <Pin size={16} className={isPinned ? 'text-primary-500' : 'text-text-tertiary'} fill={isPinned ? 'currentColor' : 'none'} />
              <span className="text-sm">{isPinned ? 'Désépingler' : 'Épingler'}</span>
            </button>

            <button
              onClick={handleArchive}
              disabled={loading}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-bg-hover rounded-lg transition-colors text-left disabled:opacity-50 text-text-primary"
            >
              {isArchived ? (
                <>
                  <ArchiveX size={16} className="text-text-tertiary" />
                  <span className="text-sm">Désarchiver</span>
                </>
              ) : (
                <>
                  <Archive size={16} className="text-text-tertiary" />
                  <span className="text-sm">Archiver</span>
                </>
              )}
            </button>

            <button
              onClick={handleMute}
              disabled={loading}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-bg-hover rounded-lg transition-colors text-left disabled:opacity-50 text-text-primary"
            >
              {isMuted ? (
                <>
                  <Bell size={16} className="text-text-tertiary" />
                  <span className="text-sm">Activer notifications</span>
                </>
              ) : (
                <>
                  <BellOff size={16} className="text-text-tertiary" />
                  <span className="text-sm">Désactiver notifications</span>
                </>
              )}
            </button>

            <div className="h-px bg-bg-hover my-2" />

            <button
              onClick={handleDelete}
              disabled={loading}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-red-500/20 rounded-lg transition-colors text-left disabled:opacity-50"
            >
              <Trash2 size={16} className="text-red-500" />
              <span className="text-sm text-red-500">Supprimer</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};