import { supabase, Conversation, Profile, Message } from '@/lib/supabase'
import { ConversationWithDetails } from '@/pages/ChatsPageComponents'
import { signFieldsBatch } from '@/lib/mediaUrl'

export const fetchConversationMembers = async (userId: string) => {
  let memberData: any[] | null = null
  let memberError: any = null
  let retryCount = 0
  const maxRetries = 2
  
  while (retryCount <= maxRetries) {
    const result = await supabase
      .from('conversation_members')
      .select('conversation_id, is_pinned, is_muted, is_archived')
      .eq('user_id', userId)
    
    memberData = result.data
    memberError = result.error
    
    if (!memberError && memberData) {
      break
    }
    
    retryCount++
    if (retryCount <= maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000 * retryCount))
    }
  }

  return { memberData, memberError }
}

export const fetchConversations = async (conversationIds: string[]) => {
  return await supabase
    .from('conversations')
    .select('*')
    .in('id', conversationIds)
    .order('last_message_at', { ascending: false, nullsFirst: true })
    .order('created_at', { ascending: false })
}

export const fetchAllMembers = async (conversationIds: string[]) => {
  return await supabase
    .from('conversation_members')
    .select('conversation_id, user_id')
    .in('conversation_id', conversationIds)
}

export const fetchProfiles = async (userIds: string[]) => {
  if (userIds.length === 0) return { data: [] }
  return await supabase
    .from('profiles')
    .select('*')
    .in('id', userIds)
}

