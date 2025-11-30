-- Migration: create_files_table
-- Created at: 1764462229

-- Fichiers partagés
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL,
  uploader_id UUID NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT,
  thumbnail_url TEXT,
  encryption_key TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- RLS policies
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- Users can see files from their conversations
CREATE POLICY "Users see conversation files" 
  ON files FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      JOIN conversation_members cm ON m.conversation_id = cm.conversation_id
      WHERE m.id = files.message_id 
      AND cm.user_id = auth.uid()
    )
  );

-- Users can upload files
CREATE POLICY "Users upload files" 
  ON files FOR INSERT 
  WITH CHECK (auth.uid() = uploader_id);

-- Indexes
CREATE INDEX idx_files_message ON files(message_id);
CREATE INDEX idx_files_uploader ON files(uploader_id);
CREATE INDEX idx_files_type ON files(file_type);
CREATE INDEX idx_files_not_expired ON files(expires_at) WHERE expires_at IS NULL OR expires_at > NOW();;