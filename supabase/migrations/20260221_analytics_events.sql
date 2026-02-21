CREATE TABLE analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN ('page_view', 'stock_ticker_click', 'synthszr_vote_click', 'podcast_play')),
  path TEXT,
  company TEXT,
  session_hash TEXT,
  locale TEXT DEFAULT 'de',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analytics_events_type_created ON analytics_events(event_type, created_at DESC);
CREATE INDEX idx_analytics_events_created ON analytics_events(created_at DESC);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON analytics_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