export const fetchLastMessages = async (conversationIds: string[]) => {
  return await supabase
    .from('messages')
    .select('*')
    .in('conversation_id', conversationIds)
    .is('deleted_at', null)
    .or(`ephemeral_expires_at.is.null,ephemeral_expires_at.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false })
    .limit(conversationIds.length * 10) // Increased to ensure we get last message for each conversation
}

export const fetchUnreadCounts = async (conversationIds: string[], userId: string) => {
  return await supabase
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', conversationIds)
    .neq('sender_id', userId)
    .neq('status', 'read')
    .is('deleted_at', null)
    .or(`ephemeral_expires_at.is.null,ephemeral_expires_at.gt.${new Date().toISOString()}`)
}

export interface BuildEnrichedConversationsParams {
  conversationsData: Conversation[]
  activeMembers: any[]
  savedMessagesConvIds: Set<string>
  membersByConversation: Map<string, string[]>
  profileMap: Map<string, Profile>
  lastMessageMap: Map<string, Message>
  unreadCountMap: Map<string, number>
  currentUserId: string
}

export const buildEnrichedConversations = ({
  conversationsData,
  activeMembers,
  savedMessagesConvIds,
  membersByConversation,
  profileMap,
  lastMessageMap,
  unreadCountMap,
  currentUserId,
}: BuildEnrichedConversationsParams): ConversationWithDetails[] => {
  return conversationsData.map(conv => {
    const memberInfo = activeMembers.find(m => m.conversation_id === conv.id)
    const isSavedMessages = savedMessagesConvIds.has(conv.id)
    
    let otherUserProfile: Profile | undefined
    
    if (conv.type === 'direct') {
      if (isSavedMessages) {
        otherUserProfile = profileMap.get(currentUserId)
      } else {
        const memberIds = membersByConversation.get(conv.id) || []
        const otherUserId = memberIds.find(id => id !== currentUserId)
        if (otherUserId) {
          otherUserProfile = profileMap.get(otherUserId)
        }
      }
    }
    
    return {
      ...conv,
      otherUserProfile,
      lastMessage: lastMessageMap.get(conv.id),
      unreadCount: unreadCountMap.get(conv.id) || 0,
      is_pinned: memberInfo?.is_pinned || false,
      is_muted: memberInfo?.is_muted || false
    }
  })
}

/**
 * Tente de récupérer toutes les données de la liste de conversations en
 * UN SEUL aller-retour via la RPC `get_user_conversations`. Si la RPC
 * n'existe pas (vieux backend) ou échoue, renvoie null et l'appelant se
 * rabat sur la version multi-requêtes.
 */
const fetchAllConversationDataViaRpc = async (
  userId: string
): Promise<ConversationWithDetails[] | null> => {
  try {
    const { data, error } = await supabase.rpc('get_user_conversations', {
      p_user_id: userId,
    })
    if (error || !data) return null

    const payload = data as {
      conversations: any[]
      memberships: any[]
      allMembers: any[]
      profiles: any[]
      lastMessages: any[]
      unreadCounts: { conversation_id: string; unread: number }[]
    }

    const conversationsData = payload.conversations as Conversation[]
    if (!conversationsData || conversationsData.length === 0) return []

    const activeMembers = payload.memberships
    const allMembers = payload.allMembers.filter((m: any) => m.user_id !== userId)
    const profiles = payload.profiles as Profile[]
    const recentMessages = payload.lastMessages as Message[]

    // Compter les "Saved Messages" (conversations à 1 seul membre = soi-même)
    const savedMessagesConvIds = new Set<string>()
    const memberCountByConv = new Map<string, number>()
    payload.allMembers.forEach((m: any) => {
      memberCountByConv.set(m.conversation_id, (memberCountByConv.get(m.conversation_id) || 0) + 1)
    })
    memberCountByConv.forEach((count, convId) => {
      if (count === 1) savedMessagesConvIds.add(convId)
    })

    // Signing en parallèle (bucket privé)
    await Promise.all([
      signFieldsBatch(profiles as any[] ?? null, ['avatar_url']),
      signFieldsBatch(conversationsData as any[], ['avatar_url']),
      signFieldsBatch(recentMessages as any[] | null, ['media_url', 'file_url', 'media_thumbnail']),
    ])

    const profileMap = new Map(profiles.map(p => [p.id, p]))

    const lastMessageMap = new Map<string, Message>()
    recentMessages.forEach(msg => {
      if (!lastMessageMap.has(msg.conversation_id)) lastMessageMap.set(msg.conversation_id, msg)
    })

    const unreadCountMap = new Map<string, number>()
    payload.unreadCounts.forEach(row => {
      unreadCountMap.set(row.conversation_id, row.unread)
    })

    const membersByConversation = new Map<string, string[]>()
    allMembers.forEach((m: any) => {
      const existing = membersByConversation.get(m.conversation_id) || []
      existing.push(m.user_id)
      membersByConversation.set(m.conversation_id, existing)
    })

    return buildEnrichedConversations({
      conversationsData,
      activeMembers,
      savedMessagesConvIds,
      membersByConversation,
      profileMap,
      lastMessageMap,
      unreadCountMap,
      currentUserId: userId,
    })
  } catch (e) {
    console.warn('[conversationService] RPC get_user_conversations failed, falling back:', e)
    return null
  }
}

export const fetchAllConversationData = async (userId: string) => {
  // Tentative RPC en premier (1 round-trip vs 5). Fallback automatique
  // si la fonction n'est pas déployée ou échoue.
  const rpcResult = await fetchAllConversationDataViaRpc(userId)
  if (rpcResult !== null) {
    return { enrichedConversations: rpcResult }
  }

  // Step 1: Get members
  const { memberData, memberError } = await fetchConversationMembers(userId)
  if (memberError) return { error: memberError, type: 'members' }
  if (!memberData || memberData.length === 0) return { enrichedConversations: [] }

  const activeMembers = memberData.filter(m => !m.is_archived)
  const conversationIds = activeMembers.map(m => m.conversation_id)
  if (conversationIds.length === 0) return { enrichedConversations: [] }

  // Step 2: Get conversations
  const { data: conversationsData, error: convError } = await fetchConversations(conversationIds)
  if (convError) return { error: convError, type: 'conversations' }
  if (!conversationsData || conversationsData.length === 0) return { enrichedConversations: [] }

  // Steps 3-6 en PARALLÈLE : aucune ne dépend du résultat des autres,
  // toutes ne dépendent que de `conversationIds` (déjà connu).
  // Avant : 4 round-trips séquentiels (~800ms sur 3G).
  // Après : 1 round-trip parallèle (~200ms sur 3G).
  const [
    { data: allMembersIncludingSelf },
    { data: recentMessages },
    { data: unreadData },
    // On a besoin des allMembers pour calculer les profileIds, donc on
    // récupère d'abord les members en parallèle avec les autres, puis
    // on déclenche le fetch des profiles avec leurs IDs.
  ] = await Promise.all([
    fetchAllMembers(conversationIds),
    fetchLastMessages(conversationIds),
    fetchUnreadCounts(conversationIds, userId),
  ])

  const allMembers = allMembersIncludingSelf?.filter(m => m.user_id !== userId) || []

  const savedMessagesConvIds = new Set<string>()
  const memberCountByConv = new Map<string, number>()
  allMembersIncludingSelf?.forEach(m => {
    memberCountByConv.set(m.conversation_id, (memberCountByConv.get(m.conversation_id) || 0) + 1)
  })
  memberCountByConv.forEach((count, convId) => {
    if (count === 1) savedMessagesConvIds.add(convId)
  })

  // Step 4: Get profiles (dépend de allMembers, donc post-Promise.all)
  const otherUserIds = [...new Set(allMembers?.map(m => m.user_id) || [])]
  const directConvIds = new Set(conversationsData.filter(c => c.type === 'direct').map(c => c.id))
  const directConvOtherUserIds = allMembers.filter(m => directConvIds.has(m.conversation_id)).map(m => m.user_id)
  const userIdsToFetch = [...new Set([...otherUserIds, ...directConvOtherUserIds, ...(savedMessagesConvIds.size > 0 ? [userId] : [])])]

  const { data: profiles } = await fetchProfiles(userIdsToFetch)

  // Signing des URLs en parallèle (toutes les écritures sont sur des
  // objets distincts, donc safe).
  await Promise.all([
    signFieldsBatch(profiles ?? null, ['avatar_url']),
    signFieldsBatch(conversationsData as any[], ['avatar_url']),
    signFieldsBatch(recentMessages as any[] | null, ['media_url', 'file_url', 'media_thumbnail']),
  ])

  const profileMap = new Map(profiles?.map(p => [p.id, p]) || [])

  const lastMessageMap = new Map<string, Message>()
  recentMessages?.forEach(msg => {
    if (!lastMessageMap.has(msg.conversation_id)) lastMessageMap.set(msg.conversation_id, msg)
  })

  const unreadCountMap = new Map<string, number>()
  unreadData?.forEach(msg => {
    unreadCountMap.set(msg.conversation_id, (unreadCountMap.get(msg.conversation_id) || 0) + 1)
  })

  // Step 7: Build members map
  const membersByConversation = new Map<string, string[]>()
  allMembers?.forEach(m => {
    const existing = membersByConversation.get(m.conversation_id) || []
    existing.push(m.user_id)
    membersByConversation.set(m.conversation_id, existing)
  })

  // Step 8: Build enriched conversations
  const enrichedConversations = buildEnrichedConversations({
    conversationsData,
    activeMembers,
    savedMessagesConvIds,
    membersByConversation,
    profileMap,
    lastMessageMap,
    unreadCountMap,
    currentUserId: userId,
  })

  return { enrichedConversations }
}
