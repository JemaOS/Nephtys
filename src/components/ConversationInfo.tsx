// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useEffect } from 'react';
import {
  X, Camera, Video, Phone,
} from 'lucide-react';
import { supabase, Profile, Message } from '@/lib/supabase';
import { MediaViewer } from './MediaViewer';
import { OverviewTab, MembersTab, MediaTab, FilesTab, LinksTab } from './ConversationInfoTabs';
import { AddMemberModal } from './AddMemberModal';
import { EphemeralDurationMenu } from './EphemeralDurationMenu';

// Helper functions at module level to reduce component complexity

// Format file size helper
export const formatFileSize = (bytes: number | null): string => {
  if (!bytes) return 'Taille inconnue';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Format date helper
export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
};

// Get ephemeral label helper
export const getEphemeralLabel = (duration: number | null): string => {
  if (!duration) return 'Désactivés';
  if (duration === 3600) return '1 heure';
  if (duration === 86400) return '24 heures';
  if (duration === 604800) return '7 jours';
  if (duration === 7776000) return '90 jours';
  return `${Math.floor(duration / 86400)} jours`;
};

// Build ephemeral system message helper
const buildEphemeralSystemMessage = (duration: number | null): string | null => {
  if (duration) {
    return `[SYSTEM]Vous avez mis à jour le délai avant disparition. Les nouveaux messages disparaîtront de cette discussion ${getEphemeralLabel(duration)} après avoir été envoyés, sauf s'ils sont gardés.`;
  }
  return '[SYSTEM]Vous avez désactivé les messages éphémères.';
};

interface ConversationInfoProps {
  conversationId: string;
  conversationType: 'direct' | 'group';
  conversationName: string;
  conversationDescription?: string | null;
  conversationAvatar?: string | null;
  otherUser?: Profile | null;
  currentUserId: string;
  isAdmin?: boolean;
  onClose: () => void;
  onStartVideoCall?: () => void;
  onStartAudioCall?: () => void;
  initialTab?: 'overview' | 'members' | 'media' | 'files' | 'links';
  openAddMemberModal?: boolean;
  onSystemMessage?: (message: Message) => void;
}

interface GroupMember {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  role: 'admin' | 'member';
}

