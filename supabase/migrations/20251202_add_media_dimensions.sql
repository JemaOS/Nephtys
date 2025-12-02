-- Add media dimensions columns to messages table for better image display
-- These columns store image/video dimensions for immediate aspect ratio display

-- Add media_width column
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_width INTEGER;

-- Add media_height column  
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_height INTEGER;

-- Add media_thumbnail column for blur placeholder (base64 encoded small image)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_thumbnail TEXT;

-- Add comment for documentation
COMMENT ON COLUMN messages.media_width IS 'Width of image/video in pixels for aspect ratio calculation';
COMMENT ON COLUMN messages.media_height IS 'Height of image/video in pixels for aspect ratio calculation';
COMMENT ON COLUMN messages.media_thumbnail IS 'Base64 encoded blur placeholder for progressive image loading';