import React, { useState, useEffect } from 'react';
import { X, Search, Users, Check, Loader2 } from 'lucide-react';
import { supabase, Profile } from '@/lib/supabase';

interface AddMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  currentUserId: string;
  existingMemberIds: string[];
  onMembersAdded: () => void;
}

export const AddMemberModal: React.FC<AddMemberModalProps> = ({
  isOpen,
  onClose,
  conversationId,
  currentUserId,
  existingMemberIds,
  onMembersAdded,
}) => {
  const [availableContacts, setAvailableContacts] = useState<Profile[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [addingMembers, setAddingMembers] = useState(false);
  const [contactSearchQuery, setContactSearchQuery] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadAvailableContacts();
      setSelectedContacts([]);
      setContactSearchQuery('');
    }
  }, [isOpen]);

  const loadAvailableContacts = async () => {
    const memberUserIds = new Set(existingMemberIds);
    
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
      
      onMembersAdded();
      onClose();
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

  const filteredContacts = availableContacts.filter(contact =>
    contact.username.toLowerCase().includes(contactSearchQuery.toLowerCase()) ||
    (contact.display_name?.toLowerCase().includes(contactSearchQuery.toLowerCase()))
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="bg-bg-surface w-full max-w-md rounded-2xl overflow-hidden shadow-2xl">
        {/* Modal Header */}
        <div className="px-4 py-3 border-b border-bg-hover flex items-center justify-between">
          <h3 className="text-lg font-medium text-text-primary">Ajouter des membres</h3>
          <button
            onClick={onClose}
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
            onClick={onClose}
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
  );
};
