// Edge Function : purge de rétention « type WhatsApp ».
//
// Supprime DÉFINITIVEMENT du serveur les messages DÉJÀ PRIS EN CHARGE par le
// destinataire — c'est-à-dire LIVRÉS (`status = 'delivered'`) ou LUS
// (`status = 'read'`) — et plus anciens qu'un délai de grâce, ainsi que leurs
// objets médias du bucket privé (comme WhatsApp efface le média une fois
// téléchargé). Les clients conservent leurs copies locales (historique durable
// IndexedDB) : le serveur n'est qu'une boîte aux lettres et ne garde donc plus
// rien de l'historique ancien.
//
// Déclenchée par pg_cron (voir migration 20260711_retention_purge_schedule.sql).
// Idempotente : peut être appelée plusieurs fois sans effet de bord.

import { createClient } from 'jsr:@supabase/supabase-js@2'

// Délai de grâce avant purge, en secondes. Défaut « façon WhatsApp » : 24 h
// (86400) — un message livré/lu n'a plus besoin de rester sur le serveur au-delà
// d'une journée. Surchargeable via l'env PURGE_GRACE_SECONDS (ex. 7 j = 604800).
const GRACE_SECONDS = Number(Deno.env.get('PURGE_GRACE_SECONDS') ?? 86400)
const BATCH = 200
const MAX_BATCHES = 25 // borne : max 5000 messages par exécution

// Jeton partagé avec le job pg_cron. Sans lui, n'importe quel porteur de la clé
// anon (publique) pouvait déclencher une purge destructive.
//
// ⚠️ Le jeton est DÉSORMAIS OBLIGATOIRE (via l'env PURGE_CRON_TOKEN) : il n'y a
// PLUS de valeur de repli codée en dur (l'ancien fallback rendait le secret
// public et inopérant). Si l'env est absent, la fonction refuse de s'exécuter
// (fail closed, 500) au lieu d'accepter un jeton connu de tous.
const CRON_TOKEN = Deno.env.get('PURGE_CRON_TOKEN')

/** Comparaison à temps constant (évite les fuites par timing sur le jeton). */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a)
  const bb = new TextEncoder().encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  // Fail closed si le secret partagé n'est pas configuré côté environnement.
  if (!CRON_TOKEN) {
    console.error('[purge-relayed] PURGE_CRON_TOKEN manquant : refus (fail closed)')
    return json({ ok: false, error: 'server misconfigured' }, 500)
  }
  const provided = req.headers.get('x-purge-token') ?? ''
  if (!timingSafeEqual(provided, CRON_TOKEN)) {
    return json({ ok: false, error: 'forbidden' }, 403)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRole) {
    return json({ ok: false, error: 'missing env' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const cutoff = new Date(Date.now() - GRACE_SECONDS * 1000).toISOString()
  let removedMessages = 0
  let removedObjects = 0

  for (let i = 0; i < MAX_BATCHES; i++) {
    const { data: msgs, error } = await supabase
      .from('messages')
      .select('id, media_url')
      .in('status', ['delivered', 'read'])
      .lt('created_at', cutoff)
      .limit(BATCH)

    if (error) return json({ ok: false, error: error.message }, 500)
    if (!msgs || msgs.length === 0) break

    // 1. Suppression des objets médias (API Storage : supprime réellement le
    //    fichier, contrairement à un DELETE SQL sur storage.objects).
    const paths = msgs
      .map(m => m.media_url)
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
    if (paths.length > 0) {
      const { error: rmErr } = await supabase.storage.from('media').remove(paths)
      if (rmErr) console.error('[purge-relayed] storage.remove failed:', rmErr)
      else removedObjects += paths.length
    }

    // 2. Suppression des lignes. Les clés texte/média, réactions,
    //    deleted_messages et authors suivent par ON DELETE CASCADE (FK
    //    `message_id ... ON DELETE CASCADE` sur message_text_keys et
    //    message_media_keys — vérifié dans les migrations).
    //
    //    NB : on NE filtre PAS sur `deleted_at` (comme avant). Un message
    //    soft-deleted côté serveur n'est qu'une pierre tombale : le client
    //    local-first en détient déjà l'état, donc le conserver n'a aucun
    //    intérêt et contredirait « le serveur ne garde rien ». On purge donc
    //    aussi les tombstones livrés/lus passés le délai de grâce.
    const ids = msgs.map(m => m.id)
    const { error: delErr } = await supabase.from('messages').delete().in('id', ids)
    if (delErr) return json({ ok: false, error: delErr.message }, 500)
    removedMessages += ids.length

    // 2bis. Ceinture et bretelles : on supprime explicitement les clés E2EE des
    //       messages traités. En temps normal le CASCADE ci-dessus les a déjà
    //       retirées (DELETE à 0 ligne, no-op) ; cette passe garantit qu'aucune
    //       clé orpheline ne subsiste si une FK venait à être modifiée.
    for (const table of ['message_text_keys', 'message_media_keys']) {
      const { error: keyErr } = await supabase.from(table).delete().in('message_id', ids)
      if (keyErr) console.error(`[purge-relayed] ${table} cleanup failed:`, keyErr)
    }

    if (msgs.length < BATCH) break
  }

  return json({ ok: true, removedMessages, removedObjects, cutoff, graceSeconds: GRACE_SECONDS })
})
