// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState } from 'react';
import { UserPlus, UserMinus, Edit, Trash2, LogOut, Crown, Camera } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { invalidateMediaUrl } from '@/lib/mediaUrl';
import { MediaImg } from './MediaImg';
import { useI18n } from '@/i18n';

interface GroupMember {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  role: 'admin' | 'member';
}

interface GroupManagementProps {
  conversationId: string;
  groupName: string;
  groupDescription: string | null;
  groupAvatar?: string | null;
  members: GroupMember[];
  currentUserId: string;
  isAdmin: boolean;
  onClose: () => void;
}

export const GroupManagement: React.FC<GroupManagementProps> = ({
  conversationId,
  groupName,
  groupDescription,
  groupAvatar,
  members,
  currentUserId,
  isAdmin,
  onClose,
}) => {
  const { t } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState(groupName);
  const [newDescription, setNewDescription] = useState(groupDescription || '');
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Avatar local mis à jour optimistement après upload (path nu)
  const [localAvatar, setLocalAvatar] = useState<string | null | undefined>(groupAvatar);

  const handleUpdateGroup = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('conversations')
        .update({
          name: newName,
          description: newDescription || null,
        })
        .eq('id', conversationId);

      if (!error) {
        setIsEditing(false);
        alert(t('groupUpdatedSuccess'));
      }
    } catch (error) {
      console.error('Error updating group:', error);
      alert(t('groupUpdateError'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!isAdmin) {
      alert(t('onlyAdminsCanRemoveMembers'));
      return;
    }

    if (!confirm(t('removeMemberConfirm'))) {
      return;
    }

    try {
      const { error } = await supabase
        .from('conversation_members')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('user_id', userId);

      if (!error) {
        alert(t('memberRemovedSuccess'));
      }
    } catch (error) {
      console.error('Error removing member:', error);
      alert(t('memberRemoveError'));
    }
  };

  const handlePromoteToAdmin = async (userId: string) => {
    if (!isAdmin) {
      alert(t('onlyAdminsCanPromote'));
      return;
    }

    try {
      const { error } = await supabase
        .from('conversation_members')
        .update({ role: 'admin' })
        .eq('conversation_id', conversationId)
        .eq('user_id', userId);

      if (!error) {
        alert(t('memberPromoted'));
      }
    } catch (error) {
      console.error('Error promoting member:', error);
      alert(t('promoteError'));
    }
  };

  const handleLeaveGroup = async () => {
    if (!confirm(t('leaveGroupConfirm'))) {
      return;
    }

    try {
      const { error } = await supabase
        .from('conversation_members')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('user_id', currentUserId);

      if (!error) {
        alert(t('leftGroup'));
        onClose();
      }
    } catch (error) {
      console.error('Error leaving group:', error);
      alert(t('leaveGroupError'));
    }
  };

  const handleDeleteGroup = async () => {
    if (!isAdmin) {
      alert(t('onlyAdminsCanDeleteGroup'));
      return;
    }

    if (!confirm(t('deleteGroupConfirm'))) {
      return;
    }

    try {
      const { error } = await supabase
        .from('conversations')
        .delete()
        .eq('id', conversationId);

      if (!error) {
        alert(t('groupDeleted'));
        onClose();
      }
    } catch (error) {
      console.error('Error deleting group:', error);
      alert(t('groupDeleteError'));
    }
  };

  const handleUploadGroupPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!isAdmin) {
      alert(t('onlyAdminsCanChangePhoto'));
      return;
    }
    
    // Vérifier la taille du fichier (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert(t('fileTooLargeAlert'));
      return;
    }
    
    // Vérifier le type de fichier
    if (!file.type.startsWith('image/')) {
      alert(t('invalidImageFormatAlert'));
      return;
    }
    
    setUploadingPhoto(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `groups/${conversationId}/avatar-${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: true
        });
      
      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw new Error('Erreur lors de l\'upload');
      }
      
      // On stocke le path nu en base (pas l'URL signée qui expire).
      // L'URL signée sera générée à la volée via getMediaUrl() au moment de l'affichage.
      const { error: updateError } = await supabase
        .from('conversations')
        .update({ avatar_url: fileName })
        .eq('id', conversationId);
      
      if (updateError) {
        console.error('Group update error:', updateError);
        throw new Error(t('groupUpdateError'));
      }
      
      // Mise à jour locale immédiate (sans reload)
      setLocalAvatar(fileName);
      // Invalider les caches
      try {
        localStorage.removeItem(`anu_cache_conv_${conversationId}`);
        invalidateMediaUrl(fileName);
      } catch {
        // ignore
      }
      alert(t('groupPhotoUpdated'));
    } catch (err: any) {
      console.error('Group photo upload error:', err);
      alert(err.message || t('photoUploadErrorAlert'));
    } finally {
      setUploadingPhoto(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-glass-surface-light backdrop-blur-[30px] border border-glass-border rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Gestion du groupe</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Group Info */}
        <div className="mb-6 p-4 rounded-xl bg-glass-surface-medium border border-glass-border">
          {/* Group Avatar */}
          <div className="flex justify-center mb-4">
            <div className="relative">
              <MediaImg
                src={localAvatar}
                alt={groupName}
                className="w-24 h-24 rounded-full object-cover"
                fallback={
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-3xl">
                    {groupName[0]?.toUpperCase()}
                  </div>
                }
              />
              {isAdmin && (
                <label className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center cursor-pointer hover:bg-[#5a5ec9] transition-colors">
                  <Camera size={16} className="text-white" />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUploadGroupPhoto}
                    className="hidden"
                    disabled={uploadingPhoto}
                  />
                </label>
              )}
            </div>
          </div>
          
          {isEditing ? (
            <div className="space-y-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-4 py-2 rounded-lg bg-glass-surface-light border border-glass-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-400"
                placeholder={t('groupNameLabel')}
              />
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="w-full px-4 py-2 rounded-lg bg-glass-surface-light border border-glass-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
                placeholder={t('groupDescriptionPlaceholder')}
                rows={3}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleUpdateGroup}
                  disabled={saving}
                  className="flex-1 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white transition-colors disabled:opacity-50"
                >
                  {saving ? t('saving') : t('save')}
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="flex-1 py-2 rounded-lg bg-glass-surface-medium hover:bg-white/10 transition-colors"
                >
                  {t('cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="text-xl font-semibold mb-1">{groupName}</h3>
                {groupDescription && (
                  <p className="text-sm text-text-tertiary">{groupDescription}</p>
                )}
                <p className="text-xs text-text-tertiary mt-2">{t('membersCount', { count: members.length })}</p>
              </div>
              {isAdmin && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                >
                  <Edit size={18} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Members List */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
            {t('membersCountHeader', { count: members.length })}
          </h3>
          <div className="space-y-2">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center gap-3 p-3 rounded-xl bg-glass-surface-medium border border-glass-border hover:bg-white/5 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold">
                  {(member.display_name || member.username)[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {member.display_name || member.username}
                    {member.user_id === currentUserId && ` (${t('you')})`}
                  </div>
                  <div className="text-sm text-text-tertiary flex items-center gap-1">
                    {member.role === 'admin' && (
                      <>
                        <Crown size={12} className="text-yellow-500" />
                        <span>{t('adminLabel')}</span>
                      </>
                    )}
                  </div>
                </div>
                
                {isAdmin && member.user_id !== currentUserId && (
                  <div className="flex gap-1">
                    {member.role === 'member' && (
                      <button
                        onClick={() => handlePromoteToAdmin(member.user_id)}
                        className="p-2 rounded-full hover:bg-primary-500/20 transition-colors"
                        title={t('promoteAdmin')}
                      >
                        <Crown size={16} className="text-primary-500" />
                      </button>
                    )}
                    <button
                      onClick={() => handleRemoveMember(member.user_id)}
                      className="p-2 rounded-full hover:bg-red-500/20 transition-colors"
                      title={t('removeFromGroup')}
                    >
                      <UserMinus size={16} className="text-red-500" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          {isAdmin && (
            <button
              className="w-full py-3 rounded-xl bg-glass-surface-medium hover:bg-white/10 border border-glass-border transition-colors flex items-center justify-center gap-2"
            >
              <UserPlus size={20} />
              {t('addMembers')}
            </button>
          )}

          <button
            onClick={handleLeaveGroup}
            className="w-full py-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 transition-colors flex items-center justify-center gap-2"
          >
            <LogOut size={20} />
            {t('leaveGroup')}
          </button>

          {isAdmin && (
            <button
              onClick={handleDeleteGroup}
              className="w-full py-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 size={20} />
              {t('deleteGroup')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};