-- Migration: create_contacts_table
-- Created at: 1764462228

-- Contacts
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  contact_user_id UUID NOT NULL,
  nickname TEXT,
  is_favorite BOOLEAN DEFAULT false,
  is_blocked BOOLEAN DEFAULT false,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, contact_user_id)
);

-- RLS policies
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- Users can see their own contacts
CREATE POLICY "Users see own contacts" 
  ON contacts FOR SELECT 
  USING (auth.uid() = user_id);

-- Users can add contacts
CREATE POLICY "Users add contacts" 
  ON contacts FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Users can update their contacts
CREATE POLICY "Users update contacts" 
  ON contacts FOR UPDATE 
  USING (auth.uid() = user_id);

-- Users can delete contacts
CREATE POLICY "Users delete contacts" 
  ON contacts FOR DELETE 
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_contacts_user ON contacts(user_id);
CREATE INDEX idx_contacts_contact_user ON contacts(contact_user_id);
CREATE INDEX idx_contacts_favorites ON contacts(user_id, is_favorite) WHERE is_favorite = true;;