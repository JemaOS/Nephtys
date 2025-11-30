-- Migration: create_conversations_table
-- Created at: 1764462224

-- Conversations (1:1 et groupes)
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('direct', 'group')),
  name TEXT,
  avatar_url TEXT,
  description TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  is_encrypted BOOLEAN DEFAULT true,
  encryption_protocol TEXT DEFAULT 'signal'
);

-- RLS policies
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Users can see conversations they are members of
CREATE POLICY "Users see own conversations" 
  ON conversations FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM conversation_members 
      WHERE conversation_id = id 
      AND user_id = auth.uid()
    )
  );

-- Users can create conversations
CREATE POLICY "Users can create conversations" 
  ON conversations FOR INSERT 
  WITH CHECK (auth.uid() = created_by);

-- Admins can update their conversations
CREATE POLICY "Admins can update conversations" 
  ON conversations FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM conversation_members 
      WHERE conversation_id = id 
      AND user_id = auth.uid() 
      AND role = 'admin'
    )
  );

-- Indexes
CREATE INDEX idx_conversations_created_by ON conversations(created_by);
CREATE INDEX idx_conversations_updated_at ON conversations(updated_at DESC);;