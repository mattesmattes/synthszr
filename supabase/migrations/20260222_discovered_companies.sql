-- Discovered Companies Table
--
-- Stores companies automatically discovered from Ghostwriter {Company} tags
-- that were not found in the static KNOWN_COMPANIES / KNOWN_PREMARKET_COMPANIES lists.
--
-- type='public'    → found on Yahoo Finance with a stock ticker
-- type='premarket' → found on glitch.green premarket API

CREATE TABLE IF NOT EXISTS discovered_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('public', 'premarket')),
  ticker TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(slug)
);

CREATE INDEX IF NOT EXISTS idx_dc_type ON discovered_companies(type);
CREATE INDEX IF NOT EXISTS idx_dc_display_name ON discovered_companies(display_name);
