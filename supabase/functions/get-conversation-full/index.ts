// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// Supabase Edge Function: get-conversation-full
// Batch loads all conversation data in a single call to replace 4-7 sequential queries
// Returns: conversation metadata, messages (with sender profiles), participants/profiles, other_user

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'false'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { conversation_id, limit = 50, before_message_id } = await req.json();

    if (!conversation_id) {
      throw new Error('conversation_id requis');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Configuration Supabase manquante');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Authorization header requis');
    }

    // Get user from auth token
    const userId = await getAuthUser(supabaseUrl, supabaseServiceKey, authHeader);

    // Execute all queries in parallel for maximum performance
    const [
      conversation,
      members,
      messages,
      otherUser
    ] = await Promise.all([
      fetchConversationData(supabaseUrl, supabaseServiceKey, conversation_id),
      fetchMembersData(supabaseUrl, supabaseServiceKey, conversation_id),
      fetchMessagesData(supabaseUrl, supabaseServiceKey, conversation_id, limit, before_message_id),
      fetchOtherUserData(supabaseUrl, supabaseServiceKey, conversation_id, userId)
    ]);

    // Extract unique profile IDs from messages for batch profile loading
    const senderIds = [...new Set(messages.map((m: any) => m.sender_id))];
    const memberUserIds = members.map((m: any) => m.user_id);
    const allUserIds = [...new Set([...senderIds, ...memberUserIds])];

    // Batch load all profiles needed
    const profilesMap = await fetchProfilesData(supabaseUrl, supabaseServiceKey, allUserIds);

    // Enrich messages with sender profiles from the map
    const enrichedMessages = messages.map((message: any) => ({
      ...message,
      sender: message.sender_id && profilesMap.has(message.sender_id) 
        ? profilesMap.get(message.sender_id) 
        : (message.sender || null)
    }));

    // Enrich members with profiles from the map
    const enrichedMembers = members.map((member: any) => ({
      ...member,
      profile: member.user_id && profilesMap.has(member.user_id)
        ? profilesMap.get(member.user_id)
        : (member.profile || null)
    }));

    return new Response(JSON.stringify({
      data: {
        conversation,
        messages: enrichedMessages,
        members: enrichedMembers,
        other_user: otherUser,
        // Include profiles map for client-side caching
        profiles: Array.from(profilesMap.values())
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Erreur get-conversation-full:', error);

    const errorResponse = {
      error: {
        code: 'GET_CONVERSATION_ERROR',
        message: error.message || 'Unknown error'
      }
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function getAuthUser(supabaseUrl: string, supabaseServiceKey: string, authHeader: string) {
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      'Authorization': authHeader,
      'apikey': supabaseServiceKey
    }
  });

  if (!userResponse.ok) {
    throw new Error('Authentification invalide');
  }

  const userData = await userResponse.json();
  return userData.id;
}

async function fetchConversationData(supabaseUrl: string, supabaseServiceKey: string, conversation_id: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/conversations?id=eq.${conversation_id}&select=*`, {
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'apikey': supabaseServiceKey,
      'Content-Type': 'application/json'
    }
  });

  if (response.ok) {
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      return data[0];
    }
  }
  return null;
}

async function fetchMembersData(supabaseUrl: string, supabaseServiceKey: string, conversation_id: string) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/conversation_members?conversation_id=eq.${conversation_id}&select=*,profile:profiles(id,username,display_name,avatar_url,bio,session_id,public_key,created_at,updated_at)`,
    {
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'apikey': supabaseServiceKey,
        'Content-Type': 'application/json'
      }
    }
  );

  if (response.ok) {
    const data = await response.json();
    if (Array.isArray(data)) {
      return data.map((m: any) => ({
        id: m.id,
        conversation_id: m.conversation_id,
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        last_read_at: m.last_read_at,
        is_active: m.is_active,
        profile: m.profile
      }));
    }
  }
  return [];
}

async function fetchMessagesData(supabaseUrl: string, supabaseServiceKey: string, conversation_id: string, limit: number, before_message_id?: string) {
  let messagesUrl = `${supabaseUrl}/rest/v1/messages?conversation_id=eq.${conversation_id}&select=*,sender:profiles(id,username,display_name,avatar_url,bio,session_id,public_key,created_at,updated_at)&order=created_at.desc&limit=${limit}`;
  
  if (before_message_id) {
    messagesUrl += `&created_at.lt=(select created_at from messages where id='${before_message_id}')`;
  }

  const response = await fetch(messagesUrl, {
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'apikey': supabaseServiceKey,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function fetchOtherUserData(supabaseUrl: string, supabaseServiceKey: string, conversation_id: string, userId: string) {
  // First get the conversation type
  const convResponse = await fetch(
    `${supabaseUrl}/rest/v1/conversations?id=eq.${conversation_id}&select=type`,
    {
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'apikey': supabaseServiceKey,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!convResponse.ok) {
    return null;
  }

  const convData = await convResponse.json();
  if (!Array.isArray(convData) || convData.length === 0) {
    return null;
  }

  const convType = convData[0].type;

  if (convType === 'direct') {
    // For direct messages, find the other member
    const membersResponse = await fetch(
      `${supabaseUrl}/rest/v1/conversation_members?conversation_id=eq.${conversation_id}&user_id=neq.${userId}&select=profile:profiles(id,username,display_name,avatar_url,bio,session_id,public_key,created_at,updated_at)`,
      {
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'apikey': supabaseServiceKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!membersResponse.ok) {
      return null;
    }

    const membersData = await membersResponse.json();
    if (Array.isArray(membersData) && membersData.length > 0) {
      return membersData[0].profile;
    }
  }

  return null;
}

async function fetchProfilesData(supabaseUrl: string, supabaseServiceKey: string, userIds: string[]) {
  const profilesMap = new Map();
  
  if (userIds.length > 0) {
    const userIdList = userIds.map((id: string) => `"${id}"`).join(',');
    const profilesResponse = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=in.(${userIdList})&select=id,username,display_name,avatar_url,bio,session_id,public_key,created_at,updated_at`,
      {
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'apikey': supabaseServiceKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (profilesResponse.ok) {
      const profilesData = await profilesResponse.json();
      if (Array.isArray(profilesData)) {
        profilesData.forEach((profile: any) => {
          profilesMap.set(profile.id, profile);
        });
      }
    }
  }
  
  return profilesMap;
}
