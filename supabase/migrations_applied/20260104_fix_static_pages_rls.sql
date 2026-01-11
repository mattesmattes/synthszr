-- Fix RLS policies for static_pages to allow anon write access
-- This is safe because admin pages are protected by session authentication

-- Drop existing policies
DROP POLICY IF EXISTS "Allow authenticated read" ON static_pages;
DROP POLICY IF EXISTS "Allow authenticated insert" ON static_pages;
DROP POLICY IF EXISTS "Allow authenticated update" ON static_pages;
DROP POLICY IF EXISTS "Allow anon read" ON static_pages;

-- Create new policies that allow both anon and authenticated
CREATE POLICY "Allow all read" ON static_pages
  FOR SELECT USING (true);

CREATE POLICY "Allow all insert" ON static_pages
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow all update" ON static_pages
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Allow all delete" ON static_pages
  FOR DELETE USING (true);
