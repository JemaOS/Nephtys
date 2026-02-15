import React from 'react';
import {
  Lock, Edit2, Check, ChevronRight, Bell, BellOff, Archive,
  Trash2, UserPlus, Crown, Video, Image, FileText, Download, ExternalLink, Loader2, Timer, Link as LinkIcon
} from 'lucide-react';
import { Profile, Message } from '@/lib/supabase';
import { formatFileSize, formatDate, getEphemeralLabel } from './ConversationInfo';

// Re-export interfaces if needed, or define them here
export interface GroupMember {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  role: 'admin' | 'member';
}

interface OverviewTabProps {
  conversationType: 'direct' | 'group';
  isAdmin: boolean;
  isEditingDescription: boolean;
  newDescription: string;
  currentDescription: string;
  setNewDescription: (val: string) => void;
  setIsEditingDescription: (val: boolean) => void;
  handleUpdateDescription: () => void;
  ephemeralDuration: number | null;
  showEphemeralMenu: boolean;
  setShowEphemeralMenu: (val: boolean) => void;
  isMuted: boolean;
  handleToggleMute: () => void;
  handleArchive: () => void;
  handleDelete: () => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  conversationType,
  isAdmin,
  isEditingDescription,
  newDescription,
  currentDescription,
  setNewDescription,
  setIsEditingDescription,
  handleUpdateDescription,
  ephemeralDuration,
  showEphemeralMenu,
  setShowEphemeralMenu,
  isMuted,
  handleToggleMute,
  handleArchive,
  handleDelete,
}) => (
  <div className="p-4 space-y-2">
    {/* Description */}
    <div className="bg-bg-surface rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h4 className="text-sm font-medium text-text-primary mb-1">Description</h4>
          {isEditingDescription ? (
            <div className="space-y-3 mt-2">
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="w-full px-3 py-2 bg-bg-hover text-text-primary rounded-lg outline-none resize-none text-sm"
                rows={3}
                placeholder="Ajouter une description..."
              />
              <button
                onClick={handleUpdateDescription}
                className="w-full py-2 bg-accent hover:bg-[#5a5ec9] text-white rounded-lg text-sm font-medium transition-colors"
              >
                Enregistrer
              </button>
            </div>
          ) : (
            <p className="text-sm text-text-secondary">
              {currentDescription || 'Aucune description'}
            </p>
          )}
        </div>
        {(conversationType === 'group' ? isAdmin : true) && !isEditingDescription && (
          <button
            onClick={() => setIsEditingDescription(!isEditingDescription)}
            className="text-accent hover:text-accent/80 transition-colors ml-3"
          >
            <Edit2 size={18} />
          </button>
        )}
      </div>
    </div>

    {/* Chiffrement */}
    <div className="bg-bg-surface rounded-xl p-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
          <Lock size={20} className="text-accent" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-medium text-text-primary">Chiffrement</h4>
          <p className="text-xs text-text-secondary">Messages chiffrés de bout en bout</p>
        </div>
        <Check size={18} className="text-accent" />
      </div>
    </div>

    {/* Messages éphémères */}
    <div
      onClick={() => setShowEphemeralMenu(!showEphemeralMenu)}
      className="bg-bg-surface rounded-xl p-4 cursor-pointer hover:bg-bg-hover transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${ephemeralDuration ? 'bg-accent/20' : 'bg-bg-hover'}`}>
          <Timer size={20} className={ephemeralDuration ? 'text-accent' : 'text-text-secondary'} />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-medium text-text-primary">Messages éphémères</h4>
          <p className={`text-xs ${ephemeralDuration ? 'text-accent' : 'text-text-secondary'}`}>
            {getEphemeralLabel(ephemeralDuration)}
          </p>
        </div>
        <ChevronRight size={18} className="text-text-secondary" />
      </div>
    </div>

    {/* Notifications */}
    <div
      onClick={handleToggleMute}
      className="bg-bg-surface rounded-xl p-4 cursor-pointer hover:bg-bg-hover transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-bg-hover flex items-center justify-center">
          {isMuted ? <BellOff size={20} className="text-text-secondary" /> : <Bell size={20} className="text-text-secondary" />}
        </div>
        <span className="text-sm text-text-primary flex-1">
          {isMuted ? 'Activer les notifications' : 'Désactiver les notifications'}
        </span>
      </div>
    </div>

    {/* Archiver */}
    <div
      onClick={handleArchive}
      className="bg-bg-surface rounded-xl p-4 cursor-pointer hover:bg-bg-hover transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-bg-hover flex items-center justify-center">
          <Archive size={20} className="text-text-secondary" />
        </div>
        <span className="text-sm text-text-primary">Archiver la conversation</span>
      </div>
    </div>

    {/* Supprimer */}
    <div
      onClick={handleDelete}
      className="bg-bg-surface rounded-xl p-4 cursor-pointer hover:bg-red-500/10 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
          <Trash2 size={20} className="text-red-500" />
        </div>
        <span className="text-sm text-red-500">Supprimer la conversation</span>
      </div>
    </div>
  </div>
);

