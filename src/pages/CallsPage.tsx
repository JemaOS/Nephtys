import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/MainLayout'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useWebRTCCall } from '../hooks/useWebRTCCall'
import { Phone, Video, PhoneIncoming, PhoneOutgoing, PhoneMissed, Search, Star, Link2, Hash, Plus, MessageCircle, X, Trash2 } from 'lucide-react'
import { CallScreen } from '@/components/CallScreen'

interface CallLog {
  id: string
  conversation_id: string
  caller_id: string
  callee_id: string
  type: 'audio' | 'video'
  status: 'initiated' | 'answered' | 'missed' | 'rejected' | 'ended'
  started_at: string
  ended_at: string | null
  duration: number | null
  caller_profile?: any
  callee_profile?: any
}

export function CallsPage() {
  const [calls, setCalls] = useState<CallLog[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [showContactsModal, setShowContactsModal] = useState(false)
  const [contacts, setContacts] = useState<any[]>([])
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null)
  const [favorites, setFavorites] = useState<string[]>([])
  const [contextMenuCall, setContextMenuCall] = useState<CallLog | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [callerName, setCallerName] = useState<string>('')
  const [callerAvatar, setCallerAvatar] = useState<string | undefined>(undefined)
  const { user } = useAuth()
  const navigate = useNavigate()
  const {
    isInCall, isRinging, isCalling,
    localStream, remoteStream,
    audioEnabled, videoEnabled,
    startCall, answerCall, endCall,
    toggleAudio, toggleVideo, rejectCall,
  } = useWebRTCCall(user?.id || '')

  // Debug: afficher les états du hook
  useEffect(() => {
    console.log('🎯 WebRTC Hook States:', {
      isInCall,
      isRinging,
      isCalling,
      hasLocalStream: !!localStream,
      hasRemoteStream: !!remoteStream,
      callerName,
    })
  }, [isInCall, isRinging, isCalling, localStream, remoteStream, callerName])

  useEffect(() => {
    if (user) {
      loadCalls()
      loadContacts()
      loadFavorites()
      
      // S'abonner aux nouveaux appels en temps réel
      const channel = supabase
        .channel('call_logs')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'call_logs'
        }, () => {
          console.log('📞 New call log detected, reloading...')
          loadCalls()
        })
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }
  }, [user])

  const loadContacts = async () => {
    if (!user) return

    try {
      // Step 1: Fetch all contacts (single query)
      const { data: contactsData, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_blocked', false)

      if (error || !contactsData || contactsData.length === 0) {
        setContacts([])
        return
      }

      // Step 2: Batch fetch all profiles (single query)
      const contactUserIds = contactsData.map(c => c.contact_user_id)
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', contactUserIds)

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || [])

      // Step 3: Enrich contacts with profiles (no additional queries)
      const contactsWithProfiles = contactsData
        .map(contact => ({
          ...contact,
          profile: profileMap.get(contact.contact_user_id)
        }))
        .filter(c => c.profile)

      setContacts(contactsWithProfiles)
    } catch (err) {
      console.error('Error loading contacts:', err)
      setContacts([])
    }
  }

  const loadFavorites = () => {
    const saved = localStorage.getItem('anu_call_favorites')
    if (saved) {
      setFavorites(JSON.parse(saved))
    }
  }

  const toggleFavorite = (contactId: string) => {
    const newFavorites = favorites.includes(contactId)
      ? favorites.filter(id => id !== contactId)
      : [...favorites, contactId]
    
    setFavorites(newFavorites)
    localStorage.setItem('anu_call_favorites', JSON.stringify(newFavorites))
  }

  const loadCalls = async () => {
    if (!user) return
    setLoading(true)

    try {
      // Step 1: Fetch all calls (single query)
      console.log('📞 Loading calls for user:', user.id)
      
      const { data: callsData, error } = await supabase
        .from('call_logs')
        .select('*')
        .or(`caller_id.eq.${user.id},callee_id.eq.${user.id}`)
        .order('started_at', { ascending: false })
        .limit(100)

      console.log('📞 Calls data:', callsData)
      console.log('📞 Error:', error)

      if (error) {
        console.error('Error loading calls:', error)
        setCalls([])
        setLoading(false)
        return
      }

      if (!callsData || callsData.length === 0) {
        setCalls([])
        setLoading(false)
        return
      }

      // Step 2: Collect all unique user IDs
      const userIds = new Set<string>()
      callsData.forEach(call => {
        userIds.add(call.caller_id)
        userIds.add(call.callee_id)
      })

      // Step 3: Batch fetch all profiles (single query)
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', Array.from(userIds))

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || [])

      // Step 4: Enrich calls with profiles (no additional queries)
      const enrichedCalls = callsData.map(call => ({
        ...call,
        caller_profile: profileMap.get(call.caller_id) || null,
        callee_profile: profileMap.get(call.callee_id) || null
      }))

      setCalls(enrichedCalls)
    } catch (err) {
      console.error('Error loading calls:', err)
      setCalls([])
    } finally {
      setLoading(false)
    }
  }

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) {
      return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    } else if (diffDays === 1) {
      return 'Hier'
    } else if (diffDays < 7) {
      return date.toLocaleDateString('fr-FR', { weekday: 'short' })
    } else {
      return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
    }
  }

  const handleStartCall = () => {
    setShowContactsModal(true)
  }

  const handleCallContact = async (contactId: string, isVideo: boolean = false) => {
    // Récupérer le nom et l'avatar du contact AVANT de démarrer l'appel
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, username, avatar_url')
      .eq('id', contactId)
      .single()

    if (profile) {
      setCallerName(profile.display_name || profile.username || 'Utilisateur')
      setCallerAvatar(profile.avatar_url || undefined)
    }

    // Trouver ou créer une conversation avec ce contact
    const { data: existingMembers } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', user!.id)

    let conversationId: string | null = null

    if (existingMembers) {
      for (const member of existingMembers) {
        const { data: otherMember } = await supabase
          .from('conversation_members')
          .select('*')
          .eq('conversation_id', member.conversation_id)
          .eq('user_id', contactId)
          .maybeSingle()

        if (otherMember) {
          conversationId = member.conversation_id
          break
        }
      }
    }

    // Créer nouvelle conversation si nécessaire
    if (!conversationId) {
      const { data: conversation } = await supabase
        .from('conversations')
        .insert({
          type: 'direct',
          created_by: user!.id,
          is_encrypted: true,
          last_message_at: new Date().toISOString(),
        })
        .select()
        .maybeSingle()

      if (conversation) {
        await supabase
          .from('conversation_members')
          .insert([
            { conversation_id: conversation.id, user_id: user!.id, role: 'admin', is_active: true },
            { conversation_id: conversation.id, user_id: contactId, role: 'member', is_active: true }
          ])
        
        conversationId = conversation.id
      }
    }

    // Démarrer l'appel
    if (conversationId) {
      try {
        console.log('🔍 DEBUG: Starting call from handleCallContact')
        console.log('  - contactId:', contactId)
        console.log('  - conversationId:', conversationId)
        console.log('  - isVideo:', isVideo)
        console.log('  - callerName:', profile?.display_name || profile?.username)
        await startCall(contactId, conversationId, { audio: true, video: isVideo })
        console.log('🔍 DEBUG: Call started successfully')
        console.log('  - Hook states should now be updated (isInCall/isCalling)')
        setShowContactsModal(false)
      } catch (error) {
        console.error('Erreur lors du démarrage de l\'appel:', error)
        alert('Impossible de démarrer l\'appel')
      }
    }
  }

  const handleRecall = async () => {
    if (!selectedCall) return
    
    // Récupérer l'autre utilisateur de la conversation
    const { data: members } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', selectedCall.conversation_id)
      .neq('user_id', user!.id)
    
    if (members && members.length > 0) {
      const otherUserId = members[0].user_id
      
      // Récupérer le nom et l'avatar du contact
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, username, avatar_url')
        .eq('id', otherUserId)
        .single()

      if (profile) {
        setCallerName(profile.display_name || profile.username || 'Utilisateur')
        setCallerAvatar(profile.avatar_url || undefined)
      }

      console.log('🔍 DEBUG: Recall button clicked')
      console.log('  - conversationId:', selectedCall.conversation_id)
      console.log('  - callType:', selectedCall.type)
      console.log('  - otherUserId:', otherUserId)
      console.log('  - callerName:', profile?.display_name || profile?.username)
      try {
        // Démarrer l'appel avec le même type (audio/vidéo) que l'appel précédent
        await startCall(otherUserId, selectedCall.conversation_id, {
          audio: true,
          video: selectedCall.type === 'video'
        })
        console.log('🔍 DEBUG: Recall initiated successfully')
        setSelectedCall(null)
      } catch (error) {
        console.error('Erreur lors du rappel:', error)
        alert('Impossible de démarrer l\'appel')
      }
    }
  }

  const handleCallContextMenu = (e: React.MouseEvent, call: CallLog) => {
    e.preventDefault()
    setContextMenuCall(call)
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
  }

  const handleCloseContextMenu = () => {
    setContextMenuCall(null)
    setContextMenuPosition(null)
  }

  const handleDeleteCall = async (callId: string) => {
    try {
      await supabase
        .from('call_logs')
        .delete()
        .eq('id', callId)
      
      // Rafraîchir la liste
      loadCalls()
      handleCloseContextMenu()
    } catch (error) {
      console.error('Erreur lors de la suppression:', error)
    }
  }

  const handleCallFromContextMenu = async (isVideo: boolean) => {
    if (!contextMenuCall) return
    
    // Récupérer l'autre utilisateur de la conversation
    const { data: members } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', contextMenuCall.conversation_id)
      .neq('user_id', user!.id)
    
    if (members && members.length > 0) {
      const otherUserId = members[0].user_id
      
      // Récupérer le nom et l'avatar du contact
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, username, avatar_url')
        .eq('id', otherUserId)
        .single()

      setCallerName(profile?.display_name || profile?.username || 'Utilisateur')
      setCallerAvatar(profile?.avatar_url || undefined)
      
      try {
        await startCall(otherUserId, contextMenuCall.conversation_id, {
          audio: true,
          video: isVideo
        })
        handleCloseContextMenu()
      } catch (error) {
        console.error('Erreur lors de l\'appel:', error)
        alert('Impossible de démarrer l\'appel')
      }
    }
  }

  const handleCreateCallLink = () => {
    const callLink = `${window.location.origin}/call/${Math.random().toString(36).substring(2, 10)}`
    navigator.clipboard.writeText(callLink)
    alert(`Lien d'appel copié !\n${callLink}`)
  }

  const filteredCalls = calls.filter(call => {
    if (!searchQuery.trim()) return true
    const otherProfile = call.caller_id === user?.id ? call.callee_profile : call.caller_profile
    const name = otherProfile?.display_name || otherProfile?.username || ''
    return name.toLowerCase().includes(searchQuery.toLowerCase())
  })

  return (
    <MainLayout>
      {/* Liste des appels - Style JemaOS */}
      <div className="w-full md:w-[420px] bg-bg-secondary flex flex-col md:border-r border-bg-hover pb-14 md:pb-0">
        {/* Header */}
        <div className="bg-bg-surface px-4 py-3">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-semibold text-text-primary">Appels</h1>
            <button
              onClick={handleStartCall}
              className="w-10 h-10 rounded-full bg-accent hover:bg-[#5a5ec9] flex items-center justify-center transition-colors"
            >
              <Plus size={20} className="text-white" />
            </button>
          </div>
          
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              placeholder="Rechercher ou démarrer un appel"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-10 pr-3 bg-bg-surface text-text-primary text-sm rounded-xl border-none outline-none placeholder:text-text-secondary focus:bg-bg-hover"
            />
          </div>
        </div>

        {/* Favoris Section */}
        <div className="px-4 py-3 bg-bg-secondary">
          <p className="text-xs text-text-secondary uppercase tracking-wide mb-2">Favoris</p>
          {favorites.length === 0 ? (
            <button
              onClick={handleStartCall}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-bg-surface transition-colors rounded-lg"
            >
              <div className="w-12 h-12 rounded-full bg-bg-surface flex items-center justify-center">
                <Star size={20} className="text-text-secondary" />
              </div>
              <span className="text-text-primary">Ajouter aux favoris</span>
            </button>
          ) : (
            <div className="space-y-1">
              {favorites.map(favId => {
                const contact = contacts.find(c => c.contact_user_id === favId)
                if (!contact) return null
                return (
                  <div
                    key={favId}
                    className="px-4 py-3 flex items-center gap-3 hover:bg-bg-surface transition-colors rounded-lg cursor-pointer"
                    onClick={() => handleCallContact(favId)}
                  >
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold">
                      {contact.profile.username[0].toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <span className="text-text-primary">{contact.profile.display_name || contact.profile.username}</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFavorite(favId)
                      }}
                      className="w-8 h-8 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors"
                    >
                      <Star size={16} className="text-accent fill-[#6b6fdb]" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="px-4 py-2 bg-bg-secondary">
          <p className="text-xs text-text-secondary uppercase tracking-wide">Récents</p>
        </div>

        {/* Calls List */}
        <div className="flex-1 overflow-y-auto pb-2">
          {loading ? (
            <div className="flex justify-center items-center h-full">
              <div className="w-8 h-8 rounded-full border-4 border-accent border-t-transparent animate-spin" />
            </div>
          ) : filteredCalls.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <Phone size={64} className="text-[#3b4a54] mb-4" />
              <h3 className="text-lg font-medium text-text-secondary mb-2">Aucun appel</h3>
              <p className="text-sm text-text-secondary">Votre historique d'appels apparaîtra ici</p>
            </div>
          ) : (
            filteredCalls.map((call) => {
              const isOutgoing = call.caller_id === user?.id
              const otherProfile = isOutgoing ? call.callee_profile : call.caller_profile
              const displayName = otherProfile?.display_name || otherProfile?.username || 'Utilisateur'
              
              const isMissed = call.status === 'missed' || call.status === 'rejected'
              const isAnswered = call.status === 'answered' || call.status === 'ended'

              return (
                <div
                  key={call.id}
                  className={`px-4 py-3 hover:bg-bg-surface transition-colors cursor-pointer ${
                    selectedCall?.id === call.id ? 'bg-bg-surface' : ''
                  }`}
                  onClick={() => setSelectedCall(call)}
                  onContextMenu={(e) => handleCallContextMenu(e, call)}
                >
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold text-lg flex-shrink-0">
                      {displayName[0]?.toUpperCase()}
                    </div>
                    
                    {/* Info */}
                    <div className="flex-1 min-w-0 border-b border-bg-hover pb-3">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className={`truncate ${isMissed ? 'text-[#ea4335]' : 'text-text-primary'}`}>
                          {displayName}
                        </h3>
                      </div>
                      
                      <div className="flex items-center gap-2 text-sm text-text-secondary">
                        {/* Icône de direction */}
                        {isMissed ? (
                          <PhoneMissed size={14} className="text-[#ea4335]" />
                        ) : isOutgoing ? (
                          <PhoneOutgoing size={14} />
                        ) : (
                          <PhoneIncoming size={14} />
                        )}
                        
                        {/* Type d'appel */}
                        {call.type === 'video' && <Video size={14} />}
                        
                        {/* Statut */}
                        <span>
                          {isMissed ? 'Manqué' : isAnswered && call.duration ? formatDuration(call.duration) : 'Non répondu'}
                        </span>
                      </div>
                    </div>

                    {/* Date */}
                    <div className="text-xs text-text-secondary flex-shrink-0">
                      {formatDate(call.started_at)}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Zone d'info ou d'action - Desktop only */}
      <div className="hidden md:flex flex-1 bg-bg-primary flex-col p-8">
        {selectedCall ? (
          // Panneau d'informations de l'appel
          <div className="max-w-md mx-auto w-full">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-medium text-text-primary">Infos de l'appel</h2>
              <button
                onClick={() => setSelectedCall(null)}
                className="w-8 h-8 rounded-full hover:bg-bg-surface flex items-center justify-center transition-colors text-text-secondary"
              >
                <X size={20} />
              </button>
            </div>

            {/* Contact */}
            <div className="bg-bg-surface rounded-2xl p-6 mb-4">
              <div className="flex flex-col items-center gap-4">
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-3xl">
                  {(() => {
                    const isOutgoing = selectedCall.caller_id === user?.id
                    const otherProfile = isOutgoing ? selectedCall.callee_profile : selectedCall.caller_profile
                    const displayName = otherProfile?.display_name || otherProfile?.username || 'U'
                    return displayName[0]?.toUpperCase()
                  })()}
                </div>
                <div className="text-center">
                  <h3 className="text-xl font-medium text-text-primary mb-1">
                    {(() => {
                      const isOutgoing = selectedCall.caller_id === user?.id
                      const otherProfile = isOutgoing ? selectedCall.callee_profile : selectedCall.caller_profile
                      return otherProfile?.display_name || otherProfile?.username || 'Utilisateur'
                    })()}
                  </h3>
                  <p className="text-sm text-text-secondary">
                    {selectedCall.caller_id === user?.id ? 'Appel sortant' : 'Appel entrant'}
                  </p>
                </div>
              </div>
            </div>

            {/* Détails */}
            <div className="bg-bg-surface rounded-2xl p-6 space-y-4 mb-6">
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Type</span>
                <div className="flex items-center gap-2">
                  {selectedCall.type === 'video' ? <Video size={16} className="text-accent" /> : <Phone size={16} className="text-accent" />}
                  <span className="text-white">{selectedCall.type === 'video' ? 'Appel vidéo' : 'Appel vocal'}</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Date</span>
                <span className="text-white">{new Date(selectedCall.started_at).toLocaleString('fr-FR')}</span>
              </div>

              {selectedCall.duration && (
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary">Durée</span>
                  <span className="text-white">{formatDuration(selectedCall.duration)}</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Statut</span>
                <span className={`${
                  selectedCall.status === 'missed' || selectedCall.status === 'rejected' ? 'text-[#ea4335]' : 'text-[#00a884]'
                }`}>
                  {selectedCall.status === 'answered' ? 'Répondu' :
                   selectedCall.status === 'missed' ? 'Manqué' :
                   selectedCall.status === 'rejected' ? 'Refusé' :
                   selectedCall.status === 'ended' ? 'Terminé' : 'Initié'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <button
                onClick={() => {
                  const isOutgoing = selectedCall.caller_id === user?.id
                  const otherProfile = isOutgoing ? selectedCall.callee_profile : selectedCall.caller_profile
                  if (otherProfile) {
                    toggleFavorite(otherProfile.id)
                  }
                }}
                className="w-full py-3 rounded-xl bg-bg-surface hover:bg-bg-hover text-text-primary font-medium flex items-center justify-center gap-2"
              >
                <Star size={20} className={favorites.includes(
                  selectedCall.caller_id === user?.id ? selectedCall.callee_profile?.id : selectedCall.caller_profile?.id
                ) ? 'fill-[#6b6fdb] text-accent' : ''} />
                {favorites.includes(
                  selectedCall.caller_id === user?.id ? selectedCall.callee_profile?.id : selectedCall.caller_profile?.id
                ) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              </button>
              <button
                onClick={() => navigate(`/chat/${selectedCall.conversation_id}`)}
                className="w-full py-3 rounded-xl bg-accent hover:bg-[#5a5ec9] text-white font-medium flex items-center justify-center gap-2"
              >
                <MessageCircle size={20} />
                Ouvrir la conversation
              </button>
              <button
                onClick={handleRecall}
                className="w-full py-3 rounded-xl bg-bg-surface hover:bg-bg-hover text-text-primary font-medium flex items-center justify-center gap-2"
              >
                <Phone size={20} />
                Rappeler
              </button>
            </div>
          </div>
        ) : (
          // Zone d'action par défaut
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-8 max-w-md">
              <h2 className="text-2xl font-light text-text-secondary mb-6">Démarrer un appel</h2>
              
              <div className="grid grid-cols-3 gap-4">
            <button
              onClick={handleStartCall}
              className="flex flex-col items-center gap-3 p-6 bg-bg-surface rounded-2xl hover:bg-bg-hover transition-colors"
            >
              <div className="w-16 h-16 rounded-full bg-accent flex items-center justify-center">
                <Video size={28} className="text-white" />
              </div>
              <span className="text-sm text-text-primary">Démarrer un appel</span>
            </button>
            
            <button
              onClick={handleCreateCallLink}
              className="flex flex-col items-center gap-3 p-6 bg-bg-surface rounded-2xl hover:bg-bg-hover transition-colors"
            >
              <div className="w-16 h-16 rounded-full bg-bg-surface flex items-center justify-center border-2 border-accent">
                <Link2 size={28} className="text-accent" />
              </div>
              <span className="text-sm text-text-primary">Nouveau lien d'appel</span>
            </button>
            
            <button
              onClick={handleStartCall}
              className="flex flex-col items-center gap-3 p-6 bg-bg-surface rounded-2xl hover:bg-bg-hover transition-colors"
            >
              <div className="w-16 h-16 rounded-full bg-bg-surface flex items-center justify-center border-2 border-accent">
                <Hash size={28} className="text-accent" />
              </div>
              <span className="text-sm text-text-primary">Appeler un contact</span>
            </button>
          </div>

          <div className="mt-8 flex items-center justify-center gap-2 text-text-secondary text-sm">
            <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor">
              <path d="M13 7h-1V5c0-2.21-1.79-4-4-4S4 2.79 4 5v2H3c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm-5 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H4.9V5c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
            <span>Appels chiffrés de bout en bout</span>
          </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal de sélection de contact */}
      {showContactsModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-md bg-bg-surface rounded-3xl flex flex-col max-h-[80vh]">
            <div className="px-6 py-4 border-b border-bg-hover flex items-center justify-between">
              <h2 className="text-xl font-semibold text-text-primary">Appeler un contact</h2>
              <button
                onClick={() => setShowContactsModal(false)}
                className="w-8 h-8 rounded-full hover:bg-bg-hover flex items-center justify-center transition-colors text-text-secondary"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {contacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                  <Phone size={48} className="text-[#3b4a54] mb-3" />
                  <p className="text-text-secondary mb-4">Aucun contact disponible</p>
                  <button
                    onClick={() => {
                      setShowContactsModal(false)
                      navigate('/contacts')
                    }}
                    className="px-6 py-2 rounded-2xl bg-accent hover:bg-[#5a5ec9] text-white font-medium transition-colors"
                  >
                    Ajouter des contacts
                  </button>
                </div>
              ) : (
                contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="px-6 py-3 cursor-pointer hover:bg-bg-hover transition-colors"
                    onClick={() => handleCallContact(contact.contact_user_id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold">
                        {contact.profile.username[0].toUpperCase()}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <h3 className="text-text-primary font-normal truncate">
                          {contact.profile.display_name || contact.profile.username}
                        </h3>
                        <p className="text-sm text-text-secondary truncate">
                          @{contact.profile.username}
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCallContact(contact.contact_user_id, false)
                          }}
                          className="w-10 h-10 rounded-full hover:bg-bg-surface flex items-center justify-center transition-colors"
                        >
                          <Phone size={20} className="text-accent" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCallContact(contact.contact_user_id, true)
                          }}
                          className="w-10 h-10 rounded-full hover:bg-bg-surface flex items-center justify-center transition-colors"
                        >
                          <Video size={20} className="text-accent" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Écran d'appel */}
      {(isInCall || isRinging || isCalling) && (
        <CallScreen
          isInCall={isInCall}
          isRinging={isRinging}
          isCalling={isCalling}
          localStream={localStream}
          remoteStream={remoteStream}
          audioEnabled={audioEnabled}
          videoEnabled={videoEnabled}
          callerName={callerName}
          callerAvatar={callerAvatar}
          isVideoCall={localStream?.getVideoTracks().length > 0 || false}
          onAnswer={answerCall}
          onReject={rejectCall}
          onEnd={endCall}
          onToggleAudio={toggleAudio}
          onToggleVideo={toggleVideo}
        />
      )}

      {/* Menu contextuel pour les appels */}
      {contextMenuCall && contextMenuPosition && (
        <>
          {/* Overlay pour fermer le menu */}
          <div
            className="fixed inset-0 z-40"
            onClick={handleCloseContextMenu}
          />
          
          {/* Menu contextuel */}
          <div
            className="fixed z-50 bg-bg-hover rounded-lg shadow-xl py-2 min-w-[200px]"
            style={{
              left: `${contextMenuPosition.x}px`,
              top: `${contextMenuPosition.y}px`,
            }}
          >
            {/* Option Effacer */}
            <button
              onClick={() => handleDeleteCall(contextMenuCall.id)}
              className="w-full px-4 py-3 text-left hover:bg-bg-surface flex items-center gap-3 text-text-primary transition-colors"
            >
              <Trash2 size={20} />
              <span>Effacer</span>
            </button>
            
            {/* Séparateur */}
            <div className="h-px bg-bg-surface my-1" />
            
            {/* Option Appel vocal */}
            <button
              onClick={() => handleCallFromContextMenu(false)}
              className="w-full px-4 py-3 text-left hover:bg-bg-surface flex items-center gap-3 text-text-primary transition-colors"
            >
              <Phone size={20} />
              <span>Appel vocal</span>
            </button>
            
            {/* Option Appel vidéo */}
            <button
              onClick={() => handleCallFromContextMenu(true)}
              className="w-full px-4 py-3 text-left hover:bg-bg-surface flex items-center gap-3 text-text-primary transition-colors"
            >
              <Video size={20} />
              <span>Appel vidéo</span>
            </button>
          </div>
        </>
      )}
    </MainLayout>
  )
}