-- Filter tags for news queue article list
-- User-defined keyword filters with colors. Click to filter articles by title/excerpt match.

CREATE TABLE IF NOT EXISTS news_queue_filter_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#CCFF00',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_queue_filter_tags_sort
  ON news_queue_filter_tags (sort_order, created_at);

COMMENT ON TABLE news_queue_filter_tags IS 'Admin-managed colored filter chips for news queue article list. Filters via title/excerpt substring match.';
