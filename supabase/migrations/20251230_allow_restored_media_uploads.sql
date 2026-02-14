-- Allow uploads to restored/ folder for authenticated users (matching their user ID)

DO $
DECLARE
  bucket_id_val TEXT := 'media';
  folder_avatars TEXT := 'avatars';
  folder_groups TEXT := 'groups';
  folder_restored TEXT := 'restored';
BEGIN
  -- Drop existing policies (handle case where old policy names exist)
  EXECUTE format('DROP POLICY IF EXISTS "Users can upload media" ON storage.objects');
  EXECUTE format('DROP POLICY IF EXISTS "Users can update media" ON storage.objects');
  EXECUTE format('DROP POLICY IF EXISTS "Users can delete media" ON storage.objects');

  -- Also drop old policy names if they exist
  EXECUTE format('DROP POLICY IF EXISTS "Users can upload their own media" ON storage.objects');
  EXECUTE format('DROP POLICY IF EXISTS "Users can delete their own media" ON storage.objects');

  -- Policy: Users can upload media (avatars, group photos, their own files, and restored backups)
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
      OR
      (
        (storage.foldername(name))[1] = %L
        AND
        (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  )', bucket_id_val, folder_avatars, folder_groups, folder_restored);

  -- Policy: Users can update their own media, avatars, group photos, and restored backups
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
      OR
      (
        (storage.foldername(name))[1] = %L
        AND
        (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  )', bucket_id_val, folder_avatars, folder_groups, folder_restored);

  -- Policy: Users can delete their own media, avatars, group photos, and restored backups
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
      OR
      (
        (storage.foldername(name))[1] = %L
        AND
        (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  )', bucket_id_val, folder_avatars, folder_groups, folder_restored);
END $;
