-- Migration: add_link_preview_column
-- Created at: 1764471400
-- Description: Add link_preview column to messages table for storing Open Graph metadata

-- Add link_preview column to messages table
-- This column stores JSON data containing URL preview information (title, description, image, etc.)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS link_preview JSONB;

-- Add comment for documentation
COMMENT ON COLUMN messages.link_preview IS 'JSON object containing Open Graph metadata for URL previews: {url, title, description, image, siteName, domain}';