interface MembersTabProps {
  conversationType: 'direct' | 'group';
  isAdmin: boolean;
  handleOpenAddMemberModal: () => void;
  members: GroupMember[];
  currentUserId: string;
  directParticipants: {user: Profile, isCurrentUser: boolean}[];
}

export const MembersTab: React.FC<MembersTabProps> = ({
  conversationType,
  isAdmin,
  handleOpenAddMemberModal,
  members,
  currentUserId,
  directParticipants,
}) => (
  <div className="p-4 space-y-2">
    {conversationType === 'group' && (
      <>
        {isAdmin && (
          <button
            onClick={handleOpenAddMemberModal}
            className="w-full bg-bg-surface rounded-xl p-4 flex items-center gap-3 hover:bg-bg-hover transition-colors mb-4"
          >
            <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
              <UserPlus size={20} className="text-accent" />
            </div>
            <span className="text-sm text-text-primary">Ajouter des membres</span>
          </button>
        )}
        
        {members.map((member) => (
          <div
            key={member.id}
            className="bg-bg-surface rounded-xl p-4 flex items-center gap-3"
          >
            {member.avatar_url ? (
              <img
                src={member.avatar_url}
                alt={member.display_name || member.username}
                className="w-12 h-12 rounded-full object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold">
                {(member.display_name || member.username)[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <div className="font-medium text-text-primary">
                {member.display_name || member.username}
                {member.user_id === currentUserId && ' (Vous)'}
              </div>
              {member.role === 'admin' && (
                <div className="flex items-center gap-1 text-xs text-accent">
                  <Crown size={12} />
                  <span>Administrateur</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </>
    )}

    {conversationType === 'direct' && (
      <>
        <p className="text-xs text-text-secondary mb-3 px-1">2 participants</p>
        {directParticipants.map((participant) => (
          <div
            key={participant.user.id}
            className="bg-bg-surface rounded-xl p-4 flex items-center gap-3"
          >
            {participant.user.avatar_url ? (
              <img
                src={participant.user.avatar_url}
                alt={participant.user.display_name || participant.user.username}
                className="w-12 h-12 rounded-full object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold">
                {(participant.user.display_name || participant.user.username)[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <div className="font-medium text-text-primary">
                {participant.user.display_name || participant.user.username}
                {participant.isCurrentUser && ' (Vous)'}
              </div>
              <p className="text-xs text-text-secondary">@{participant.user.username}</p>
            </div>
          </div>
        ))}
      </>
    )}
  </div>
);

interface MediaTabProps {
  loadingMedia: boolean;
  mediaMessages: Message[];
  setSelectedMedia: (media: Message) => void;
  setIsMediaViewerOpen: (val: boolean) => void;
}

export const MediaTab: React.FC<MediaTabProps> = ({
  loadingMedia,
  mediaMessages,
  setSelectedMedia,
  setIsMediaViewerOpen,
}) => {
  if (loadingMedia) {
    return (
      <div className="text-center py-12">
        <Loader2 size={32} className="mx-auto mb-2 animate-spin text-accent" />
        <p className="text-sm text-text-secondary">Chargement des médias...</p>
      </div>
    );
  }

  if (mediaMessages.length === 0) {
    return (
      <div className="text-center py-12 text-text-secondary">
        <Image size={48} className="mx-auto mb-2 opacity-50" />
        <p className="text-sm">Aucun média partagé</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {mediaMessages.map((media) => (
        <div
          key={media.id}
          onClick={() => {
            setSelectedMedia(media);
            setIsMediaViewerOpen(true);
          }}
          className="aspect-square rounded-lg overflow-hidden bg-bg-hover hover:opacity-80 transition-opacity cursor-pointer relative group"
        >
          {(media.type === 'video' || media.media_type === 'video') ? (
            <>
              <video
                src={`${media.media_url || media.file_url}#t=0.1`}
                className="w-full h-full object-cover"
                muted
                preload="metadata"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
                <Video size={32} className="text-white drop-shadow-lg" />
              </div>
            </>
          ) : (
            <img
              src={media.media_url || media.file_url || ''}
              alt="Media"
              className="w-full h-full object-cover"
            />
          )}
        </div>
      ))}
    </div>
  );
};

interface FilesTabProps {
  loadingFiles: boolean;
  fileMessages: Message[];
}

export const FilesTab: React.FC<FilesTabProps> = ({
  loadingFiles,
  fileMessages,
}) => {
  if (loadingFiles) {
    return (
      <div className="text-center py-12">
        <Loader2 size={32} className="mx-auto mb-2 animate-spin text-accent" />
        <p className="text-sm text-text-secondary">Chargement des fichiers...</p>
      </div>
    );
  }

  if (fileMessages.length === 0) {
    return (
      <div className="text-center py-12 text-text-secondary">
        <FileText size={48} className="mx-auto mb-2 opacity-50" />
        <p className="text-sm">Aucun fichier partagé</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {fileMessages.map((file) => (
        <div
          key={file.id}
          className="bg-bg-surface rounded-xl p-3 flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
            <FileText size={20} className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">
              {file.file_name || 'Fichier'}
            </p>
            <p className="text-xs text-text-secondary">
              {formatFileSize(file.file_size)} • {formatDate(file.created_at)}
            </p>
          </div>
          <a
            href={file.media_url || file.file_url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="w-8 h-8 rounded-full bg-bg-hover flex items-center justify-center hover:bg-accent/20 transition-colors"
          >
            <Download size={16} className="text-text-secondary" />
          </a>
        </div>
      ))}
    </div>
  );
};

interface LinksTabProps {
  loadingLinks: boolean;
  linkMessages: {message: Message, urls: string[]}[];
}

export const LinksTab: React.FC<LinksTabProps> = ({
  loadingLinks,
  linkMessages,
}) => {
  if (loadingLinks) {
    return (
      <div className="text-center py-12">
        <Loader2 size={32} className="mx-auto mb-2 animate-spin text-accent" />
        <p className="text-sm text-text-secondary">Chargement des liens...</p>
      </div>
    );
  }

  if (linkMessages.length === 0) {
    return (
      <div className="text-center py-12 text-text-secondary">
        <LinkIcon size={48} className="mx-auto mb-2 opacity-50" />
        <p className="text-sm">Aucun lien partagé</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {linkMessages.map(({ message, urls }) => (
        <div
          key={message.id}
          className="bg-bg-surface rounded-xl p-3"
        >
          <p className="text-xs text-text-secondary mb-2">
            {formatDate(message.created_at)}
          </p>
          {urls.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-accent hover:underline text-sm mb-1"
            >
              <ExternalLink size={14} />
              <span className="truncate">{url}</span>
            </a>
          ))}
          {message.content && (
            <p className="text-xs text-text-secondary mt-2 line-clamp-2">
              {message.content}
            </p>
          )}
        </div>
      ))}
    </div>
  );
};
