// DÉSACTIVÉE (2026-10-11).
//
// Fonction « temp » non authentifiée créant des buckets PUBLICS. Neutralisée
// (410 Gone). La gestion des buckets se fait uniquement par migrations.

Deno.serve(() =>
  new Response(
    JSON.stringify({ error: { code: 'GONE', message: 'Fonction désactivée' } }),
    { status: 410, headers: { 'Content-Type': 'application/json' } },
  )
);
