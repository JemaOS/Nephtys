-- Migration: create_conversation_members_table
-- Created at: 1764462225

-- Membres des conversations
CREATE TABLE conversation_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  last_read_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(conversation_id, user_id)
);

-- RLS policies
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;

-- Users can see members of their conversations
CREATE POLICY "Users see conversation members" 
  ON conversation_members FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM conversation_members cm 
      WHERE cm.conversation_id = conversation_id 
      AND cm.user_id = auth.uid()
    )
  );

-- Users can add themselves to conversations (when invited)
CREATE POLICY "Users can join conversations" 
  ON conversation_members FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Admins can add/remove members
CREATE POLICY "Admins manage members" 
  ON conversation_members FOR DELETE 
  USING (
    EXISTS (
      SELECT 1 FROM conversation_members 
      WHERE conversation_id = conversation_members.conversation_id 
      AND user_id = auth.uid() 
      AND role = 'admin'
    )
  );

-- Users can update their own membership
CREATE POLICY "Users update own membership" 
  ON conversation_members FOR UPDATE 
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_conversation_members_conversation ON conversation_members(conversation_id);
CREATE INDEX idx_conversation_members_user ON conversation_members(user_id);
CREATE INDEX idx_conversation_members_active ON conversation_members(is_active) WHERE is_active = true;;