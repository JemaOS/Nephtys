// DÉSACTIVÉE (2026-10-11).
//
// Cette fonction « temp » n'était PAS authentifiée (CORS *), créait le bucket
// `media` en PUBLIC et tentait d'injecter des policies ouvertes via un RPC SQL
// arbitraire (exec_sql), annulant le durcissement « média privé ». Elle n'avait
// aucun appelant légitime → neutralisée (410 Gone). La gestion des buckets se
// fait uniquement par migrations.

Deno.serve(() =>
  new Response(
    JSON.stringify({ error: { code: 'GONE', message: 'Fonction désactivée' } }),
    { status: 410, headers: { 'Content-Type': 'application/json' } },
  )
);
