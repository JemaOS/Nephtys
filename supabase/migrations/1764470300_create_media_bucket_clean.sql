-- Clean media bucket creation
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT 'media', 'media', true, 52428800, ARRAY[
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/webm'
]
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'media');

-- Policy: Users can upload their own media
DROP POLICY IF EXISTS "Users can upload their own media" ON storage.objects;
CREATE POLICY "Users can upload their own media"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy: Users can view media in their conversations
DROP POLICY IF EXISTS "Users can view media in their conversations" ON storage.objects;
CREATE POLICY "Users can view media in their conversations"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'media'
);

-- Policy: Users can delete their own media
DROP POLICY IF EXISTS "Users can delete their own media" ON storage.objects;
CREATE POLICY "Users can delete their own media"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS media_url TEXT,
ADD COLUMN IF NOT EXISTS media_type VARCHAR(10) CHECK (media_type IN ('image', 'video', 'file', 'audio')),
ADD COLUMN IF NOT EXISTS file_name TEXT,
ADD COLUMN IF NOT EXISTS file_size BIGINT;

CREATE INDEX IF NOT EXISTS idx_messages_media_type ON public.messages(media_type) WHERE media_type IS NOT NULL;
