-- Optimized Scoring Algorithm (COMBINED_OPT)
-- Based on backtesting 44 published posts against 9202 queue items.
-- Key insight: source publication rate is the strongest predictor (w=1.75),
-- relevance score matters (w=0.82), uniqueness score is near-zero predictive value.
--
-- Old formula: (synth*0.4 + rel*0.3 + uniq*0.3) * (1 + source_bonus/10)
-- New formula: source_pub_rate * 17.5 + relevance_score * 0.82 + synthesis_score * 0.31 + content_length_factor * 0.31
-- (source_pub_rate is 0-1, so *17.5 gives similar magnitude to relevance*0.82 at rate=0.05)

-- 1) Add source_pub_rate column (historical publication rate per source, 0.0-1.0)
ALTER TABLE news_queue ADD COLUMN IF NOT EXISTS source_pub_rate NUMERIC(4,3) DEFAULT 0;

-- 2) Add content_length column (for length-based scoring)
ALTER TABLE news_queue ADD COLUMN IF NOT EXISTS content_length INTEGER DEFAULT 0;

-- 3) Drop dependent objects
DROP VIEW IF EXISTS news_queue_selectable;
DROP INDEX IF EXISTS idx_news_queue_score;

-- 4) Recreate total_score with optimized formula
-- Weights from COMBINED_OPT backtesting: w_source=1.75, w_rel=0.82, w_uniq=~0, w_length=0.31
-- source_pub_rate is 0-1, multiplied by 10 to put it in similar range as other scores
-- content_length_factor: LEAST(content_length / 10000.0, 1.0) caps at 1.0
ALTER TABLE news_queue DROP COLUMN total_score;
ALTER TABLE news_queue ADD COLUMN total_score NUMERIC(5,2) GENERATED ALWAYS AS (
  COALESCE(source_pub_rate, 0) * 17.5
  + relevance_score * 0.82
  + synthesis_score * 0.31
  + LEAST(COALESCE(content_length, 0) / 10000.0, 1.0) * 0.31
) STORED;

-- 5) Recreate index
CREATE INDEX idx_news_queue_score ON news_queue(total_score DESC) WHERE status = 'pending';

-- 6) Recreate news_queue_selectable view
CREATE OR REPLACE VIEW news_queue_selectable AS
WITH source_stats AS (
  SELECT
    source_identifier,
    COUNT(*) FILTER (WHERE status IN ('selected', 'used')) as committed_count
  FROM news_queue
  WHERE queued_at >= NOW() - INTERVAL '2 days'
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

-- 7) Backfill source_pub_rate from historical data
-- Uses generated_posts content to find actually published queueItemIds
WITH published_items AS (
  -- Extract queueItemIds from TipTap JSON content of published posts
  SELECT DISTINCT (elem->>'queueItemId')::uuid as queue_item_id
  FROM generated_posts,
    LATERAL jsonb_array_elements(
      CASE jsonb_typeof(content::jsonb)
        WHEN 'object' THEN content::jsonb->'content'
        WHEN 'array' THEN content::jsonb
        ELSE '[]'::jsonb
      END
    ) AS elem
  WHERE status = 'published'
    AND elem->>'type' = 'heading'
    AND elem->'attrs'->>'queueItemId' IS NOT NULL
    AND elem->'attrs'->>'queueItemId' != 'null'
),
source_rates AS (
  SELECT
    nq.source_identifier,
    COUNT(*) as total_items,
    COUNT(pi.queue_item_id) as published_items,
    CASE WHEN COUNT(*) > 0
      THEN COUNT(pi.queue_item_id)::numeric / COUNT(*)
      ELSE 0
    END as pub_rate
  FROM news_queue nq
  LEFT JOIN published_items pi ON nq.id = pi.queue_item_id
  GROUP BY nq.source_identifier
)
UPDATE news_queue nq
SET source_pub_rate = sr.pub_rate
FROM source_rates sr
WHERE nq.source_identifier = sr.source_identifier;

-- 8) Backfill content_length from existing content column
UPDATE news_queue
SET content_length = COALESCE(LENGTH(content), 0)
WHERE content_length = 0 OR content_length IS NULL;
