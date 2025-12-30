-- Fix missing foreign keys in conversation_members table
-- This enables PostgREST resource embedding (joins) to work correctly

ALTER TABLE conversation_members
ADD CONSTRAINT conversation_members_conversation_id_fkey
FOREIGN KEY (conversation_id)
REFERENCES conversations(id)
ON DELETE CASCADE;

ALTER TABLE conversation_members
ADD CONSTRAINT conversation_members_user_id_fkey
FOREIGN KEY (user_id)
REFERENCES auth.users(id)
ON DELETE CASCADE;
