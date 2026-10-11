-- ============================================================================
-- 20261012 — public.documents : RLS owner-only (deny by default)
-- ============================================================================
-- La table `public.documents` n'est PAS créée par les migrations du dépôt
-- (aucune occurrence de `CREATE TABLE ... documents`). Elle peut toutefois
-- exister sur une base déployée : 20261010_attacker_audit_rpc_and_documents.sql
-- y supposait une policy `view_authenticated_documents`
-- (TO authenticated / auth.role()='authenticated') laissant TOUT compte lire
-- TOUTES les lignes.
--
-- Ce fichier est donc DÉFENSIF et sans effet si la table est absente :
--   • si `public.documents` existe → RLS activée + policies owner-only ;
--   • la colonne propriétaire est détectée dynamiquement parmi les noms usuels
--     (user_id, owner_id, uploaded_by, created_by, owner) ;
--   • si aucune n'est trouvée → RLS activée SANS policy = deny total
--     (accès réservé au propriétaire de table / service_role).
--
-- Aucune donnée n'est modifiée ; uniquement des privilèges/policies.
-- ============================================================================

DO $mig$
DECLARE
    r           record;
    v_owner_col text;
BEGIN
    IF to_regclass('public.documents') IS NULL THEN
        RAISE NOTICE 'public.documents absent : aucune action (deny-by-default déjà garanti par l''absence de table).';
        RETURN;
    END IF;

    -- RLS activée
    EXECUTE 'ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY';

    -- Supprimer TOUTES les policies existantes (partir d'un état propre/deny)
    FOR r IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'documents'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.documents', r.policyname);
    END LOOP;

    -- Détecter la colonne propriétaire
    SELECT c.column_name::text
      INTO v_owner_col
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name   = 'documents'
       AND c.column_name::text IN ('user_id', 'owner_id', 'uploaded_by', 'created_by', 'owner')
     ORDER BY array_position(
                ARRAY['user_id', 'owner_id', 'uploaded_by', 'created_by', 'owner']::text[],
                c.column_name::text
              )
     LIMIT 1;

    IF v_owner_col IS NULL THEN
        RAISE NOTICE 'public.documents : aucune colonne propriétaire reconnue → RLS active, aucune policy (deny total).';
        RETURN;
    END IF;

    -- Policies owner-only (comparaison ::text pour tolérer text/uuid)
    EXECUTE format(
        'CREATE POLICY "documents_owner_select" ON public.documents FOR SELECT TO authenticated USING (%I::text = auth.uid()::text)',
        v_owner_col);
    EXECUTE format(
        'CREATE POLICY "documents_owner_insert" ON public.documents FOR INSERT TO authenticated WITH CHECK (%I::text = auth.uid()::text)',
        v_owner_col);
    EXECUTE format(
        'CREATE POLICY "documents_owner_update" ON public.documents FOR UPDATE TO authenticated USING (%I::text = auth.uid()::text) WITH CHECK (%I::text = auth.uid()::text)',
        v_owner_col, v_owner_col);
    EXECUTE format(
        'CREATE POLICY "documents_owner_delete" ON public.documents FOR DELETE TO authenticated USING (%I::text = auth.uid()::text)',
        v_owner_col);

    RAISE NOTICE 'public.documents : RLS + policies owner-only appliquées via colonne %.', v_owner_col;
END
$mig$;