export const ConversationInfo: React.FC<ConversationInfoProps> = ({
  conversationId,
  conversationType,
  conversationName,
  conversationDescription,
  conversationAvatar,
  otherUser,
  currentUserId,
  isAdmin = false,
  onClose,
  onStartVideoCall,
  onStartAudioCall,
  initialTab = 'overview',
  openAddMemberModal = false,
  onSystemMessage,
}) => {
  // Initialize state
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'media' | 'files' | 'links'>(initialTab);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [newDescription, setNewDescription] = useState(conversationDescription || '');
  const [currentDescription, setCurrentDescription] = useState(conversationDescription || '');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [ephemeralDuration, setEphemeralDuration] = useState<number | null>(null);
  const [showEphemeralMenu, setShowEphemeralMenu] = useState(false);
  const [currentAvatar, setCurrentAvatar] = useState(
    conversationType === 'direct' && otherUser?.avatar_url
      ? otherUser.avatar_url
      : conversationAvatar
  );
  
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  
  const [mediaMessages, setMediaMessages] = useState<Message[]>([]);
  const [fileMessages, setFileMessages] = useState<Message[]>([]);
  const [linkMessages, setLinkMessages] = useState<{message: Message, urls: string[]}[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingLinks, setLoadingLinks] = useState(false);

  const [directParticipants, setDirectParticipants] = useState<{user: Profile, isCurrentUser: boolean}[]>([]);

  // Media Viewer State
  const [selectedMedia, setSelectedMedia] = useState<Message | null>(null);
  const [isMediaViewerOpen, setIsMediaViewerOpen] = useState(false);

  // Helper to determine if initial data load is needed
  const shouldLoadMembers = conversationType === 'group';
  const shouldLoadDirectParticipants = conversationType === 'direct';

  // Load initial conversation data
  useEffect(() => {
    if (shouldLoadMembers) {
      loadMembers();
    } else if (shouldLoadDirectParticipants) {
      loadDirectParticipants();
    }
    loadMuteStatus();
    loadEphemeralSetting();
    
    if (conversationType === 'direct' && otherUser?.avatar_url) {
      setCurrentAvatar(otherUser.avatar_url);
    }
  }, [conversationId, otherUser?.avatar_url, conversationType, shouldLoadMembers, shouldLoadDirectParticipants]);

  useEffect(() => {
    if (openAddMemberModal && conversationType === 'group' && isAdmin) {
      handleOpenAddMemberModal();
    }
  }, [openAddMemberModal, conversationType, isAdmin]);

  const loadDirectParticipants = async () => {
    try {
      const { data: currentUserProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUserId)
        .single();

      const participants: {user: Profile, isCurrentUser: boolean}[] = [];
      
      if (currentUserProfile) {
        participants.push({ user: currentUserProfile, isCurrentUser: true });
      }
      
      if (otherUser) {
        participants.push({ user: otherUser, isCurrentUser: false });
      }
      
      setDirectParticipants(participants);
    } catch (err) {
      console.error('Error loading direct participants:', err);
    }
  };

  useEffect(() => {
    if (activeTab === 'media' && mediaMessages.length === 0) {
      loadMedia();
    } else if (activeTab === 'files' && fileMessages.length === 0) {
      loadFiles();
    } else if (activeTab === 'links' && linkMessages.length === 0) {
      loadLinks();
    }
  }, [activeTab, conversationId]);

  const loadMembers = async () => {
    const { data: memberData } = await supabase
      .from('conversation_members')
      .select('id, user_id, role')
      .eq('conversation_id', conversationId);

    if (memberData) {
      const enrichedMembers = await Promise.all(
        memberData.map(async (member) => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('username, display_name, avatar_url')
            .eq('id', member.user_id)
            .single();

          return {
            ...member,
            username: profile?.username || 'Unknown',
            display_name: profile?.display_name || null,
            avatar_url: profile?.avatar_url || null,
          };
        })
      );
      setMembers(enrichedMembers);
    }
  };

  const loadMuteStatus = async () => {
    const { data } = await supabase
      .from('conversation_members')
      .select('is_muted')
      .eq('conversation_id', conversationId)
      .eq('user_id', currentUserId)
      .single();
    
    if (data) {
      setIsMuted(data.is_muted || false);
    }
  };

  const loadEphemeralSetting = async () => {
    // Load ephemeral setting from localStorage since the database doesn't have this column
    const storedSetting = localStorage.getItem(`ephemeral_${conversationId}`);
    if (storedSetting) {
      setEphemeralDuration(JSON.parse(storedSetting));
    }
  };


  const handleSetEphemeralDuration = async (duration: number | null) => {
    // Store ephemeral setting in localStorage
    if (duration === null) {
      localStorage.removeItem(`ephemeral_${conversationId}`);
    } else {
      localStorage.setItem(`ephemeral_${conversationId}`, JSON.stringify(duration));
    }
    
    setEphemeralDuration(duration);
    setShowEphemeralMenu(false);
    
    // Send a system message to notify about ephemeral mode change
    const systemMessageContent = buildEphemeralSystemMessage(duration);
    
    try {
      const { data, error } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: currentUserId,
        content: systemMessageContent,
        type: 'text',
        status: 'sent',
      }).select();
      
      if (error) {
        console.error('Error inserting system message:', error);
      } else {
      if (data?.[0] && onSystemMessage) {
        onSystemMessage(data[0] as Message);
      }
        // Update conversation's last_message_at
        await supabase
          .from('conversations')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', conversationId);
      }
    } catch (err) {
      console.error('Error sending system message:', err);
    }
  };

  const handleOpenAddMemberModal = () => {
    setShowAddMemberModal(true);
  };

  const loadMedia = async () => {
    setLoadingMedia(true);
    try {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .or('type.eq.image,type.eq.video,media_type.eq.image,media_type.eq.video')
        .is('deleted_at', null) // Exclude deleted messages
        .order('created_at', { ascending: false });
      
      setMediaMessages(data || []);
    } catch (err) {
      console.error('Error loading media:', err);
    } finally {
      setLoadingMedia(false);
    }
  };

  const loadFiles = async () => {
    setLoadingFiles(true);
    try {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .or('type.eq.file,media_type.eq.file')
        .is('deleted_at', null) // Exclude deleted messages
        .order('created_at', { ascending: false });
      
      setFileMessages(data || []);
    } catch (err) {
      console.error('Error loading files:', err);
    } finally {
      setLoadingFiles(false);
    }
  };

  const loadLinks = async () => {
    setLoadingLinks(true);
    try {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('type', 'text')
        .is('deleted_at', null) // Exclude deleted messages
        .order('created_at', { ascending: false });
      
      if (data) {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const messagesWithLinks = data
          .map(message => {
            // Remove GIF and Sticker markdown before extracting links
            // Pattern: [GIF](url) or [STICKER](url)
            const cleanContent = message.content?.replaceAll(/\[(GIF|STICKER)\]\([^)]+\)/g, '') || '';
            const urls = cleanContent.match(urlRegex) || [];
            return { message, urls };
          })
          .filter(item => item.urls.length > 0);
        
        setLinkMessages(messagesWithLinks);
      }
    } catch (err) {
      console.error('Error loading links:', err);
    } finally {
      setLoadingLinks(false);
    }
  };

  const handleUploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (conversationType === 'group' && !isAdmin) {
      alert('Seuls les administrateurs peuvent changer la photo du groupe');
      return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
      alert('❌ Fichier trop volumineux\n\nLa photo doit faire moins de 5 MB.');
      return;
    }
    
    if (!file.type.startsWith('image/')) {
      alert('❌ Format invalide\n\nVeuillez sélectionner une image.');
      return;
    }
    
    setUploadingPhoto(true);
    try {
      const fileExt = file.name.split('.').pop();
      const folder = conversationType === 'group' ? 'groups' : 'avatars';
      const fileName = `${folder}/${conversationId}/avatar-${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(fileName, file, { cacheControl: '3600', upsert: true });
      
      if (uploadError) throw uploadError;
      
      // On stocke le path nu en base ; l'URL signée est générée à la volée
      const { error: updateError } = await supabase
        .from('conversations')
        .update({ avatar_url: fileName })
        .eq('id', conversationId);
      
      if (updateError) throw updateError;
      
      setCurrentAvatar(fileName);
      alert('✅ Photo mise à jour !');
      globalThis.location.reload();
    } catch (err) {
      console.error('Photo upload error:', err);
      alert('❌ Erreur lors de l\'upload de la photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleUpdateDescription = async () => {
    if (!isAdmin && conversationType === 'group') {
      alert('Seuls les administrateurs peuvent modifier la description');
      return;
    }

    try {
      const trimmedDescription = newDescription.trim() || null;
      const { error } = await supabase
        .from('conversations')
        .update({ description: trimmedDescription })
        .eq('id', conversationId);

      if (error) {
        console.error('Error updating description:', error);
        alert('❌ Erreur lors de la mise à jour: ' + error.message);
        return;
      }

      // Update local state to reflect the change
      setCurrentDescription(trimmedDescription || '');
      setIsEditingDescription(false);
      alert('✅ Description mise à jour !');
    } catch (err) {
      console.error('Error updating description:', err);
      alert('❌ Erreur lors de la mise à jour');
    }
  };

  const handleToggleMute = async () => {
    const { error } = await supabase
      .from('conversation_members')
      .update({ is_muted: !isMuted })
      .eq('conversation_id', conversationId)
      .eq('user_id', currentUserId);

    if (!error) {
      setIsMuted(!isMuted);
    }
  };

  const handleArchive = async () => {
    const { error } = await supabase
      .from('conversation_members')
      .update({ is_archived: true })
      .eq('conversation_id', conversationId)
      .eq('user_id', currentUserId);

    if (!error) {
      alert('✅ Conversation archivée');
      onClose();
    }
  };

  const handleDelete = async () => {
    if (!confirm('Voulez-vous vraiment supprimer cette conversation ?')) return;

    const { error } = await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('user_id', currentUserId);

    if (!error) {
      alert('✅ Conversation supprimée');
      onClose();
      globalThis.location.href = '/chats';
    }
  };

  // Render tab content - extracted to avoid duplication
  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <OverviewTab
            conversationType={conversationType}
            isAdmin={isAdmin}
            isEditingDescription={isEditingDescription}
            newDescription={newDescription}
            currentDescription={currentDescription}
            setNewDescription={setNewDescription}
            setIsEditingDescription={setIsEditingDescription}
            handleUpdateDescription={handleUpdateDescription}
            ephemeralDuration={ephemeralDuration}
            showEphemeralMenu={showEphemeralMenu}
            setShowEphemeralMenu={setShowEphemeralMenu}
            isMuted={isMuted}
            handleToggleMute={handleToggleMute}
            handleArchive={handleArchive}
            handleDelete={handleDelete}
          />
        );
      case 'members':
        return (
          <MembersTab
            conversationType={conversationType}
            isAdmin={isAdmin}
            handleOpenAddMemberModal={handleOpenAddMemberModal}
            members={members}
            currentUserId={currentUserId}
            directParticipants={directParticipants}
          />
        );
      case 'media':
        return (
          <MediaTab
            loadingMedia={loadingMedia}
            mediaMessages={mediaMessages}
            setSelectedMedia={setSelectedMedia}
            setIsMediaViewerOpen={setIsMediaViewerOpen}
          />
        );
      case 'files':
        return (
          <FilesTab
            loadingFiles={loadingFiles}
            fileMessages={fileMessages}
          />
        );
      case 'links':
        return (
          <LinksTab
            loadingLinks={loadingLinks}
            linkMessages={linkMessages}
          />
        );
      default:
        return null;
    }
  };

  // Helper to get sender name from message
  const getSenderName = (senderId: string): string => {
    const participant = conversationType === 'group' 
      ? members.find(m => m.user_id === senderId) 
      : directParticipants.find(p => p.user.id === senderId)
    
    if (participant) {
      return 'display_name' in participant 
        ? (participant.display_name || participant.username || 'Utilisateur')
        : (participant.user.display_name || participant.user.username || 'Utilisateur')
    }
    return 'Utilisateur'
  };

  // Helper to get sender avatar from message
  const getSenderAvatar = (senderId: string): string | undefined => {
    const participant = conversationType === 'group' 
      ? members.find(m => m.user_id === senderId)
      : directParticipants.find(p => p.user.id === senderId)
    
    if (participant) {
      return 'avatar_url' in participant 
        ? participant.avatar_url 
        : participant.user.avatar_url
    }
    return undefined
  };

  // Helper to get participant count text
  const getParticipantCountText = (): string => {
    if (conversationType === 'group') {
      return `Groupe • ${members.length} membres`;
    }
    return '';
  };

  // Helper to get direct conversation subtitle
  const getDirectConversationSubtitle = (): string | null => {
    if (conversationType === 'direct' && otherUser) {
      return `@${otherUser.username}`;
    }
    return null;
  };

  // Transform media messages for MediaViewer
  const getMediaViewerItems = () => mediaMessages.map(m => {
    const isVideo = m.type === 'video' || m.media_type === 'video';
    return {
      url: m.media_url || m.file_url || '',
      type: isVideo ? 'video' as const : 'image' as const,
      senderName: getSenderName(m.sender_id),
      senderAvatar: getSenderAvatar(m.sender_id),
      timestamp: m.created_at,
      isOwn: m.sender_id === currentUserId,
      messageId: m.id
    };
  });

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-bg-surface w-full max-w-6xl rounded-2xl max-h-[90vh] flex flex-col md:flex-row overflow-hidden shadow-2xl">
        {/* Left Column - Avatar & Actions */}
        <div className="md:w-80 bg-bg-surface border-b md:border-b-0 md:border-r border-bg-hover flex-shrink-0 flex flex-col max-h-[90vh] md:max-h-none overflow-hidden">
          {/* Header - Mobile only */}
          <div className="md:hidden bg-bg-surface px-4 py-3 flex items-center justify-between border-b border-bg-hover flex-shrink-0">
            <h2 className="text-lg font-medium text-text-primary">Informations</h2>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors"
            >
              <X size={20} className="text-text-secondary" />
            </button>
          </div>

          {/* Scrollable content on mobile */}
          <div className="flex-1 overflow-y-auto">
            {/* Avatar & Name */}
            <div className="px-6 py-4 text-center">
              <div className="relative inline-block mb-3">
                {currentAvatar ? (
                  <img
                    src={currentAvatar}
                    alt={conversationName}
                    className="w-32 h-32 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-32 h-32 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-5xl">
                    {conversationName[0]?.toUpperCase()}
                  </div>
                )}
                {/* Only show camera button for groups where user is admin - not for direct conversations */}
                {conversationType === 'group' && isAdmin && (
                  <label className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-accent flex items-center justify-center cursor-pointer hover:bg-[#5a5ec9] transition-colors shadow-lg">
                    <Camera size={20} className="text-white" />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleUploadPhoto}
                      className="hidden"
                      disabled={uploadingPhoto}
                    />
                  </label>
                )}
              </div>
              <h3 className="text-2xl font-semibold text-text-primary mb-1">{conversationName}</h3>
              {conversationType === 'group' && (
                <p className="text-sm text-text-secondary">{getParticipantCountText()}</p>
              )}
              {conversationType === 'direct' && otherUser && (
                <p className="text-sm text-text-secondary">{getDirectConversationSubtitle()}</p>
              )}
            </div>

            {/* Quick Actions */}
            <div className="px-4 py-3 flex gap-3 justify-center border-b border-bg-hover">
              <button
                onClick={onStartVideoCall}
                className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-bg-hover transition-colors"
              >
                <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center">
                  <Video size={20} className="text-white" />
                </div>
                <span className="text-xs text-text-secondary">Vidéo</span>
              </button>
              <button
                onClick={onStartAudioCall}
                className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-bg-hover transition-colors"
              >
                <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center">
                  <Phone size={20} className="text-white" />
                </div>
                <span className="text-xs text-text-secondary">Vocal</span>
              </button>
            </div>

            {/* Tabs */}
            <div className="px-4 py-3 space-y-1">
              {['overview', 'members', 'media', 'files', 'links'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab as any)}
                  className={`w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                    activeTab === tab
                      ? 'bg-accent text-white'
                      : 'text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  {(() => {
                    switch (tab) {
                      case 'overview': return 'Vue d\'ensemble';
                      case 'members': return 'Membres';
                      case 'media': return 'Médias';
                      case 'files': return 'Fichiers';
                      case 'links': return 'Liens';
                      default: return '';
                    }
                  })()}
                </button>
              ))}
            </div>

            {/* Mobile Content - Show content below tabs on mobile */}
            <div className="md:hidden bg-bg-primary">
              {renderTabContent()}
            </div>
          </div>
        </div>

        {/* Right Column - Content (Desktop only) */}
        <div className="hidden md:flex flex-1 flex-col overflow-hidden">
          {/* Header - Desktop only */}
          <div className="bg-bg-surface px-4 py-3 flex items-center justify-between border-b border-bg-hover">
            <h2 className="text-lg font-medium text-text-primary">
              {(() => {
                switch (activeTab) {
                  case 'overview': return 'Vue d\'ensemble';
                  case 'members': return 'Membres';
                  case 'media': return 'Médias';
                  case 'files': return 'Fichiers';
                  case 'links': return 'Liens';
                  default: return '';
                }
              })()}
            </h2>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors"
            >
              <X size={20} className="text-text-secondary" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto bg-bg-primary p-4">
            {renderTabContent()}
          </div>
        </div>
      </div>

      {/* Add Member Modal */}
      <AddMemberModal
        isOpen={showAddMemberModal}
        onClose={() => setShowAddMemberModal(false)}
        conversationId={conversationId}
        currentUserId={currentUserId}
        existingMemberIds={members.map(m => m.user_id)}
        onMembersAdded={loadMembers}
      />

      {/* Media Viewer */}
      {isMediaViewerOpen && selectedMedia && (
        <MediaViewer
          isOpen={isMediaViewerOpen}
          mediaUrl={selectedMedia.media_url || selectedMedia.file_url || ''}
          mediaType={(selectedMedia.type === 'video' || selectedMedia.media_type === 'video') ? 'video' : 'image'}
          senderName={getSenderName(selectedMedia.sender_id)}
          senderAvatar={getSenderAvatar(selectedMedia.sender_id)}
          timestamp={selectedMedia.created_at}
          isOwn={selectedMedia.sender_id === currentUserId}
          onClose={() => setIsMediaViewerOpen(false)}
          allMedia={getMediaViewerItems()}
          currentIndex={mediaMessages.findIndex(m => m.id === selectedMedia.id)}
          onNavigate={(index) => setSelectedMedia(mediaMessages[index])}
        />
      )}

      {/* Ephemeral Duration Menu */}
      <EphemeralDurationMenu
        isOpen={showEphemeralMenu}
        onClose={() => setShowEphemeralMenu(false)}
        currentDuration={ephemeralDuration}
        onSelectDuration={handleSetEphemeralDuration}
      />
    </div>
  );
};
