-- Fix RLS policies for media bucket to allow avatars and group photos

DO $$
DECLARE
  bucket_id_val TEXT := 'media';
  folder_avatars TEXT := 'avatars';
  folder_groups TEXT := 'groups';
BEGIN
  -- Drop existing policies
  EXECUTE format('DROP POLICY IF EXISTS "Users can upload their own media" ON storage.objects');
  EXECUTE format('DROP POLICY IF EXISTS "Users can view media in their conversations" ON storage.objects');
  EXECUTE format('DROP POLICY IF EXISTS "Users can delete their own media" ON storage.objects');
  EXECUTE format('DROP POLICY IF EXISTS "Users can upload media" ON storage.objects');
  EXECUTE format('DROP POLICY IF EXISTS "Users can update media" ON storage.objects');
  EXECUTE format('DROP POLICY IF EXISTS "Users can delete media" ON storage.objects');
  EXECUTE format('DROP POLICY IF EXISTS "Public media access" ON storage.objects');

  -- Policy: Users can upload media (avatars, group photos, and their own files)
  EXECUTE format('CREATE POLICY "Users can upload media"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = %L
    AND (
      (storage.foldername(name))[1] = %L
      OR
      (storage.foldername(name))[1] = %L
      OR
      (storage.foldername(name))[1] = auth.uid()::text
    )
  )', bucket_id_val, folder_avatars, folder_groups);

  -- Policy: Everyone can view media (public read)
  EXECUTE format('CREATE POLICY "Public media access"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = %L)', bucket_id_val);

  -- Policy: Users can update their own media, avatars, and group photos
  EXECUTE format('CREATE POLICY "Users can update media"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = %L
    AND (
      (storage.foldername(name))[1] = %L
      OR
      (storage.foldername(name))[1] = %L
      OR
      (storage.foldername(name))[1] = auth.uid()::text
    )
  )', bucket_id_val, folder_avatars, folder_groups);

  -- Policy: Users can delete their own media, avatars, and group photos
  EXECUTE format('CREATE POLICY "Users can delete media"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = %L
    AND (
      (storage.foldername(name))[1] = %L
      OR
      (storage.foldername(name))[1] = %L
      OR
      (storage.foldername(name))[1] = auth.uid()::text
    )
  )', bucket_id_val, folder_avatars, folder_groups);
END $$;
