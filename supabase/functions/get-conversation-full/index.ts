// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// DÉSACTIVÉE (2026-10-11) — faille IDOR.
//
// Cette fonction « batch » n'est appelée par AUCUN code client. Elle validait
// seulement que l'appelant était *un* utilisateur connecté, puis lisait
// conversation/messages/membres/profils avec la clé SERVICE ROLE (qui ignore la
// RLS) SANS vérifier l'appartenance à `conversation_id` : n'importe quel compte
// authentifié pouvait donc lire n'importe quelle conversation en connaissant son
// UUID. Elle interpolait aussi des entrées non validées dans des filtres REST.
//
// Neutralisée (410 Gone). Si le chargement batch est réintroduit, la version
// corrigée doit : (1) valider `conversation_id`/`before_message_id` comme UUID,
// (2) vérifier l'appartenance via `conversation_members` avant toute requête
// service_role, (3) borner `limit`.

Deno.serve(() =>
  new Response(
    JSON.stringify({ error: { code: 'GONE', message: 'Fonction désactivée' } }),
    { status: 410, headers: { 'Content-Type': 'application/json' } },
  )
);
