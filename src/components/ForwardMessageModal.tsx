// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useEffect, useState } from 'react';
import { X, Search, Check } from 'lucide-react';
import { supabase, Conversation, Profile } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { signFieldsBatch } from '@/lib/mediaUrl';
import { MediaImg } from './MediaImg';

interface ConversationWithDetails extends Conversation {
  otherUser?: Profile;
  memberNames?: string[];
}

interface ForwardMessageModalProps {
  isOpen: boolean;
  messageContent: string;
  messageType: 'text' | 'image' | 'video' | 'file' | 'audio';
  mediaUrl?: string;
  onClose: () => void;
  onForward: (conversationIds: string[]) => void;
}

export const ForwardMessageModal: React.FC<ForwardMessageModalProps> = ({
  isOpen,
  messageContent,
  messageType,
  mediaUrl,
  onClose,
  onForward,
}) => {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedConversations, setSelectedConversations] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && user) {
      loadConversations();
    }
  }, [isOpen, user]);

  const loadConversations = async () => {
    if (!user) return;
    setLoading(true);

    try {
      // 1) Toutes les conversations dont l'utilisateur est membre actif
      const { data: memberData, error: memberError } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (memberError) {
        console.error('[ForwardModal] members error:', memberError);
      }

      if (!memberData || memberData.length === 0) {
        setConversations([]);
        setLoading(false);
        return;
      }

      const conversationIds = memberData.map(m => m.conversation_id);

      // 2) Détails des conversations
      const { data: conversationsData, error: convError } = await supabase
        .from('conversations')
        .select('*')
        .in('id', conversationIds)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (convError) {
        console.error('[ForwardModal] conversations error:', convError);
      }

      if (!conversationsData || conversationsData.length === 0) {
        setConversations([]);
        setLoading(false);
        return;
      }

      // 3) Pour chaque conv, charger les profils des autres membres
      const conversationsWithDetails = await Promise.all(
        conversationsData.map(async (conv) => {
          if (conv.type === 'direct') {
            const { data: members } = await supabase
              .from('conversation_members')
              .select('user_id')
              .eq('conversation_id', conv.id)
              .neq('user_id', user.id);

            if (members && members.length > 0) {
              const { data: otherUserData } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', members[0].user_id)
                .maybeSingle();

              return { ...conv, otherUser: otherUserData || undefined };
            }
            // Conversation directe avec soi-même (Saved Messages)
            return conv;
          }

          // Conversation de groupe
          const { data: members } = await supabase
            .from('conversation_members')
            .select('user_id')
            .eq('conversation_id', conv.id);

          if (members && members.length > 0) {
            const memberIds = members.map(m => m.user_id);
            const { data: profiles } = await supabase
              .from('profiles')
              .select('display_name, username')
              .in('id', memberIds);

            const memberNames = profiles?.map(p => p.display_name || p.username) || [];
            return { ...conv, memberNames };
          }
          return conv;
        })
      );

      // 4) Pas de filtre par contacts : on liste toutes les conversations actives.
      // 5) Signer les avatars (bucket privé)
      await signFieldsBatch(conversationsWithDetails as any[], ['avatar_url']);
      const otherUsers = conversationsWithDetails
        .map(c => c.otherUser)
        .filter(Boolean) as Profile[];
      await signFieldsBatch(otherUsers as any[], ['avatar_url']);

      setConversations(conversationsWithDetails);
    } catch (error) {
      console.error('[ForwardModal] Error loading conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleConversation = (conversationId: string) => {
    setSelectedConversations(prev => {
      const newSet = new Set(prev);
      if (newSet.has(conversationId)) {
        newSet.delete(conversationId);
      } else {
        newSet.add(conversationId);
      }
      return newSet;
    });
  };

  const handleForward = () => {
    if (selectedConversations.size > 0) {
      onForward(Array.from(selectedConversations));
      setSelectedConversations(new Set());
      onClose();
    }
  };

  const getConversationName = (conv: ConversationWithDetails): string => {
    if (conv.type === 'direct' && conv.otherUser) {
      return conv.otherUser.display_name || conv.otherUser.username || 'Utilisateur';
    }
    return conv.name || 'Groupe';
  };

  const getConversationSubtitle = (conv: ConversationWithDetails): string => {
    if (conv.type === 'direct' && conv.otherUser) {
      return 'Envoyez-vous un message';
    }
    if (conv.memberNames && conv.memberNames.length > 0) {
      return conv.memberNames.slice(0, 4).join(', ') + (conv.memberNames.length > 4 ? '...' : '');
    }
    return '';
  };

  const getAvatarUrl = (conv: ConversationWithDetails): string | null => {
    if (conv.type === 'direct' && conv.otherUser?.avatar_url) {
      return conv.otherUser.avatar_url;
    }
    return conv.avatar_url || null;
  };

  const getInitial = (conv: ConversationWithDetails): string => {
    const name = getConversationName(conv);
    return name[0]?.toUpperCase() || '?';
  };

  // Render conversations list based on loading and empty states
  const renderConversationsList = () => {
    if (loading) {
      return (
        <div className="flex justify-center items-center py-8">
          <div className="w-8 h-8 rounded-full border-4 border-accent border-t-transparent animate-spin" />
        </div>
      );
    }

    if (filteredConversations.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-8 text-center px-4">
          <p className="text-text-secondary">Aucune conversation trouvée</p>
        </div>
      );
    }

    return filteredConversations.map((conv) => {
      const isSelected = selectedConversations.has(conv.id);
      const avatarUrl = getAvatarUrl(conv);

      return (
        <button
          key={conv.id}
          onClick={() => toggleConversation(conv.id)}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors"
        >
          {/* Checkbox */}
          <div
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              isSelected
                ? 'bg-accent border-accent'
                : 'border-text-tertiary'
            }`}
          >
            {isSelected && <Check size={14} className="text-white" />}
          </div>

          {/* Avatar */}
          <MediaImg
            src={avatarUrl}
            alt={getConversationName(conv)}
            className="w-12 h-12 rounded-full object-cover"
            fallback={
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent/80 to-accent flex items-center justify-center text-white font-semibold text-lg">
                {getInitial(conv)}
              </div>
            }
          />

          {/* Info */}
          <div className="flex-1 min-w-0 text-left">
            <h3 className="text-text-primary font-normal truncate">
              {getConversationName(conv)}
            </h3>
            <p className="text-sm text-text-tertiary truncate">
              {getConversationSubtitle(conv)}
            </p>
          </div>
        </button>
      );
    });
  };

  const filteredConversations = conversations.filter(conv => {
    const name = getConversationName(conv).toLowerCase();
    const subtitle = getConversationSubtitle(conv).toLowerCase();
    const query = searchQuery.toLowerCase();
    return name.includes(query) || subtitle.includes(query);
  });

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[250] border-none cursor-default"
        onClick={() => onClose()}
        aria-label="Fermer le modal"
      />
      <div className="fixed inset-0 z-[250] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-bg-surface rounded-2xl shadow-2xl overflow-hidden max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center gap-4 px-4 py-3 border-b border-bg-hover">
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-text-secondary"
            >
              <X size={20} />
            </button>
            <h2 className="text-lg font-medium text-text-primary flex-1">Transférer le message à</h2>
          </div>

          {/* Search Bar */}
          <div className="px-4 py-3">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                type="text"
                placeholder="Rechercher un nom ou un numéro"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-10 pl-10 pr-4 bg-bg-hover text-text-primary text-sm rounded-xl border border-accent/50 focus:border-accent outline-none placeholder:text-text-tertiary transition-colors"
              />
            </div>
          </div>

          {/* Section Title */}
          <div className="px-4 py-2">
            <span className="text-sm text-text-tertiary">Discussions récentes</span>
          </div>

          {/* Conversations List */}
          <div className="flex-1 overflow-y-auto">
            {renderConversationsList()}
          </div>

          {/* Footer with Forward Button */}
          {selectedConversations.size > 0 && (
            <div className="px-4 py-3 border-t border-bg-hover">
              <button
                onClick={handleForward}
                className="w-full py-3 rounded-xl bg-accent hover:bg-accent/90 text-white font-medium transition-colors flex items-center justify-center gap-2"
              >
                Transférer à {selectedConversations.size} conversation{selectedConversations.size > 1 ? 's' : ''}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};