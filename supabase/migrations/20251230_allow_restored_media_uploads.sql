-- Allow uploads to restored/ folder for authenticated users (matching their user ID)

-- Drop existing policies (handle case where old policy names exist)
DROP POLICY IF EXISTS "Users can upload media" ON storage.objects;
DROP POLICY IF EXISTS "Users can update media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete media" ON storage.objects;

-- Also drop old policy names if they exist
DROP POLICY IF EXISTS "Users can upload their own media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own media" ON storage.objects;

-- Policy: Users can upload media (avatars, group photos, their own files, and restored backups)
CREATE POLICY "Users can upload media"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'media'
  AND (
    (storage.foldername(name))[1] = 'avatars'
    OR
    (storage.foldername(name))[1] = 'groups'
    OR
    (storage.foldername(name))[1] = auth.uid()::text
    OR
    (
      (storage.foldername(name))[1] = 'restored'
      AND
      (storage.foldername(name))[2] = auth.uid()::text
    )
  )
);

-- Policy: Users can update their own media, avatars, group photos, and restored backups
CREATE POLICY "Users can update media"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'media'
  AND (
    (storage.foldername(name))[1] = 'avatars'
    OR
    (storage.foldername(name))[1] = 'groups'
    OR
    (storage.foldername(name))[1] = auth.uid()::text
    OR
    (
      (storage.foldername(name))[1] = 'restored'
      AND
      (storage.foldername(name))[2] = auth.uid()::text
    )
  )
);

-- Policy: Users can delete their own media, avatars, group photos, and restored backups
CREATE POLICY "Users can delete media"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'media'
  AND (
    (storage.foldername(name))[1] = 'avatars'
    OR
    (storage.foldername(name))[1] = 'groups'
    OR
    (storage.foldername(name))[1] = auth.uid()::text
    OR
    (
      (storage.foldername(name))[1] = 'restored'
      AND
      (storage.foldername(name))[2] = auth.uid()::text
    )
  )
);
