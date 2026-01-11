-- News Queue for source-diversified article generation
-- Stores individual news items with scoring for Ghostwriter selection
-- Enforces max 30% from any single source in 3-day rolling window

-- Main queue table
CREATE TABLE news_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to original daily_repo item (if applicable)
  daily_repo_id UUID REFERENCES daily_repo(id) ON DELETE SET NULL,

  -- News content (denormalized for queue independence)
  title TEXT NOT NULL,
  excerpt TEXT,
  content TEXT,

  -- Source tracking for diversity enforcement
  source_identifier TEXT NOT NULL,  -- Normalized: email address or domain
  source_display_name TEXT,         -- Human-readable: "The Information", "Stratechery"
  source_url TEXT,                  -- Link to original article

  -- Scoring for prioritization
  synthesis_score NUMERIC(3,1) DEFAULT 0,  -- 0-10: How well does this connect to historical patterns?
  relevance_score NUMERIC(3,1) DEFAULT 0,  -- 0-10: How relevant to our audience?
  uniqueness_score NUMERIC(3,1) DEFAULT 0, -- 0-10: How unique vs other queue items?
  total_score NUMERIC(4,1) GENERATED ALWAYS AS (
    synthesis_score * 0.4 + relevance_score * 0.3 + uniqueness_score * 0.3
  ) STORED,

  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'selected', 'used', 'expired', 'skipped')),
  selected_at TIMESTAMPTZ,          -- When selected for article
  used_in_post_id UUID,             -- Link to generated_posts if used
  skip_reason TEXT,                 -- Why was this skipped?

  -- Timestamps
  queued_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '3 days'),

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for efficient querying
CREATE INDEX idx_news_queue_status ON news_queue(status);
CREATE INDEX idx_news_queue_expires ON news_queue(expires_at) WHERE status = 'pending';
CREATE INDEX idx_news_queue_source ON news_queue(source_identifier);
CREATE INDEX idx_news_queue_score ON news_queue(total_score DESC) WHERE status = 'pending';
CREATE INDEX idx_news_queue_queued ON news_queue(queued_at DESC);

-- Unique constraint to prevent duplicate items in queue
CREATE UNIQUE INDEX idx_news_queue_unique_item ON news_queue(daily_repo_id) WHERE daily_repo_id IS NOT NULL;

-- View: Source distribution in last 3 days (for 30% rule enforcement)
CREATE OR REPLACE VIEW news_queue_source_distribution AS
SELECT
  source_identifier,
  source_display_name,
  COUNT(*) as item_count,
  COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
  COUNT(*) FILTER (WHERE status = 'used') as used_count,
  ROUND(
    COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100,
    1
  ) as percentage_of_total
FROM news_queue
WHERE queued_at >= NOW() - INTERVAL '3 days'
  AND status IN ('pending', 'selected', 'used')
GROUP BY source_identifier, source_display_name
ORDER BY item_count DESC;

-- View: Selectable items respecting 30% source limit
CREATE OR REPLACE VIEW news_queue_selectable AS
WITH source_stats AS (
  SELECT
    source_identifier,
    COUNT(*) FILTER (WHERE status IN ('selected', 'used')) as committed_count
  FROM news_queue
  WHERE queued_at >= NOW() - INTERVAL '3 days'
  GROUP BY source_identifier
),
total_committed AS (
  SELECT COALESCE(SUM(committed_count), 0) as total
  FROM source_stats
)
SELECT
  q.*,
  COALESCE(s.committed_count, 0) as source_committed_count,
  t.total as total_committed,
  CASE
    WHEN t.total = 0 THEN true
    WHEN COALESCE(s.committed_count, 0)::numeric / GREATEST(t.total, 1) < 0.30 THEN true
    ELSE false
  END as within_source_limit
FROM news_queue q
LEFT JOIN source_stats s ON q.source_identifier = s.source_identifier
CROSS JOIN total_committed t
WHERE q.status = 'pending'
  AND q.expires_at > NOW()
ORDER BY q.total_score DESC;

-- Function: Auto-expire old queue items (called by cron)
CREATE OR REPLACE FUNCTION expire_old_queue_items()
RETURNS INTEGER AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE news_queue
  SET status = 'expired',
      skip_reason = 'Auto-expired after 3 days'
  WHERE status = 'pending'
    AND expires_at < NOW();

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$ LANGUAGE plpgsql;

-- Function: Get recommended selection with source balancing
-- Returns top N items while respecting 30% source limit
CREATE OR REPLACE FUNCTION get_balanced_queue_selection(
  max_items INTEGER DEFAULT 10,
  target_source_limit NUMERIC DEFAULT 0.30
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  source_identifier TEXT,
  source_display_name TEXT,
  total_score NUMERIC,
  selection_rank INTEGER
) AS $$
DECLARE
  selected_count INTEGER := 0;
  source_counts JSONB := '{}'::jsonb;
  item RECORD;
BEGIN
  -- Iterate through items by score, selecting until limit reached
  FOR item IN
    SELECT
      q.id,
      q.title,
      q.source_identifier,
      q.source_display_name,
      q.total_score
    FROM news_queue q
    WHERE q.status = 'pending'
      AND q.expires_at > NOW()
    ORDER BY q.total_score DESC
  LOOP
    -- Check if adding this item would exceed source limit
    DECLARE
      current_source_count INTEGER;
      source_percentage NUMERIC;
    BEGIN
      current_source_count := COALESCE((source_counts->>item.source_identifier)::INTEGER, 0);
      source_percentage := (current_source_count + 1)::numeric / (selected_count + 1)::numeric;

      -- Skip if would exceed 30% limit (unless it's the first item)
      IF selected_count > 0 AND source_percentage > target_source_limit THEN
        CONTINUE;
      END IF;

      -- Select this item
      selected_count := selected_count + 1;
      source_counts := jsonb_set(
        source_counts,
        ARRAY[item.source_identifier],
        to_jsonb(current_source_count + 1)
      );

      id := item.id;
      title := item.title;
      source_identifier := item.source_identifier;
      source_display_name := item.source_display_name;
      total_score := item.total_score;
      selection_rank := selected_count;

      RETURN NEXT;

      EXIT WHEN selected_count >= max_items;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Update daily_repo when queue item is used
CREATE OR REPLACE FUNCTION on_queue_item_used()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'used' AND NEW.daily_repo_id IS NOT NULL THEN
    UPDATE daily_repo
    SET processed = true
    WHERE id = NEW.daily_repo_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_queue_item_used
  AFTER UPDATE OF status ON news_queue
  FOR EACH ROW
  WHEN (NEW.status = 'used')
  EXECUTE FUNCTION on_queue_item_used();

-- Enable RLS
ALTER TABLE news_queue ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything
CREATE POLICY "Service role full access" ON news_queue
  FOR ALL TO service_role USING (true);

-- Policy: Anon can read (for public API if needed later)
CREATE POLICY "Anon read access" ON news_queue
  FOR SELECT TO anon USING (true);
