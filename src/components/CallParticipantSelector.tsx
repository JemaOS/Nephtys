// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useEffect } from 'react'
import { Search, UserPlus, Check, Loader2 } from 'lucide-react'
import { supabase, Contact, Profile } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

interface CallParticipantSelectorProps {
  onClose: () => void
  onSelect: (contactId: string) => void | Promise<void>
  currentParticipants?: string[] // IDs of users already in the call to exclude
}

export function CallParticipantSelector({ onClose, onSelect, currentParticipants = [] }: CallParticipantSelectorProps) {
  const [contacts, setContacts] = useState<(Contact & { profile: Profile })[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set()) // Track who we've invited
  const [invitingId, setInvitingId] = useState<string | null>(null) // Currently inviting
  const { user } = useAuth()

  useEffect(() => {
    if (user) {
      loadContacts()
    }
  }, [user])

  const loadContacts = async () => {
    if (!user) return

    try {
      // 1. Load explicit contacts
      const { data: contactsData } = await supabase
        .from('contacts')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_blocked', false)
        .order('added_at', { ascending: false })

      // 2. Load conversation members (implicit contacts)
      const { data: conversationsData } = await supabase
        .from('conversation_members')
        .select('conversation_id, user_id')
        .neq('user_id', user.id)

      // Get my conversation IDs to filter relevant members
      const { data: myConversations } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id)
      
      const myConversationIds = new Set(myConversations?.map(c => c.conversation_id) || [])
      
      // Filter other members to only those in my conversations
      const chatUserIds = [...new Set(
        (conversationsData || [])
          .filter(m => myConversationIds.has(m.conversation_id))
          .map(m => m.user_id)
      )]

      // Deduplicate contacts
      const uniqueContactsMap = new Map<string, any>()
      for (const contact of (contactsData || [])) {
        uniqueContactsMap.set(contact.contact_user_id, contact)
      }
      
      const explicitContactIds = Array.from(uniqueContactsMap.keys())
      const allContactIds = [...new Set([...explicitContactIds, ...chatUserIds])]

      if (allContactIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('*')
          .in('id', allContactIds)

        if (profiles) {
          const contactsWithProfiles = profiles.map(profile => {
            const explicitContact = uniqueContactsMap.get(profile.id)
            
            if (explicitContact) {
              return { ...explicitContact, profile }
            } else {
              return {
                id: `chat-${profile.id}`,
                user_id: user.id,
                contact_user_id: profile.id,
                nickname: null,
                is_blocked: false,
                is_favorite: false,
                added_at: new Date().toISOString(),
                profile
              }
            }
          })

          // Filter out users already in the call
          const filteredContacts = contactsWithProfiles
            .filter(c => c.profile && !currentParticipants.includes(c.contact_user_id)) as (Contact & { profile: Profile })[]
            
          setContacts(filteredContacts)
        }
      } else {
        setContacts([])
      }
    } catch (error) {
      console.error('Error loading contacts:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredContacts = contacts.filter(contact =>
    contact.profile.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.profile.display_name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleInvite = async (contactId: string) => {
    if (invitedIds.has(contactId) || invitingId === contactId) return
    
    setInvitingId(contactId)
    try {
      const result = onSelect(contactId)
      // Await the result if it's a Promise
      if (result && typeof result.then === 'function') {
        await result
      }
      setInvitedIds(prev => new Set([...prev, contactId]))
    } catch (error) {
      console.error('Error inviting participant:', error)
    } finally {
      setInvitingId(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[150]">
      <div className="w-full max-w-md bg-gray-900 border border-white/10 rounded-2xl flex flex-col max-h-[80vh] shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Ajouter des participants</h2>
            {invitedIds.size > 0 && (
              <p className="text-xs text-green-400 mt-1">
                {invitedIds.size} invitation{invitedIds.size > 1 ? 's' : ''} envoyée{invitedIds.size > 1 ? 's' : ''}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
          >
            Fermer
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-white/5">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
            <input
              type="text"
              placeholder="Rechercher..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-10 pl-10 pr-3 bg-white/5 text-white text-sm rounded-xl border-none outline-none placeholder:text-white/30 focus:bg-white/10 transition-colors"
              autoFocus
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <UserPlus size={48} className="text-white/20 mb-4" />
              <p className="text-white/50 text-sm">Aucun contact disponible à ajouter</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredContacts.map((contact) => {
                const isInvited = invitedIds.has(contact.contact_user_id)
                const isInviting = invitingId === contact.contact_user_id
                
                return (
                  <button
                    key={contact.id}
                    onClick={() => handleInvite(contact.contact_user_id)}
                    disabled={isInvited || isInviting}
                    className={`w-full px-3 py-3 rounded-xl transition-colors flex items-center gap-3 text-left group ${
                      isInvited
                        ? 'bg-green-500/10 cursor-default'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    {/* Avatar */}
                    {contact.profile.avatar_url ? (
                      <img
                        src={contact.profile.avatar_url}
                        alt={contact.profile.display_name || contact.profile.username}
                        className="w-10 h-10 rounded-full object-cover flex-shrink-0 border border-white/10"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 shadow-lg">
                        {(contact.profile.display_name || contact.profile.username)[0].toUpperCase()}
                      </div>
                    )}
                    
                    <div className="flex-1 min-w-0">
                      <h3 className={`font-medium truncate transition-colors ${
                        isInvited ? 'text-green-400' : 'text-white group-hover:text-primary-400'
                      }`}>
                        {contact.nickname || contact.profile.display_name || contact.profile.username}
                      </h3>
                      <p className="text-xs text-white/50 truncate">
                        {isInvited ? 'Invitation envoyée ✓' : `@${contact.profile.username}`}
                      </p>
                    </div>
                    
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                      isInvited
                        ? 'bg-green-500 text-white'
                        : isInviting
                          ? 'bg-white/10 text-white'
                          : 'bg-white/5 text-white/50 group-hover:bg-primary-500 group-hover:text-white'
                    }`}>
                      {isInviting ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : isInvited ? (
                        <Check size={16} />
                      ) : (
                        <UserPlus size={16} />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
