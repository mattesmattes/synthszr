-- Create post_podcasts table for caching generated podcast audio
CREATE TABLE IF NOT EXISTS post_podcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL,
  locale VARCHAR(10) NOT NULL DEFAULT 'de',
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, generating, completed, failed
  audio_url TEXT,
  duration_seconds INTEGER,
  script_content TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint for post + locale combination
  UNIQUE(post_id, locale)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_post_podcasts_post_locale ON post_podcasts(post_id, locale);
CREATE INDEX IF NOT EXISTS idx_post_podcasts_status ON post_podcasts(status);

-- Enable RLS
ALTER TABLE post_podcasts ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Allow authenticated read" ON post_podcasts
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role full access
CREATE POLICY "Allow service role full access" ON post_podcasts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_post_podcasts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER post_podcasts_updated_at
  BEFORE UPDATE ON post_podcasts
  FOR EACH ROW
  EXECUTE FUNCTION update_post_podcasts_updated_at();
