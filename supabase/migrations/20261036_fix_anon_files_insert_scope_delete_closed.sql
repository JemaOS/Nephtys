-- ============================================================================
-- 2026-10-36 — Storage `anon_files` : INSERT resserré, DELETE fermé
-- ============================================================================
-- FAILLE (audit sec24, item #2) : le bucket `anon_files` conservait deux
-- policies bucket-wide (20261028_storage_anon_files_close_enumeration.sql:57-65) :
--   • anon_files_insert  WITH CHECK (bucket_id = 'anon_files')   → tout
--     authentifié peut écrire/ÉCRASER n'importe quel objet du bucket ;
--   • anon_files_delete  USING (bucket_id = 'anon_files')        → tout
--     authentifié peut SUPPRIMER n'importe quel objet du bucket.
--
-- CONTEXTE (vérifié) : les chemins sont `<préfixe aléatoire>/<index>`
-- (src/lib/relay/fileTransfer.ts:219,229) où le préfixe (12 octets base64url,
-- PREFIX_RE = /^[A-Za-z0-9_-]{8,}$/) est lui-même le secret « capacité »,
-- transmis hors-bande via le canal privé chiffré. Aucun owner n'est encodé
-- dans le chemin → un scope par `foldername[1] = auth.uid()` est IMPOSSIBLE.
--
-- ── CE QUE FAIT CETTE MIGRATION ────────────────────────────────────────────
--   1. bucket `anon_files` PRIVÉ (idempotent) ;
--   2. SELECT bucket-wide : maintenu SUPPRIMÉ (deny by default → fin de
--      l'énumération ; le download passe par l'edge function
--      `anon-files-download`, service_role + URL signée) ;
--   3. DELETE bucket-wide : SUPPRIMÉ (deny by default). Le client n'utilise
--      AUCUN `.remove()` sur ce bucket (vérifié : aucun `remove(...)`/
--      `delete` sur `anon_files` dans src/) → aucune casse applicative.
--      La suppression d'un objet devra passer par une edge function
--      `anon-files-delete` validant la capacité (service_role), hors périmètre
--      SQL (spec en fin de fichier) ;
--   4. INSERT : RESSERRÉ à la convention de capacité — le premier segment doit
--      être un préfixe opaque `[A-Za-z0-9_-]{8,}` et l'objet doit rester
--      `<préfixe>/<chunk>` (un seul segment de dossier). Cela interdit les
--      chemins forgés profonds et n'accepte que la forme réellement produite
--      par le client.
--
-- ── LIMITE ASSUMÉE (documentée) ────────────────────────────────────────────
-- INSERT reste, par nature, non scopable à un owner (le préfixe EST la
-- capacité et n'est relié à aucun compte côté serveur). La garantie repose sur :
--   • l'absence de SELECT/listing (on ne peut pas DÉCOUVRIR un préfixe) ;
--   • le fait qu'écrire suppose de connaître le préfixe exact = la capacité ;
--   • `upsert: false` côté client (aucun écrasement du pair légitime).
-- La fermeture COMPLÈTE (anti-épuisement/anti-écrasement par le détenteur de
-- la capacité) exige une edge function `anon-files-upload` (service_role) avec
-- rate-limit et refus d'écrasement — voir spec en fin de fichier. Le rôle
-- `authenticated` reste seul autorisé (comme avant ; le mode 100 % anonyme
-- n'écrit pas sous ce bucket).
--
-- Idempotente : DROP ... IF EXISTS puis (re)CREATE / UPDATE.
-- ============================================================================

-- 1) Bucket privé (idempotent).
insert into storage.buckets (id, name, public)
values ('anon_files', 'anon_files', false)
on conflict (id) do nothing;

update storage.buckets
set public = false
where id = 'anon_files';

-- 2) SELECT : reste fermé (deny by default) — on purge toute variante.
drop policy if exists "anon_files_select" on storage.objects;
drop policy if exists anon_files_select on storage.objects;

-- 3) DELETE : fermé (deny by default) — le client n'en a aucun usage.
drop policy if exists "anon_files_delete" on storage.objects;
drop policy if exists anon_files_delete on storage.objects;

-- 4) INSERT : resserré à la convention de capacité (`<préfixe>/<index>`).
drop policy if exists "anon_files_insert" on storage.objects;
drop policy if exists anon_files_insert on storage.objects;

create policy "anon_files_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'anon_files'
    -- Un seul segment de dossier : `<préfixe>/<chunk>`.
    and array_length(storage.foldername(name), 1) = 1
    -- Le segment doit être un préfixe opaque (PREFIX_RE client).
    and (storage.foldername(name))[1] ~ '^[A-Za-z0-9_-]{8,}$'
  );

-- ============================================================================
-- SPÉCIFICATION — Edge Function `anon-files-upload` / `anon-files-delete`
-- (À CRÉER côté supabase/functions, HORS PÉRIMÈTRE SQL)
-- ============================================================================
-- But : rendre l'écriture/la suppression du bucket `anon_files` auditables et
-- bornées sans ré-introduire de listing.
--
--   • anon-files-upload : POST { prefix, index, contentType } → URL d'upload
--     SIGNÉE (service_role, expiration courte) sur `${prefix}/${index}` avec
--     `upsert: false`. Validation : prefix ∈ PREFIX_RE, index entier borné,
--     rate-limit par utilisateur/IP. Refus si l'objet existe déjà.
--   • anon-files-delete : POST { prefix, chunks: number[] } → suppression
--     `remove()` (service_role) des seuls chemins `${prefix}/${i}` fournis
--     (préfixe = capacité). Rate-limit anti-abus.
--
-- Le rôle `anon` (mode privé anonyme) peut être admis dans ces fonctions au
-- même titre que dans `anon-files-download` : la confidentialité repose sur le
-- préfixe (capacité), jamais sur le rôle.
-- ============================================================================
