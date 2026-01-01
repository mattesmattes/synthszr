-- Create image_prompts table for storing image generation prompts
CREATE TABLE IF NOT EXISTS image_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for active prompt lookup
CREATE INDEX IF NOT EXISTS idx_image_prompts_active ON image_prompts(is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE image_prompts ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Allow authenticated read" ON image_prompts
  FOR SELECT TO authenticated USING (true);

-- Allow authenticated users to manage
CREATE POLICY "Allow authenticated insert" ON image_prompts
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update" ON image_prompts
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated delete" ON image_prompts
  FOR DELETE TO authenticated USING (true);

-- Allow anon to read (for public API access)
CREATE POLICY "Allow anon read" ON image_prompts
  FOR SELECT TO anon USING (true);
