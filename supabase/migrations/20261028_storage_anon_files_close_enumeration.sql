-- ============================================================================
-- 2026-10-28 — Storage `anon_files` : fermeture de l'ÉNUMÉRATION
-- ============================================================================
-- PROBLÈME (état prod vérifié) : les trois policies du bucket sont bucket-wide
-- (cf. 20261010_anon_files_bucket.sql:19-32) :
--   • anon_files_select  FOR SELECT USING (bucket_id = 'anon_files')
--   • anon_files_insert  FOR INSERT WITH CHECK (bucket_id = 'anon_files')
--   • anon_files_delete  FOR DELETE USING (bucket_id = 'anon_files')
-- Le modèle de confidentialité repose sur un PRÉFIXE ALÉATOIRE (capacité, type
-- XFTP) : le nom n'est rattaché à aucun owner, il est transmis au pair via le
-- canal chiffré. MAIS la policy SELECT bucket-wide permet à tout compte
-- authentifié de LISTER le bucket (endpoint `/object/list`) et donc de
-- DÉCOUVRIR les préfixes → la capacité n'en est plus une.
--
-- Preuve de la convention de chemin (préfixe aléatoire, non rattachable à un
-- owner) :
--   → src/lib/relay/fileTransfer.ts:148,158  `const prefix = randomPrefix()` puis
--     `.upload(\`${prefix}/${i}\`, ...)`  (randomPrefix = 12 octets base64url,
--     cf. fileTransfer.ts:131-133 ; PREFIX_RE = /^[A-Za-z0-9_-]{8,}$/ :29-30)
--   → src/lib/relay/fileTransfer.ts:181  `.download(\`${desc.prefix}/${i}\`)`
-- Un scope par owner est donc IMPOSSIBLE : on ne peut que fermer l'énumération.
--
-- ── CE QUE FAIT CETTE MIGRATION ────────────────────────────────────────────
--   1. bucket `anon_files` PRIVÉ (idempotent : couvre le cas déjà public) ;
--   2. SUPPRESSION de la policy SELECT bucket-wide → deny par défaut pour la
--      lecture directe ET le listing (fin de l'énumération) ;
--   3. INSERT/DELETE conservés (nécessaires à l'upload/cleanup ; non scopables
--      faute d'owner — le préfixe EST la capacité).
--
-- ── IMPACT ASSUMÉ (à coordonner, hors périmètre .ts) ───────────────────────
-- Le téléchargement par chemin exact (`fileTransfer.ts:181`) exige une policy
-- SELECT sur l'objet. En la supprimant, `.download()` échouera pour TOUT le
-- monde, y compris le destinataire légitime. La voie propre SANS toucher au
-- client n'existe pas côté SQL seul (aucun secret par objet n'est connu du
-- serveur). Il faut une EDGE FUNCTION de téléchargement validant la capacité
-- (spécification complète en fin de fichier et dans le rapport). Le client
-- (fileTransfer.ts, autre agent) devra appeler cette fonction au lieu de
-- `supabase.storage.from('anon_files').download(...)`.
-- ============================================================================

-- 1) Bucket privé (idempotent, même s'il existe déjà).
insert into storage.buckets (id, name, public)
values ('anon_files', 'anon_files', false)
on conflict (id) do nothing;

update storage.buckets
set public = false
where id = 'anon_files';

-- 2) Fermer l'énumération : plus de SELECT bucket-wide (deny by default).
--    On supprime aussi les variantes pour un run idempotent.
drop policy if exists "anon_files_select" on storage.objects;
drop policy if exists anon_files_select on storage.objects;

-- 3) INSERT/DELETE : inchangés volontairement (préfixe opaque = capacité, pas
--    d'owner). Documentés ici pour l'audit ; recréés en idempotent au cas où.
drop policy if exists "anon_files_insert" on storage.objects;
create policy "anon_files_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'anon_files');

drop policy if exists "anon_files_delete" on storage.objects;
create policy "anon_files_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'anon_files');

-- ============================================================================
-- SPÉCIFICATION — Edge Function `anon-files-download` (À CRÉER côté functions)
-- ============================================================================
-- Rôle : remplacer la lecture directe, sans ré-introduire de listing. La
-- capacité (= préfixe aléatoire, ≥ 96 bits, non devinable) reste le secret.
--
-- Route      : POST /functions/v1/anon-files-download
-- Auth       : JWT Supabase requis (rôle authenticated) — le destinataire est
--              un utilisateur connecté.
-- Body JSON  : { "prefix": string, "chunks": number[] }
--              (ou { "prefix": string, "chunk": number } pour un chunk seul)
-- Réponse    : 200 { "chunks": [{ "index": n, "url": "<signed-url>" }] }
--              400 préfixe/index invalide ; 401 non authentifié ; 404 objet
--              absent ; 429 rate-limit.
--
-- Validation (obligatoire) :
--   • prefix match /^[A-Za-z0-9_-]{8,}$/            (cf. PREFIX_RE client)
--   • chaque index entier, 0 <= index < 100000      (cf. FILE_MAX_CHUNKS)
--   • longueur de `chunks` bornée (ex. <= 256 par appel, pagination sinon)
--   • rate-limit par utilisateur (anti-énumération/brute-force de préfixe)
--
-- Implémentation recommandée : client service_role (bypass RLS), pour chaque
-- index `createSignedUrl(\`${prefix}/${index}\`, 60)` sur le bucket
-- `anon_files`. Le client télécharge l'URL signée puis déchiffre (la clé AES
-- vient du descripteur, jamais du serveur). Alternative équivalente : streamer
-- le ciphertext (content-type application/octet-stream) au lieu d'une URL.
--
-- Pourquoi ça ne ré-ouvre pas l'énumération : la fonction n'expose aucun
-- listing ; une URL signée n'est produite que si l'appelant fournit un préfixe
-- EXACT. Sans le préfixe (transmis hors-bande, chiffré, via le canal privé),
-- aucune découverte n'est possible.
-- ============================================================================
