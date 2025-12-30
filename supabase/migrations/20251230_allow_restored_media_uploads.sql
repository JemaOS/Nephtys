-- Allow uploads to restored/ folder for authenticated users (matching their user ID)

-- Drop existing policies to recreate them with updated logic
DROP POLICY IF EXISTS "Users can upload media" ON storage.objects;
DROP POLICY IF EXISTS "Users can update media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete media" ON storage.objects;

-- Policy: Users can upload media (avatars, group photos, their own files, and restored backups)
CREATE POLICY "Users can upload media"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'media'
  AND (
    -- Allow avatars folder for any authenticated user
    (storage.foldername(name))[1] = 'avatars'
    OR
    -- Allow groups folder for any authenticated user
    (storage.foldername(name))[1] = 'groups'
    OR
    -- Allow user's own folder
    (storage.foldername(name))[1] = auth.uid()::text
    OR
    -- Allow restored folder matching user ID
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
    -- Allow avatars folder
    (storage.foldername(name))[1] = 'avatars'
    OR
    -- Allow groups folder
    (storage.foldername(name))[1] = 'groups'
    OR
    -- Allow user's own folder
    (storage.foldername(name))[1] = auth.uid()::text
    OR
    -- Allow restored folder matching user ID
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
    -- Allow avatars folder
    (storage.foldername(name))[1] = 'avatars'
    OR
    -- Allow groups folder
    (storage.foldername(name))[1] = 'groups'
    OR
    -- Allow user's own folder
    (storage.foldername(name))[1] = auth.uid()::text
    OR
    -- Allow restored folder matching user ID
    (
      (storage.foldername(name))[1] = 'restored'
      AND
      (storage.foldername(name))[2] = auth.uid()::text
    )
  )
);
