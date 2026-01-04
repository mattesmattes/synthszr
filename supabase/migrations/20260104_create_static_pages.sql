-- Create static_pages table for editable static content (like "Why" page)
CREATE TABLE IF NOT EXISTS static_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for slug lookup
CREATE INDEX IF NOT EXISTS idx_static_pages_slug ON static_pages(slug);

-- Enable RLS
ALTER TABLE static_pages ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to manage
CREATE POLICY "Allow authenticated read" ON static_pages
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert" ON static_pages
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update" ON static_pages
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Allow anon to read (for public page access)
CREATE POLICY "Allow anon read" ON static_pages
  FOR SELECT TO anon USING (true);

-- Insert default "why" page
INSERT INTO static_pages (slug, title, content)
VALUES (
  'why',
  'Feed the Soul. Run the System.',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Die News Synthese zum Start in den Tag."}]}]}'
)
ON CONFLICT (slug) DO NOTHING;
