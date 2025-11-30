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
        const { action, username, password } = await req.json();

        if (!action || !username || !password) {
            throw new Error('Action, username et password requis');
        }

        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');

        if (!serviceRoleKey || !supabaseUrl) {
            throw new Error('Configuration Supabase manquante');
        }

        // Générer email fictif (domaine interne)
        const sanitizedUsername = username.toLowerCase().replace(/[^a-z0-9]/g, '');
        const email = `${sanitizedUsername}@anu.internal`;

        if (action === 'signup') {
            // Créer l'utilisateur avec l'API admin (pas de validation d'email stricte)
            const createUserResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email,
                    password,
                    email_confirm: true, // Auto-confirmer l'email
                    user_metadata: {
                        username
                    }
                })
            });

            if (!createUserResponse.ok) {
                const errorData = await createUserResponse.json();
                throw new Error(errorData.msg || 'Erreur création utilisateur');
            }

            const userData = await createUserResponse.json();
            const userId = userData.id;

            // Créer le profil
            const sessionId = `${username}-${Date.now()}`;
            const insertProfileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    id: userId,
                    username,
                    display_name: username,
                    session_id: sessionId
                })
            });

            if (!insertProfileResponse.ok) {
                const errorText = await insertProfileResponse.text();
                throw new Error(`Erreur création profil: ${errorText}`);
            }

            // Se connecter pour obtenir une session
            const signInResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
                method: 'POST',
                headers: {
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email,
                    password
                })
            });

            if (!signInResponse.ok) {
                const errorData = await signInResponse.json();
                throw new Error(errorData.msg || 'Erreur connexion après inscription');
            }

            const sessionData = await signInResponse.json();

            return new Response(JSON.stringify({
                data: {
                    session: sessionData,
                    user: userData
                }
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });

        } else if (action === 'signin') {
            // Connexion normale
            const signInResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
                method: 'POST',
                headers: {
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email,
                    password
                })
            });

            if (!signInResponse.ok) {
                const errorData = await signInResponse.json();
                throw new Error(errorData.error_description || errorData.msg || 'Identifiants invalides');
            }

            const sessionData = await signInResponse.json();

            return new Response(JSON.stringify({
                data: {
                    session: sessionData
                }
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });

        } else {
            throw new Error('Action invalide. Utilisez "signup" ou "signin"');
        }

    } catch (error) {
        console.error('Erreur auth:', error);

        const errorResponse = {
            error: {
                code: 'AUTH_ERROR',
                message: error.message
            }
        };

        return new Response(JSON.stringify(errorResponse), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
