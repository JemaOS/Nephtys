-- Migration: fix_profiles_rls_policies
-- Created at: 1764463013

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

-- Allow both anon and service_role to insert profiles (important for edge functions)
CREATE POLICY "Allow profile creation" 
  ON profiles FOR INSERT 
  WITH CHECK (auth.role() IN ('anon', 'service_role'));;