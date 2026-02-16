// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// Supabase Edge Function: get-conversation-full
// Batch loads all conversation data in a single call to replace 4-7 sequential queries
// Returns: conversation metadata, messages (with sender profiles), participants/profiles, other_user

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'false'
  };

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
    const userId = userData.id;

    // Execute all queries in parallel for maximum performance
    const [
      conversationResult,
      membersResult,
      messagesResult,
      otherUserResult
    ] = await Promise.all([
      // Query 1: Get conversation metadata
      fetch(`${supabaseUrl}/rest/v1/conversations?id=eq.${conversation_id}&select=*`, {
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'apikey': supabaseServiceKey,
          'Content-Type': 'application/json'
        }
      }),

      // Query 2: Get conversation members with profiles
      fetch(
        `${supabaseUrl}/rest/v1/conversation_members?conversation_id=eq.${conversation_id}&select=*,profile:profiles(id,username,display_name,avatar_url,bio,session_id,public_key,created_at,updated_at)`,
        {
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json'
          }
        }
      ),

      // Query 3: Get messages with sender profiles
      (async () => {
        let messagesUrl = `${supabaseUrl}/rest/v1/messages?conversation_id=eq.${conversation_id}&select=*,sender:profiles(id,username,display_name,avatar_url,bio,session_id,public_key,created_at,updated_at)&order=created_at.desc&limit=${limit}`;
        
        if (before_message_id) {
          // Get messages before the specified message for infinite scroll
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
          return { data: [], error: null };
        }

        const data = await response.json();
        return { data: Array.isArray(data) ? data : [], error: null };
      })(),

      // Query 4: Get other user for direct messages (find the user that is NOT the current user)
      (async () => {
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
          return { data: null, error: null };
        }

        const convData = await convResponse.json();
        if (!Array.isArray(convData) || convData.length === 0) {
          return { data: null, error: null };
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
            return { data: null, error: null };
          }

          const membersData = await membersResponse.json();
          if (Array.isArray(membersData) && membersData.length > 0) {
            return { data: membersData[0].profile, error: null };
          }
        }

        return { data: null, error: null };
      })()
    ]);

    // Process results
    let conversation = null;
    let members: any[] = [];
    let messages: any[] = [];
    let otherUser = null;

    // Parse conversation
    if (conversationResult.ok) {
      const convData = await conversationResult.json();
      if (Array.isArray(convData) && convData.length > 0) {
        conversation = convData[0];
      }
    }

    // Parse members
    if (membersResult.ok) {
      const membersData = await membersResult.json();
      if (Array.isArray(membersData)) {
        // Flatten the profile data from the nested structure
        members = membersData.map((m: any) => ({
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

    // Messages are already parsed
    if (messagesResult.data) {
      messages = messagesResult.data;
    }

    // Other user for direct messages
    if (otherUserResult.data) {
      otherUser = otherUserResult.data;
    }

    // Extract unique profile IDs from messages for batch profile loading
    const senderIds = [...new Set(messages.map((m: any) => m.sender_id))];
    const memberUserIds = members.map((m: any) => m.user_id);
    const allUserIds = [...new Set([...senderIds, ...memberUserIds])];

    // Batch load all profiles needed
    let profilesMap = new Map();
    
    if (allUserIds.length > 0) {
      const profilesResponse = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=in.(${allUserIds.map((id: string) => `"${id}"`).join(',')})&select=id,username,display_name,avatar_url,bio,session_id,public_key,created_at,updated_at`,
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

  } catch (error) {
    console.error('Erreur get-conversation-full:', error);

    const errorResponse = {
      error: {
        code: 'GET_CONVERSATION_ERROR',
        message: error.message
      }
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
