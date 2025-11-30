import React, { useState, useEffect } from 'react';
import { 
  X, Camera, Video, Phone, Users, Image, FileText, Link as LinkIcon, 
  Calendar, Lock, Edit2, Check, ChevronRight, Bell, BellOff, Archive,
  Trash2, UserPlus, Crown
} from 'lucide-react';
import { supabase, Profile } from '@/lib/supabase';

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
}

interface GroupMember {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
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
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'media' | 'files' | 'links'>('overview');
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [newDescription, setNewDescription] = useState(conversationDescription || '');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentAvatar, setCurrentAvatar] = useState(conversationAvatar);

  useEffect(() => {
    if (conversationType === 'group') {
      loadMembers();
    }
    loadMuteStatus();
  }, [conversationId]);

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
            .select('username, display_name')
            .eq('id', member.user_id)
            .single();

          return {
            ...member,
            username: profile?.username || 'Unknown',
            display_name: profile?.display_name || null,
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
      
      // Mettre à jour l'avatar localement
      setCurrentAvatar(publicUrl);
      
      // Forcer le rechargement de la page pour mettre à jour partout
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
      const { error } = await supabase
        .from('conversations')
        .update({ description: newDescription.trim() || null })
        .eq('id', conversationId);

      if (!error) {
        setIsEditingDescription(false);
        alert('✅ Description mise à jour !');
      }
    } catch (err) {
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

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-bg-surface w-full max-w-6xl rounded-2xl max-h-[90vh] flex flex-col md:flex-row overflow-hidden shadow-2xl">
        {/* Left Column - Avatar & Actions */}
        <div className="md:w-80 bg-bg-surface border-b md:border-b-0 md:border-r border-bg-hover flex-shrink-0">
          {/* Header - Mobile only */}
          <div className="md:hidden bg-bg-surface px-4 py-3 flex items-center justify-between border-b border-bg-hover">
            <h2 className="text-lg font-medium text-text-primary">Informations</h2>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors"
            >
              <X size={20} className="text-text-secondary" />
            </button>
          </div>

          {/* Avatar & Name */}
          <div className="px-6 py-6 text-center">
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
            {(conversationType === 'group' ? isAdmin : true) && (
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

          {/* Tabs - Vertical on desktop */}
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
        </div>

        {/* Right Column - Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header - Desktop only */}
          <div className="hidden md:flex bg-bg-surface px-4 py-3 items-center justify-between border-b border-bg-hover">
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
          {activeTab === 'overview' && (
            <div className="p-4 space-y-3">
              {/* Description */}
              <div className="bg-bg-surface rounded-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-text-secondary">Description</h4>
                  {(conversationType === 'group' ? isAdmin : true) && (
                    <button
                      onClick={() => setIsEditingDescription(!isEditingDescription)}
                      className="text-accent"
                    >
                      {isEditingDescription ? <Check size={16} /> : <Edit2 size={16} />}
                    </button>
                  )}
                </div>
                {isEditingDescription ? (
                  <div className="space-y-2">
                    <textarea
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      className="w-full px-3 py-2 bg-bg-hover text-text-primary rounded-xl outline-none resize-none"
                      rows={3}
                      placeholder="Ajouter une description..."
                    />
                    <button
                      onClick={handleUpdateDescription}
                      className="w-full py-2 bg-accent hover:bg-[#5a5ec9] text-white rounded-xl text-sm font-medium"
                    >
                      Enregistrer
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-text-primary">
                    {conversationDescription || 'Aucune description'}
                  </p>
                )}
              </div>

              {/* Chiffrement */}
              <div className="bg-bg-surface rounded-2xl p-3">
                <div className="flex items-center gap-3">
                  <Lock size={20} className="text-accent" />
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-text-primary">Chiffrement</h4>
                    <p className="text-xs text-text-secondary">Messages chiffrés de bout en bout</p>
                  </div>
                  <Check size={16} className="text-accent" />
                </div>
              </div>

              {/* Messages éphémères */}
              <div className="bg-bg-surface rounded-2xl p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-text-primary">Messages éphémères</h4>
                    <p className="text-xs text-text-secondary">Désactivés</p>
                  </div>
                  <ChevronRight size={16} className="text-text-secondary" />
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-2">
                <button
                  onClick={handleToggleMute}
                  className="w-full bg-bg-surface rounded-2xl p-3 flex items-center gap-3 hover:bg-bg-hover transition-colors"
                >
                  {isMuted ? <Bell size={20} className="text-text-secondary" /> : <BellOff size={20} className="text-text-secondary" />}
                  <span className="text-sm text-text-primary">
                    {isMuted ? 'Activer les notifications' : 'Désactiver les notifications'}
                  </span>
                </button>

                <button
                  onClick={handleArchive}
                  className="w-full bg-bg-surface rounded-2xl p-3 flex items-center gap-3 hover:bg-bg-hover transition-colors"
                >
                  <Archive size={20} className="text-text-secondary" />
                  <span className="text-sm text-text-primary">Archiver la conversation</span>
                </button>

                <button
                  onClick={handleDelete}
                  className="w-full bg-bg-surface rounded-2xl p-3 flex items-center gap-3 hover:bg-bg-hover transition-colors"
                >
                  <Trash2 size={20} className="text-red-500" />
                  <span className="text-sm text-red-500">Supprimer la conversation</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'members' && conversationType === 'group' && (
            <div className="p-4 space-y-2">
              {isAdmin && (
                <button className="w-full bg-bg-surface rounded-2xl p-4 flex items-center gap-3 hover:bg-bg-hover transition-colors mb-4">
                  <UserPlus size={20} className="text-accent" />
                  <span className="text-sm text-text-primary">Ajouter des membres</span>
                </button>
              )}
              
              {members.map((member) => (
                <div
                  key={member.id}
                  className="bg-bg-surface rounded-2xl p-4 flex items-center gap-3"
                >
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold">
                    {(member.display_name || member.username)[0].toUpperCase()}
                  </div>
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
            </div>
          )}

          {activeTab === 'media' && (
            <div className="p-4">
              <div className="text-center py-12 text-text-secondary">
                <Image size={48} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">Aucun média partagé</p>
              </div>
            </div>
          )}

          {activeTab === 'files' && (
            <div className="p-4">
              <div className="text-center py-12 text-text-secondary">
                <FileText size={48} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">Aucun fichier partagé</p>
              </div>
            </div>
          )}

          {activeTab === 'links' && (
            <div className="p-4">
              <div className="text-center py-12 text-text-secondary">
                <LinkIcon size={48} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">Aucun lien partagé</p>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
};