import { supabase, Conversation, Profile, Message, updateLastSuccessfulQuery } from '@/lib/supabase'
import { ConversationWithDetails } from '@/pages/ChatsPageComponents'

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
      updateLastSuccessfulQuery()
      break
    }
    
    retryCount++
    if (retryCount <= maxRetries) {
      console.log(`[ChatsPage] Query failed, retrying (${retryCount}/${maxRetries})...`)
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
}

export const buildEnrichedConversations = (
  conversationsData: Conversation[],
  activeMembers: any[],
  savedMessagesConvIds: Set<string>,
  membersByConversation: Map<string, string[]>,
  profileMap: Map<string, Profile>,
  lastMessageMap: Map<string, Message>,
  unreadCountMap: Map<string, number>,
  currentUserId: string
): ConversationWithDetails[] => {
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

export const fetchAllConversationData = async (userId: string) => {
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

  // Step 3: Get all members
  const { data: allMembersIncludingSelf } = await fetchAllMembers(conversationIds)
  const allMembers = allMembersIncludingSelf?.filter(m => m.user_id !== userId) || []
  
  const savedMessagesConvIds = new Set<string>()
  const memberCountByConv = new Map<string, number>()
  allMembersIncludingSelf?.forEach(m => {
    memberCountByConv.set(m.conversation_id, (memberCountByConv.get(m.conversation_id) || 0) + 1)
  })
  memberCountByConv.forEach((count, convId) => {
    if (count === 1) savedMessagesConvIds.add(convId)
  })

  // Step 4: Get profiles
  const otherUserIds = [...new Set(allMembers?.map(m => m.user_id) || [])]
  const directConvIds = conversationsData.filter(c => c.type === 'direct').map(c => c.id)
  const directConvOtherUserIds = allMembers.filter(m => directConvIds.includes(m.conversation_id)).map(m => m.user_id)
  const userIdsToFetch = [...new Set([...otherUserIds, ...directConvOtherUserIds, ...(savedMessagesConvIds.size > 0 ? [userId] : [])])]
  
  const { data: profiles } = await fetchProfiles(userIdsToFetch)
  const profileMap = new Map(profiles?.map(p => [p.id, p]) || [])

  // Step 5: Get last messages
  const { data: recentMessages } = await fetchLastMessages(conversationIds)
  const lastMessageMap = new Map<string, Message>()
  recentMessages?.forEach(msg => {
    if (!lastMessageMap.has(msg.conversation_id)) lastMessageMap.set(msg.conversation_id, msg)
  })

  // Step 6: Get unread counts
  const { data: unreadData } = await fetchUnreadCounts(conversationIds, userId)
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
  const enrichedConversations = buildEnrichedConversations(
    conversationsData,
    activeMembers,
    savedMessagesConvIds,
    membersByConversation,
    profileMap,
    lastMessageMap,
    unreadCountMap,
    userId
  )

  return { enrichedConversations }
}
