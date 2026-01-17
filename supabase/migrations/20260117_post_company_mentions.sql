-- Create post_company_mentions table to track which companies are mentioned in which posts
-- This enables the /companies page to show company listings with news counts

CREATE TABLE post_company_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES generated_posts(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  company_slug TEXT NOT NULL,
  company_type TEXT NOT NULL CHECK (company_type IN ('public', 'premarket')),
  ticker TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, company_slug)
);

-- Index for fast lookups by company (for company detail pages and aggregation)
CREATE INDEX idx_pcm_company ON post_company_mentions(company_slug);

-- Index for fast lookups by post (for cascade deletes and post queries)
CREATE INDEX idx_pcm_post ON post_company_mentions(post_id);

-- Comment on table for documentation
COMMENT ON TABLE post_company_mentions IS 'Tracks which companies are mentioned in which blog posts. Used for /companies page.';
