-- Migration: Create or update call_logs table
-- Description: Crée ou met à jour la table call_logs pour l'historique des appels
-- Date: 2025-11-30

-- Supprimer la table existante si elle existe (pour repartir de zéro)
DROP TABLE IF EXISTS public.call_logs CASCADE;

-- Créer la table call_logs
CREATE TABLE public.call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  caller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  callee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('audio', 'video')),
  status TEXT NOT NULL CHECK (status IN ('initiated', 'answered', 'missed', 'rejected', 'ended')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration INTEGER, -- en secondes
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_call_logs_conversation 
ON public.call_logs(conversation_id);

CREATE INDEX IF NOT EXISTS idx_call_logs_caller 
ON public.call_logs(caller_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_logs_callee 
ON public.call_logs(callee_id, started_at DESC);

-- RLS Policies (ultra permissives pour debug)
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_logs_all" ON public.call_logs;
CREATE POLICY "call_logs_all" ON public.call_logs 
FOR ALL TO authenticated 
USING (true) 
WITH CHECK (true);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_logs;