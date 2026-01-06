-- Stock-Synthszr Cache Table
-- Stores AI-generated stock analyses with 14-day TTL

CREATE TABLE IF NOT EXISTS stock_synthszr_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  data JSONB NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days') NOT NULL
);

-- Index for fast lookups by company and currency
CREATE INDEX IF NOT EXISTS idx_stock_synthszr_cache_company ON stock_synthszr_cache (company, currency);

-- Index for cleanup of expired entries
CREATE INDEX IF NOT EXISTS idx_stock_synthszr_cache_expires ON stock_synthszr_cache (expires_at);

-- Enable RLS
ALTER TABLE stock_synthszr_cache ENABLE ROW LEVEL SECURITY;

-- Public read access (cached analyses can be viewed by anyone)
CREATE POLICY "Anyone can view stock synthszr cache" ON stock_synthszr_cache FOR SELECT USING (true);

-- Only service role can insert/update/delete
CREATE POLICY "Service role can manage stock synthszr cache" ON stock_synthszr_cache FOR ALL USING (auth.role() = 'service_role');
