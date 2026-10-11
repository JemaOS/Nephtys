// Edge Function : purge de rétention « type WhatsApp ».
//
// Supprime DÉFINITIVEMENT du serveur les messages déjà LIVRÉS + LUS et plus
// anciens qu'un délai de grâce (par défaut 7 jours), ainsi que leurs objets
// médias du bucket privé. Les clients conservent leurs copies locales
// (historique durable IndexedDB) : le serveur ne garde donc plus rien de
// l'historique ancien.
//
// Déclenchée par pg_cron (voir migration 20260711_retention_purge_schedule.sql).
// Idempotente : peut être appelée plusieurs fois sans effet de bord.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const GRACE_SECONDS = Number(Deno.env.get('PURGE_GRACE_SECONDS') ?? 7 * 24 * 3600)
const BATCH = 200
const MAX_BATCHES = 25 // borne : max 5000 messages par exécution

// Jeton partagé avec le job pg_cron. Sans lui, n'importe quel porteur de la clé
// anon (publique) pouvait déclencher une purge destructive. À surcharger via
// l'env PURGE_CRON_TOKEN.
const CRON_TOKEN = Deno.env.get('PURGE_CRON_TOKEN') ?? 'npt_purge_7f3c9a1b5e2d4c8f'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.headers.get('x-purge-token') !== CRON_TOKEN) {
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
      .eq('status', 'read')
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

    // 2. Suppression des lignes (les clés texte/média, réactions,
    //    deleted_messages et authors suivent par ON DELETE CASCADE).
    const ids = msgs.map(m => m.id)
    const { error: delErr } = await supabase.from('messages').delete().in('id', ids)
    if (delErr) return json({ ok: false, error: delErr.message }, 500)
    removedMessages += ids.length

    if (msgs.length < BATCH) break
  }

  return json({ ok: true, removedMessages, removedObjects, cutoff, graceSeconds: GRACE_SECONDS })
})
