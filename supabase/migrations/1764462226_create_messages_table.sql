-- Migration: create_messages_table
-- Created at: 1764462226

-- Messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  sender_id UUID NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'video', 'audio', 'file', 'call')),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read')),
  reply_to_id UUID,
  file_url TEXT,
  file_name TEXT,
  file_size INTEGER,
  encryption_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  is_pinned BOOLEAN DEFAULT false
);

-- RLS policies
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Users can read messages from their conversations
CREATE POLICY "Users read conversation messages" 
  ON messages FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM conversation_members 
      WHERE conversation_id = messages.conversation_id 
      AND user_id = auth.uid()
    )
  );

-- Users can send messages to their conversations
CREATE POLICY "Users send messages" 
  ON messages FOR INSERT 
  WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM conversation_members 
      WHERE conversation_id = messages.conversation_id 
      AND user_id = auth.uid()
      AND is_active = true
    )
  );

-- Users can update their own messages
CREATE POLICY "Users update own messages" 
  ON messages FOR UPDATE 
  USING (auth.uid() = sender_id);

-- Users can soft delete their own messages
CREATE POLICY "Users delete own messages" 
  ON messages FOR DELETE 
  USING (auth.uid() = sender_id);

-- Indexes
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_not_deleted ON messages(deleted_at) WHERE deleted_at IS NULL;;