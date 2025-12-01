-- Create deleted_messages table for "Delete for me" functionality
-- This table tracks which messages have been deleted locally by each user

CREATE TABLE IF NOT EXISTS deleted_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    
    -- Ensure a user can only delete a message once
    UNIQUE(message_id, user_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_deleted_messages_user_id ON deleted_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_deleted_messages_message_id ON deleted_messages(message_id);
CREATE INDEX IF NOT EXISTS idx_deleted_messages_user_message ON deleted_messages(user_id, message_id);

-- Enable Row Level Security
ALTER TABLE deleted_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own deleted messages
CREATE POLICY "Users can view their own deleted messages"
    ON deleted_messages
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Users can insert their own deleted messages
CREATE POLICY "Users can insert their own deleted messages"
    ON deleted_messages
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own deleted messages entries (to restore)
CREATE POLICY "Users can delete their own deleted messages entries"
    ON deleted_messages
    FOR DELETE
    USING (auth.uid() = user_id);

-- Comment on table
COMMENT ON TABLE deleted_messages IS 'Tracks messages that have been deleted locally by individual users (Delete for me functionality)';