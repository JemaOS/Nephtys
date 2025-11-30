-- Migration: create_devices_table
-- Created at: 1764462232

-- Appareils connectés
CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  device_name TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK (device_type IN ('mobile', 'desktop', 'tablet', 'web')),
  device_fingerprint TEXT NOT NULL,
  public_key TEXT,
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_verified BOOLEAN DEFAULT false,
  UNIQUE(user_id, device_fingerprint)
);

-- RLS policies
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

-- Users can see their own devices
CREATE POLICY "Users see own devices" 
  ON devices FOR SELECT 
  USING (auth.uid() = user_id);

-- Users can add devices
CREATE POLICY "Users add devices" 
  ON devices FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Users can update their devices
CREATE POLICY "Users update devices" 
  ON devices FOR UPDATE 
  USING (auth.uid() = user_id);

-- Users can delete their devices
CREATE POLICY "Users delete devices" 
  ON devices FOR DELETE 
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_devices_user ON devices(user_id);
CREATE INDEX idx_devices_last_active ON devices(last_active_at DESC);
CREATE INDEX idx_devices_verified ON devices(is_verified) WHERE is_verified = true;;