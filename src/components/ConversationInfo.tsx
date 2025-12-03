import React, { useState, useEffect } from 'react';
import {
  X, Camera, Video, Phone, Users, Image, FileText, Link as LinkIcon,
  Calendar, Lock, Edit2, Check, ChevronRight, Bell, BellOff, Archive,
  Trash2, UserPlus, Crown, Download, ExternalLink, Loader2, Search
} from 'lucide-react';
import { supabase, Profile, Message } from '@/lib/supabase';

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
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'media' | 'files' | 'links'>(initialTab);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [newDescription, setNewDescription] = useState(conversationDescription || '');
  const [currentDescription, setCurrentDescription] = useState(conversationDescription || '');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
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

  useEffect(() => {
    if (conversationType === 'group') {
      loadMembers();
    } else if (conversationType === 'direct') {
      loadDirectParticipants();
    }
    loadMuteStatus();
    
    if (conversationType === 'direct' && otherUser?.avatar_url) {
      setCurrentAvatar(otherUser.avatar_url);
    }
  }, [conversationId, otherUser?.avatar_url, conversationType]);

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

  const loadAvailableContacts = async () => {
    const memberUserIds = members.map(m => m.user_id);
    
    // Load bidirectional contacts:
    // 1. Contacts I added (user_id = me)
    // 2. Contacts who added me (contact_user_id = me)
    // 3. Users from my conversations
    const [myContactsResult, addedMeResult, conversationsResult] = await Promise.all([
      supabase
        .from('contacts')
        .select('contact_user_id')
        .eq('user_id', currentUserId)
        .eq('is_blocked', false),
      supabase
        .from('contacts')
        .select('user_id')
        .eq('contact_user_id', currentUserId)
        .eq('is_blocked', false),
      supabase
        .from('conversation_members')
        .select('conversation_id, user_id')
        .neq('user_id', currentUserId)
    ]);

    const myContacts = myContactsResult.data || [];
    const addedMe = addedMeResult.data || [];

    // Get my conversation IDs first (we need to filter)
    const { data: myConversations } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', currentUserId);
    
    const myConversationIds = new Set(myConversations?.map(c => c.conversation_id) || []);
    
    // Filter other members to only those in my conversations
    const chatUserIds = [...new Set(
      (conversationsResult.data || [])
        .filter(m => myConversationIds.has(m.conversation_id))
        .map(m => m.user_id)
    )];

    // Get all unique user IDs (contacts I added + users who added me + chat users)
    const myContactIds = myContacts.map(c => c.contact_user_id);
    const addedMeUserIds = addedMe.map(c => c.user_id);
    
    // Combine and deduplicate, excluding current group members
    const allContactIds = [...new Set([...myContactIds, ...addedMeUserIds, ...chatUserIds])]
      .filter(id => !memberUserIds.includes(id));

    if (allContactIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', allContactIds);
      
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
            const urls = message.content?.match(urlRegex) || [];
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

  const formatFileSize = (bytes: number | null): string => {
    if (!bytes) return 'Taille inconnue';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
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
      window.location.reload();
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
      window.location.href = '/chats';
    }
  };

  // Render tab content - extracted to avoid duplication
  const renderTabContent = () => (
    <>
      {activeTab === 'overview' && (
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
          <div className="bg-bg-surface rounded-xl p-4 cursor-pointer hover:bg-bg-hover transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-bg-hover flex items-center justify-center">
                <Calendar size={20} className="text-text-secondary" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-text-primary">Messages éphémères</h4>
                <p className="text-xs text-text-secondary">Désactivés</p>
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
      )}

      {activeTab === 'members' && (
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
      )}

      {activeTab === 'media' && (
        <div className="p-4">
          {loadingMedia ? (
            <div className="text-center py-12">
              <Loader2 size={32} className="mx-auto mb-2 animate-spin text-accent" />
              <p className="text-sm text-text-secondary">Chargement des médias...</p>
            </div>
          ) : mediaMessages.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">
              <Image size={48} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">Aucun média partagé</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {mediaMessages.map((media) => (
                <a
                  key={media.id}
                  href={media.media_url || media.file_url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="aspect-square rounded-lg overflow-hidden bg-bg-hover hover:opacity-80 transition-opacity"
                >
                  {(media.type === 'video' || media.media_type === 'video') ? (
                    <div className="w-full h-full flex items-center justify-center bg-bg-surface">
                      <Video size={32} className="text-text-secondary" />
                    </div>
                  ) : (
                    <img
                      src={media.media_url || media.file_url || ''}
                      alt="Media"
                      className="w-full h-full object-cover"
                    />
                  )}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'files' && (
        <div className="p-4">
          {loadingFiles ? (
            <div className="text-center py-12">
              <Loader2 size={32} className="mx-auto mb-2 animate-spin text-accent" />
              <p className="text-sm text-text-secondary">Chargement des fichiers...</p>
            </div>
          ) : fileMessages.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">
              <FileText size={48} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">Aucun fichier partagé</p>
            </div>
          ) : (
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
          )}
        </div>
      )}

      {activeTab === 'links' && (
        <div className="p-4">
          {loadingLinks ? (
            <div className="text-center py-12">
              <Loader2 size={32} className="mx-auto mb-2 animate-spin text-accent" />
              <p className="text-sm text-text-secondary">Chargement des liens...</p>
            </div>
          ) : linkMessages.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">
              <LinkIcon size={48} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">Aucun lien partagé</p>
            </div>
          ) : (
            <div className="space-y-2">
              {linkMessages.map(({ message, urls }) => (
                <div
                  key={message.id}
                  className="bg-bg-surface rounded-xl p-3"
                >
                  <p className="text-xs text-text-secondary mb-2">
                    {formatDate(message.created_at)}
                  </p>
                  {urls.map((url, index) => (
                    <a
                      key={index}
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
          )}
        </div>
      )}
    </>
  );

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
    </div>
  );
};