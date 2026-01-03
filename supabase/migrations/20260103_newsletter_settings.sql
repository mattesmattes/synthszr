-- Newsletter Settings for Cron Configuration
CREATE TABLE IF NOT EXISTS newsletter_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default cron settings
INSERT INTO newsletter_settings (key, value) VALUES
  ('cron_schedule', '{"enabled": false, "hour": 9, "minute": 0}')
ON CONFLICT (key) DO NOTHING;

-- Enable RLS
ALTER TABLE newsletter_settings ENABLE ROW LEVEL SECURITY;

-- Policies: Service role can do everything
CREATE POLICY "Service role has full access to settings"
  ON newsletter_settings FOR ALL
  USING (auth.role() = 'service_role');

-- Anon can read settings (for frontend display)
CREATE POLICY "Anon can read settings"
  ON newsletter_settings FOR SELECT
  USING (true);
