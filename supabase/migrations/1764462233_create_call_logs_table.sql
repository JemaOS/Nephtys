-- Migration: create_call_logs_table
-- Created at: 1764462233

-- Logs d'appels audio/vidéo
CREATE TABLE call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  caller_id UUID NOT NULL,
  call_type TEXT NOT NULL CHECK (call_type IN ('audio', 'video')),
  status TEXT NOT NULL CHECK (status IN ('missed', 'answered', 'declined', 'failed')),
  duration_seconds INTEGER,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  connection_type TEXT CHECK (connection_type IN ('p2p', 'turn')),
  quality_rating INTEGER CHECK (quality_rating >= 1 AND quality_rating <= 5)
);

-- RLS policies
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

-- Users can see call logs from their conversations
CREATE POLICY "Users see conversation calls" 
  ON call_logs FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM conversation_members 
      WHERE conversation_id = call_logs.conversation_id 
      AND user_id = auth.uid()
    )
  );

-- Users can create call logs
CREATE POLICY "Users create call logs" 
  ON call_logs FOR INSERT 
  WITH CHECK (auth.uid() = caller_id);

-- Users can update call logs (for duration, status)
CREATE POLICY "Users update call logs" 
  ON call_logs FOR UPDATE 
  USING (auth.uid() = caller_id);

-- Indexes
CREATE INDEX idx_call_logs_conversation ON call_logs(conversation_id, started_at DESC);
CREATE INDEX idx_call_logs_caller ON call_logs(caller_id);
CREATE INDEX idx_call_logs_status ON call_logs(status);;