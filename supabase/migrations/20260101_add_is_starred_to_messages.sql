-- Migration: Add is_starred column to messages table
-- This column tracks whether a message has been marked as important/starred by the user

ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_starred BOOLEAN DEFAULT FALSE;

-- Create an index for faster queries on starred messages
CREATE INDEX IF NOT EXISTS idx_messages_is_starred ON messages(is_starred) WHERE is_starred = TRUE;