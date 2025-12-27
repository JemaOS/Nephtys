// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MainLayout } from '@/components/MainLayout'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { ArrowLeft, Users, X, Check } from 'lucide-react'

export function GroupsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const [showContactsModal, setShowContactsModal] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [selectedContacts, setSelectedContacts] = useState<string[]>([])
  const [contacts, setContacts] = useState<any[]>([])
  const [creating, setCreating] = useState(false)

  // Get the createWith parameter from URL (user ID to pre-select)
  const createWithUserId = searchParams.get('createWith')

  useEffect(() => {
    loadContacts()
  }, [user])

  // Pre-select user from URL parameter when contacts are loaded
  useEffect(() => {
    if (createWithUserId && contacts.length > 0) {
      // Check if this user is in our contacts
      const contactExists = contacts.some(c => c.contact_user_id === createWithUserId)
      if (contactExists && !selectedContacts.includes(createWithUserId)) {
        setSelectedContacts(prev => [...prev, createWithUserId])
      }
    }
  }, [createWithUserId, contacts])

  const loadContacts = async () => {
    if (!user) return

    // Only load contacts that the current user has explicitly added
    const { data: myContacts } = await supabase
      .from('contacts')
      .select('id, contact_user_id')
      .eq('user_id', user.id)
      .eq('is_blocked', false)
      .order('added_at', { ascending: false })

    if (!myContacts || myContacts.length === 0) {
      setContacts([])
      return
    }

    // Get unique contact IDs
    const contactIds = [...new Set(myContacts.map(c => c.contact_user_id))]

    // Fetch profiles
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .in('id', contactIds)

    if (profiles) {
      const contactsWithProfiles = profiles.map(profile => {
        const contact = myContacts.find(c => c.contact_user_id === profile.id)
        return {
          id: contact?.id || `contact-${profile.id}`,
          contact_user_id: profile.id,
          profile
        }
      })
      setContacts(contactsWithProfiles)
    } else {
      setContacts([])
    }
  }

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedContacts.length === 0 || !user) return

    setCreating(true)
    try {
      // Create conversation
      const { data: conversation, error: convError } = await supabase
        .from('conversations')
        .insert({
          type: 'group',
          name: groupName.trim(),
          description: groupDescription.trim() || null,
          created_by: user.id,
          is_encrypted: true,
          encryption_protocol: 'mls'
        })
        .select()
        .maybeSingle()

      if (convError || !conversation) throw convError

      // Add members (creator + selected contacts)
      const members = [
        { conversation_id: conversation.id, user_id: user.id, role: 'admin' },
        ...selectedContacts.map(contactId => ({
          conversation_id: conversation.id,
          user_id: contactId,
          role: 'member'
        }))
      ]

      const { error: membersError } = await supabase
        .from('conversation_members')
        .insert(members)

      if (membersError) throw membersError

      // Navigate to the new group chat
      navigate(`/chat/${conversation.id}`)
    } catch (err) {
      console.error('Error creating group:', err)
    } finally {
      setCreating(false)
    }
  }

  const toggleContact = (contactId: string) => {
    setSelectedContacts(prev =>
      prev.includes(contactId)
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    )
  }

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col bg-bg-primary pb-14 md:pb-0">
        {/* Header */}
        <div className="bg-bg-surface px-4 py-3 flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="w-10 h-10 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-[#aebac1]">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold text-text-primary">Nouveau groupe</h1>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Group Info */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-accent">Nom du groupe</label>
              <div className="relative">
                <Users size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  type="text"
                  placeholder="Ex: Famille, Amis, Projet..."
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className="w-full h-11 pl-10 pr-3 bg-bg-hover text-text-primary text-sm rounded-xl border-none outline-none placeholder:text-text-secondary"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm text-accent">Description (optionnel)</label>
              <textarea
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                placeholder="Décrivez le groupe..."
                className="w-full px-4 py-3 bg-bg-hover text-text-primary text-sm rounded-2xl border-none outline-none placeholder:text-text-secondary resize-none"
                rows={3}
              />
            </div>
          </div>

          {/* Selected Contacts */}
          {selectedContacts.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-text-secondary">
                {selectedContacts.length} membre{selectedContacts.length > 1 ? 's' : ''} sélectionné{selectedContacts.length > 1 ? 's' : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedContacts.map(contactId => {
                  const contact = contacts.find(c => c.contact_user_id === contactId)
                  return (
                    <div key={contactId} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-surface">
                      <span className="text-sm text-text-primary">{contact?.profile.username}</span>
                      <button onClick={() => toggleContact(contactId)} className="text-text-secondary hover:text-[#ea4335]">
                        <X size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Add Members Button */}
          <button
            onClick={() => setShowContactsModal(true)}
            className="w-full py-3 rounded-lg bg-bg-surface hover:bg-bg-hover text-text-primary font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Users size={20} />
            Ajouter des membres ({selectedContacts.length})
          </button>

          {/* Create Button */}
          <button
            onClick={handleCreateGroup}
            disabled={!groupName.trim() || selectedContacts.length === 0 || creating}
            className="w-full py-3 rounded-lg bg-accent hover:bg-[#5a5ec9] text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {creating ? (
              <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              <>
                <Check size={20} />
                Créer le groupe
              </>
            )}
          </button>
        </div>
      </div>

      {/* Contacts Selection Modal */}
      {showContactsModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-md bg-bg-surface rounded-lg flex flex-col max-h-[80vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-bg-hover flex items-center justify-between">
              <h2 className="text-xl font-semibold text-text-primary">Ajouter des membres</h2>
              <button
                onClick={() => setShowContactsModal(false)}
                className="w-8 h-8 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-text-secondary"
              >
                <X size={18} />
              </button>
            </div>

            {/* Selected Count */}
            {selectedContacts.length > 0 && (
              <div className="px-6 py-2 bg-bg-secondary border-b border-bg-hover">
                <p className="text-sm text-accent">
                  {selectedContacts.length} membre{selectedContacts.length > 1 ? 's' : ''} sélectionné{selectedContacts.length > 1 ? 's' : ''}
                </p>
              </div>
            )}

            {/* Contacts List */}
            <div className="flex-1 overflow-y-auto">
              {contacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                  <Users size={48} className="text-[#3b4a54] mb-3" />
                  <p className="text-text-secondary mb-4">Aucun contact disponible</p>
                  <button
                    onClick={() => {
                      setShowContactsModal(false)
                      navigate('/contacts')
                    }}
                    className="px-6 py-2 rounded-lg bg-accent hover:bg-[#5a5ec9] text-white font-medium transition-colors"
                  >
                    Ajouter des contacts
                  </button>
                </div>
              ) : (
                contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="px-6 py-3 cursor-pointer hover:bg-bg-hover transition-colors"
                    onClick={() => toggleContact(contact.contact_user_id)}
                  >
                    <div className="flex items-center gap-3">
                      {contact.profile.avatar_url ? (
                        <img
                          src={contact.profile.avatar_url}
                          alt={contact.profile.display_name || contact.profile.username}
                          className="w-12 h-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold">
                          {contact.profile.username[0].toUpperCase()}
                        </div>
                      )}
                      
                      <div className="flex-1 min-w-0">
                        <h3 className="text-text-primary font-normal truncate">
                          {contact.profile.display_name || contact.profile.username}
                        </h3>
                        <p className="text-sm text-text-secondary truncate">
                          @{contact.profile.username}
                        </p>
                      </div>

                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                        selectedContacts.includes(contact.contact_user_id)
                          ? 'bg-accent border-accent'
                          : 'border-[#8696a0]'
                      }`}>
                        {selectedContacts.includes(contact.contact_user_id) && (
                          <Check size={16} className="text-white" />
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-bg-hover">
              <button
                onClick={() => setShowContactsModal(false)}
                className="w-full py-2 rounded-2xl bg-accent hover:bg-[#5a5ec9] text-white font-medium transition-colors"
              >
                Valider ({selectedContacts.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  )
}
