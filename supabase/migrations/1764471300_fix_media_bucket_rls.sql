-- Fix RLS policies for media bucket to allow avatars and group photos

-- Drop existing policies
DROP POLICY IF EXISTS "Users can upload their own media" ON storage.objects;
DROP POLICY IF EXISTS "Users can view media in their conversations" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own media" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload media" ON storage.objects;
DROP POLICY IF EXISTS "Users can update media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete media" ON storage.objects;
DROP POLICY IF EXISTS "Public media access" ON storage.objects;

-- Policy: Users can upload media (avatars, group photos, and their own files)
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
  )
);

-- Policy: Everyone can view media (public read)
CREATE POLICY "Public media access"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'media');

-- Policy: Users can update their own media, avatars, and group photos
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
  )
);

-- Policy: Users can delete their own media, avatars, and group photos
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
  )
);
