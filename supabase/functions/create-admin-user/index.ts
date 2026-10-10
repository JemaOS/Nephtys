// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Edge Function `create-admin-user` — DÉSACTIVÉE PAR DÉFAUT.
 *
 * ⚠️ Audit sécurité (attacker review, 2026-10-10) : l'ancienne version créait des
 * comptes confirmés avec la clé service_role SANS vérifier que l'appelant est
 * administrateur. Déployée publiquement, et la clé anon (publique, dans le
 * bundle client) étant un JWT valide, n'importe qui pouvait appeler l'endpoint
 * et fabriquer des comptes (en choisissant `role`).
 *
 * Correctif : la fonction n'agit que si un secret d'amorçage est fourni via
 * l'en-tête `x-admin-secret` ET configuré côté serveur (ADMIN_BOOTSTRAP_SECRET).
 * Par défaut (secret non configuré), toute requête est refusée (403).
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': 'null',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'false',
};

const ALLOWED_ROLES = new Set(['authenticated']);

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED' } }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Autorisation : secret d'amorçage obligatoire ────────────────────
  const bootstrapSecret = Deno.env.get('ADMIN_BOOTSTRAP_SECRET');
  const provided = req.headers.get('x-admin-secret') ?? '';
  if (!bootstrapSecret || !constantTimeEqual(provided, bootstrapSecret)) {
    return new Response(JSON.stringify({
      error: { code: 'FORBIDDEN', message: 'Not authorized' },
    }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { email, password, role = 'authenticated' } = await req.json();

    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return new Response(JSON.stringify({
        error: { code: 'MISSING_PARAMS', message: 'Email and password are required' },
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!ALLOWED_ROLES.has(role)) {
      return new Response(JSON.stringify({
        error: { code: 'INVALID_ROLE', message: 'Role not allowed' },
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!serviceRoleKey || !supabaseUrl) {
      return new Response(JSON.stringify({
        error: { code: 'CONFIG_ERROR', message: 'Missing Supabase configuration' },
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Création via l'Admin API (source de vérité : auth.users + hash géré par GoTrue)
    const adminResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { role },
      }),
    });

    if (!adminResponse.ok) {
      return new Response(JSON.stringify({
        error: { code: 'USER_CREATION_FAILED', message: 'Failed to create user' },
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userData = await adminResponse.json();
    return new Response(JSON.stringify({
      success: true,
      user: { id: userData.id, email: userData.email, created_at: userData.created_at },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[create-admin-user] error:', (error as Error)?.message);
    return new Response(JSON.stringify({
      error: { code: 'FUNCTION_ERROR', message: 'Internal error' },
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
