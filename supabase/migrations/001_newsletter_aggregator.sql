-- Synthszr Newsletter Aggregator Schema
-- Run this migration in Supabase SQL Editor

-- Enable UUID extension (usually already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Newsletter Sources (Whitelist)
-- ============================================
CREATE TABLE newsletter_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX idx_newsletter_sources_email ON newsletter_sources(email);
CREATE INDEX idx_newsletter_sources_enabled ON newsletter_sources(enabled) WHERE enabled = true;

-- ============================================
-- Daily Repository (Collected Content)
-- ============================================
CREATE TABLE daily_repo (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_type TEXT NOT NULL CHECK (source_type IN ('newsletter', 'article', 'pdf')),
  source_email TEXT,
  source_url TEXT,
  title TEXT,
  content TEXT,
  raw_html TEXT,
  source_language TEXT DEFAULT 'de',
  collected_at TIMESTAMPTZ DEFAULT NOW(),
  newsletter_date DATE DEFAULT CURRENT_DATE,
  processed BOOLEAN DEFAULT false,

  -- Foreign key to newsletter source (optional, for articles/PDFs linked from newsletters)
  newsletter_source_id UUID REFERENCES newsletter_sources(id) ON DELETE SET NULL
);

-- Indexes for common queries
CREATE INDEX idx_daily_repo_date ON daily_repo(newsletter_date);
CREATE INDEX idx_daily_repo_processed ON daily_repo(processed) WHERE processed = false;
CREATE INDEX idx_daily_repo_source_type ON daily_repo(source_type);

-- ============================================
-- Paywall Credentials (Encrypted)
-- ============================================
CREATE TABLE paywall_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  domain TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  cookie_data JSONB,
  notes TEXT,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_paywall_credentials_domain ON paywall_credentials(domain);

-- ============================================
-- Analysis Prompts
-- ============================================
CREATE TABLE analysis_prompts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure only one active prompt at a time
CREATE UNIQUE INDEX idx_analysis_prompts_active ON analysis_prompts(is_active) WHERE is_active = true;

-- Insert default prompt
INSERT INTO analysis_prompts (name, prompt_text, is_active) VALUES (
  'Synthzr Standard',
  'Es geht mir nicht um die wichtigsten Industrienews, sondern um die originalsten Insights für meinen eigenen Synthzr Newsletter.

Meine Kernthese ist, dass AI nicht alles effizienter macht, sondern dass die Synthese aus allen Bereichen (Marketing, Design, Business, Code etc.) zu völlig neuen Produkten und Services führen wird und die Wertschöpfung von IT- und Agenturdienstleistern komplett verändern wird.

Erstell aus allen Inhalten des Daily Repos, die hierfür relevant sind, eine ausführlich deutschsprachige Übersicht mit den wichtigsten Passagen der jeweiligen Quellen und Verlinkungen.

Falls Inhalte nicht auf Deutsch sind, übersetze die relevanten Passagen ins Deutsche.',
  true
);

-- ============================================
-- Daily Digests (Generated Analyses)
-- ============================================
CREATE TABLE daily_digests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  digest_date DATE NOT NULL,
  prompt_id UUID REFERENCES analysis_prompts(id) ON DELETE SET NULL,
  analysis_content TEXT NOT NULL,
  sources_used UUID[] DEFAULT '{}',
  word_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_daily_digests_date ON daily_digests(digest_date);

-- ============================================
-- Settings (Key-Value Store)
-- ============================================
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO settings (key, value) VALUES
  ('gmail_connected', 'false'),
  ('last_fetch', 'null'),
  ('notification_email', 'null');

-- ============================================
-- Gmail Tokens (for OAuth)
-- ============================================
CREATE TABLE gmail_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  access_token TEXT,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMPTZ,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Row Level Security (RLS)
-- ============================================
-- For now, we'll use simple password auth, so RLS is not strictly needed
-- But we set up the policies for future expansion

ALTER TABLE newsletter_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_repo ENABLE ROW LEVEL SECURITY;
ALTER TABLE paywall_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_tokens ENABLE ROW LEVEL SECURITY;

-- Service role bypass (for API calls with service key)
CREATE POLICY "Service role full access" ON newsletter_sources FOR ALL USING (true);
CREATE POLICY "Service role full access" ON daily_repo FOR ALL USING (true);
CREATE POLICY "Service role full access" ON paywall_credentials FOR ALL USING (true);
CREATE POLICY "Service role full access" ON analysis_prompts FOR ALL USING (true);
CREATE POLICY "Service role full access" ON daily_digests FOR ALL USING (true);
CREATE POLICY "Service role full access" ON settings FOR ALL USING (true);
CREATE POLICY "Service role full access" ON gmail_tokens FOR ALL USING (true);

-- ============================================
-- Helpful Views
-- ============================================

-- View: Today's unprocessed content
CREATE VIEW todays_unprocessed AS
SELECT * FROM daily_repo
WHERE newsletter_date = CURRENT_DATE
  AND processed = false
ORDER BY collected_at DESC;

-- View: Active newsletter sources
CREATE VIEW active_sources AS
SELECT * FROM newsletter_sources
WHERE enabled = true
ORDER BY name;

-- ============================================
-- Functions
-- ============================================

-- Function: Mark content as processed
CREATE OR REPLACE FUNCTION mark_as_processed(content_ids UUID[])
RETURNS void AS $$
BEGIN
  UPDATE daily_repo
  SET processed = true
  WHERE id = ANY(content_ids);
END;
$$ LANGUAGE plpgsql;

-- Function: Get content for analysis (by date range)
CREATE OR REPLACE FUNCTION get_content_for_analysis(
  start_date DATE DEFAULT CURRENT_DATE - 1,
  end_date DATE DEFAULT CURRENT_DATE
)
RETURNS SETOF daily_repo AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM daily_repo
  WHERE newsletter_date BETWEEN start_date AND end_date
    AND processed = false
  ORDER BY collected_at;
END;
$$ LANGUAGE plpgsql;
