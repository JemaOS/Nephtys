// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useEffect } from 'react';
import {
  X, Camera, Video, Phone, Users, Image, FileText, Link as LinkIcon,
  Lock, Edit2, Check, ChevronRight, Bell, BellOff, Archive,
  Trash2, UserPlus, Crown, Download, ExternalLink, Loader2, Search, Timer
} from 'lucide-react';
import { supabase, Profile, Message } from '@/lib/supabase';
import { MediaViewer } from './MediaViewer';

// Helper functions at module level to reduce component complexity

// Format file size helper
const formatFileSize = (bytes: number | null): string => {
  if (!bytes) return 'Taille inconnue';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Format date helper
const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
};

// Get ephemeral label helper
const getEphemeralLabel = (duration: number | null): string => {
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
  const [availableContacts, setAvailableContacts] = useState<Profile[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [addingMembers, setAddingMembers] = useState(false);
  const [contactSearchQuery, setContactSearchQuery] = useState('');
  
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
      const { error } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: currentUserId,
        content: systemMessageContent,
        type: 'text',
        status: 'sent',
      }).select();
      
      if (error) {
        console.error('Error inserting system message:', error);
      } else {
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


  const loadAvailableContacts = async () => {
    const memberUserIds = new Set(members.map(m => m.user_id));
    
    // Only load contacts that the current user has explicitly added
    // If a user deletes a contact, they should no longer see that person
    // even if that person had added them as a contact
    // Order by added_at DESC to get the most recent entry first (handles re-added contacts)
    const { data: myContacts } = await supabase
      .from('contacts')
      .select('contact_user_id, added_at')
      .eq('user_id', currentUserId)
      .eq('is_blocked', false)
      .order('added_at', { ascending: false });

    // Deduplicate contacts by contact_user_id, keeping the most recent entry
    const uniqueContactIds = new Set<string>();
    const deduplicatedContacts: string[] = [];
    for (const contact of (myContacts || [])) {
      if (!uniqueContactIds.has(contact.contact_user_id)) {
        uniqueContactIds.add(contact.contact_user_id);
        deduplicatedContacts.push(contact.contact_user_id);
      }
    }

    // Filter out current group members using Set.has for better performance
    const myContactIds = deduplicatedContacts.filter(id => !memberUserIds.has(id));

    if (myContactIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', myContactIds);
      
      setAvailableContacts(profiles || []);
    } else {
      setAvailableContacts([]);
    }
  };

  const handleOpenAddMemberModal = () => {
    setShowAddMemberModal(true);
    setSelectedContacts([]);
    setContactSearchQuery('');
    loadAvailableContacts();
  };

  const handleAddMembers = async () => {
    if (selectedContacts.length === 0) return;
    
    setAddingMembers(true);
    try {
      const newMembers = selectedContacts.map(userId => ({
        conversation_id: conversationId,
        user_id: userId,
        role: 'member' as const,
      }));
      
      const { error } = await supabase
        .from('conversation_members')
        .insert(newMembers);
      
      if (error) throw error;
      
      await loadMembers();
      setShowAddMemberModal(false);
      setSelectedContacts([]);
      alert('✅ Membres ajoutés avec succès !');
    } catch (err) {
      console.error('Error adding members:', err);
      alert('❌ Erreur lors de l\'ajout des membres');
    } finally {
      setAddingMembers(false);
    }
  };

  const toggleContactSelection = (userId: string) => {
    setSelectedContacts(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const loadMedia = async () => {
    setLoadingMedia(true);
    try {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .or('type.eq.image,type.eq.video,media_type.eq.image,media_type.eq.video')
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
        .order('created_at', { ascending: false });
      
      if (data) {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const messagesWithLinks = data
          .map(message => {
            // Remove GIF and Sticker markdown before extracting links
            // Pattern: [GIF](url) or [STICKER](url)
            const cleanContent = message.content?.replace(/\[(GIF|STICKER)\]\([^)]+\)/g, '') || '';
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


  const filteredContacts = availableContacts.filter(contact =>
    contact.username.toLowerCase().includes(contactSearchQuery.toLowerCase()) ||
    (contact.display_name?.toLowerCase().includes(contactSearchQuery.toLowerCase()))
  );

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
      
      const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(fileName);
      
      const { error: updateError } = await supabase
        .from('conversations')
        .update({ avatar_url: publicUrl })
        .eq('id', conversationId);
      
      if (updateError) throw updateError;
      
      setCurrentAvatar(publicUrl);
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

  // Extracted overview tab content to reduce component complexity
  const renderOverviewTab = () => (
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

  // Extracted members tab content
  const renderMembersTab = () => (
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

  // Extracted media tab content
  const renderMediaTab = () => {
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

  // Extracted files tab content
  const renderFilesTab = () => {
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

  // Extracted links tab content
  const renderLinksTab = () => {
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

  // Render tab content - extracted to avoid duplication
  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return renderOverviewTab();
      case 'members':
        return renderMembersTab();
      case 'media':
        return renderMediaTab();
      case 'files':
        return renderFilesTab();
      case 'links':
        return renderLinksTab();
      default:
        return null;
    }
  };

  // Helper to get ephemeral menu item - extracted to reduce complexity
  const renderEphemeralMenuItem = (duration: number | null, label: string) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleSetEphemeralDuration(duration);
      }}
      className="w-full px-4 py-3 text-left hover:bg-bg-hover transition-colors flex items-center justify-between"
    >
      <span className="text-sm text-text-primary">{label}</span>
      {ephemeralDuration === duration && <Check size={18} className="text-accent" />}
    </button>
  );

  // Helper to get sender name from message
  const getSenderName = (senderId: string): string => {
    if (conversationType === 'group') {
      const member = members.find(m => m.user_id === senderId);
      return member?.display_name || member?.username || 'Utilisateur';
    } else {
      const participant = directParticipants.find(p => p.user.id === senderId);
      return participant?.user.display_name || participant?.user.username || 'Utilisateur';
    }
  };

  // Helper to get sender avatar from message
  const getSenderAvatar = (senderId: string): string | undefined => {
    if (conversationType === 'group') {
      const member = members.find(m => m.user_id === senderId);
      return member?.avatar_url || undefined;
    } else {
      const participant = directParticipants.find(p => p.user.id === senderId);
      return participant?.user.avatar_url || undefined;
    }
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
                <p className="text-sm text-text-secondary">Groupe • {members.length} membres</p>
              )}
              {conversationType === 'direct' && otherUser && (
                <p className="text-sm text-text-secondary">@{otherUser.username}</p>
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
                  {tab === 'overview' ? 'Vue d\'ensemble' :
                   tab === 'members' ? 'Membres' :
                   tab === 'media' ? 'Médias' :
                   tab === 'files' ? 'Fichiers' :
                   'Liens'}
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
              {activeTab === 'overview' ? 'Vue d\'ensemble' :
               activeTab === 'members' ? 'Membres' :
               activeTab === 'media' ? 'Médias' :
               activeTab === 'files' ? 'Fichiers' :
               'Liens'}
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
      {showAddMemberModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-bg-surface w-full max-w-md rounded-2xl overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="px-4 py-3 border-b border-bg-hover flex items-center justify-between">
              <h3 className="text-lg font-medium text-text-primary">Ajouter des membres</h3>
              <button
                onClick={() => setShowAddMemberModal(false)}
                className="w-8 h-8 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors"
              >
                <X size={18} className="text-text-secondary" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-4 border-b border-bg-hover">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  type="text"
                  value={contactSearchQuery}
                  onChange={(e) => setContactSearchQuery(e.target.value)}
                  placeholder="Rechercher un contact..."
                  className="w-full pl-10 pr-4 py-2 bg-bg-hover text-text-primary rounded-xl outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>

            {/* Contacts List */}
            <div className="max-h-64 overflow-y-auto p-2">
              {filteredContacts.length === 0 ? (
                <div className="text-center py-8 text-text-secondary">
                  <Users size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Aucun contact disponible</p>
                </div>
              ) : (
                filteredContacts.map((contact) => (
                  <button
                    key={contact.id}
                    onClick={() => toggleContactSelection(contact.id)}
                    className={`w-full p-3 rounded-xl flex items-center gap-3 transition-colors ${
                      selectedContacts.includes(contact.id)
                        ? 'bg-accent/20'
                        : 'hover:bg-bg-hover'
                    }`}
                  >
                    {contact.avatar_url ? (
                      <img
                        src={contact.avatar_url}
                        alt={contact.display_name || contact.username}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold">
                        {(contact.display_name || contact.username)[0].toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 text-left">
                      <p className="text-sm font-medium text-text-primary">
                        {contact.display_name || contact.username}
                      </p>
                      <p className="text-xs text-text-secondary">@{contact.username}</p>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      selectedContacts.includes(contact.id)
                        ? 'bg-accent border-accent'
                        : 'border-text-secondary'
                    }`}>
                      {selectedContacts.includes(contact.id) && (
                        <Check size={12} className="text-white" />
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-bg-hover flex gap-2">
              <button
                onClick={() => setShowAddMemberModal(false)}
                className="flex-1 py-2 bg-bg-hover text-text-primary rounded-xl text-sm font-medium hover:bg-bg-hover/80 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleAddMembers}
                disabled={selectedContacts.length === 0 || addingMembers}
                className="flex-1 py-2 bg-accent text-white rounded-xl text-sm font-medium hover:bg-[#5a5ec9] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {addingMembers ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Ajout...
                  </>
                ) : (
                  `Ajouter (${selectedContacts.length})`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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
      {showEphemeralMenu && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div
            className="bg-bg-surface w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-bg-hover">
              <h4 className="text-base font-medium text-text-primary">Durée des messages</h4>
              <p className="text-xs text-text-secondary mt-1">
                Les nouveaux messages disparaîtront après la durée sélectionnée
              </p>
            </div>
            
            <div className="py-2">
              {renderEphemeralMenuItem(null, 'Désactivé')}
              {renderEphemeralMenuItem(3600, '1 heure')}
              {renderEphemeralMenuItem(86400, '24 heures')}
              {renderEphemeralMenuItem(604800, '7 jours')}
              {renderEphemeralMenuItem(7776000, '90 jours')}
            </div>

            <div className="p-4 border-t border-bg-hover">
              <button
                onClick={() => setShowEphemeralMenu(false)}
                className="w-full py-2 bg-bg-hover text-text-primary rounded-xl text-sm font-medium hover:bg-bg-hover/80 transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};