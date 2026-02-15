-- Migration: Create media storage bucket
-- Description: Bucket pour stocker les images et vidéos
-- Date: 2025-11-30

DO $$
DECLARE
  bucket_id_val TEXT := 'media';
BEGIN
  -- Create media bucket if not exists
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  SELECT bucket_id_val, bucket_id_val, true, 52428800, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'video/mp4', 'video/webm', 'video/quicktime']
  WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = bucket_id_val);

  -- RLS Policies for media bucket
  EXECUTE format('DROP POLICY IF EXISTS "Users can upload their own media" ON storage.objects');
  EXECUTE format('CREATE POLICY "Users can upload their own media" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = %L AND (storage.foldername(name))[1] = auth.uid()::text)', bucket_id_val);

  EXECUTE format('DROP POLICY IF EXISTS "Users can view media in their conversations" ON storage.objects');
  EXECUTE format('CREATE POLICY "Users can view media in their conversations" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = %L)', bucket_id_val);

  EXECUTE format('DROP POLICY IF EXISTS "Users can delete their own media" ON storage.objects');
  EXECUTE format('CREATE POLICY "Users can delete their own media" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = %L AND (storage.foldername(name))[1] = auth.uid()::text)', bucket_id_val);
END $$;

-- Add columns
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_type VARCHAR(10) CHECK (media_type IN ('image', 'video', 'file'));
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_size BIGINT;

-- Create index
CREATE INDEX IF NOT EXISTS idx_messages_media_type ON public.messages(media_type) WHERE media_type IS NOT NULL;

-- Add comments
COMMENT ON COLUMN public.messages.media_url IS 'URL du média (image, vidéo, fichier)';
COMMENT ON COLUMN public.messages.media_type IS 'Type de média: image, video, file';
COMMENT ON COLUMN public.messages.file_name IS 'Nom original du fichier';
COMMENT ON COLUMN public.messages.file_size IS 'Taille du fichier en octets';
