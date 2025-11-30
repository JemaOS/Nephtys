-- Migration: create_statuses_table
-- Created at: 1764462231

-- Statuts / Stories (24h)
CREATE TABLE statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type TEXT NOT NULL DEFAULT 'image' CHECK (type IN ('text', 'image', 'video')),
  content TEXT,
  media_url TEXT,
  background_color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  views_count INTEGER DEFAULT 0,
  is_private BOOLEAN DEFAULT false
);

-- RLS policies
ALTER TABLE statuses ENABLE ROW LEVEL SECURITY;

-- Users can see public statuses from their contacts or their own
CREATE POLICY "Users see visible statuses" 
  ON statuses FOR SELECT 
  USING (
    (auth.uid() = user_id) OR
    (NOT is_private AND expires_at > NOW() AND
     EXISTS (
       SELECT 1 FROM contacts 
       WHERE user_id = statuses.user_id 
       AND contact_user_id = auth.uid()
     ))
  );

-- Users can create their own statuses
CREATE POLICY "Users create statuses" 
  ON statuses FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own statuses
CREATE POLICY "Users update own statuses" 
  ON statuses FOR UPDATE 
  USING (auth.uid() = user_id);

-- Users can delete their own statuses
CREATE POLICY "Users delete own statuses" 
  ON statuses FOR DELETE 
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_statuses_user ON statuses(user_id);
CREATE INDEX idx_statuses_active ON statuses(expires_at) WHERE expires_at > NOW();
CREATE INDEX idx_statuses_created ON statuses(created_at DESC);;