-- Multiplicative Source Bonus
-- Changes total_score formula from additive to multiplicative:
--   OLD: base_score + source_bonus (Tier 1 +3.0 dominiert Rankings)
--   NEW: base_score * (1.0 + source_bonus/10.0) (Tier 1 = ×1.30, Tier 2 = ×1.20, Tier 3 = ×1.10)
-- Effect: A Tier 1 article with base 5.0 gets 6.5 instead of 8.0.

-- 1) Drop dependent objects
DROP VIEW IF EXISTS news_queue_selectable;
DROP INDEX IF EXISTS idx_news_queue_score;

-- 2) Recreate total_score with multiplicative formula
ALTER TABLE news_queue DROP COLUMN total_score;
ALTER TABLE news_queue ADD COLUMN total_score NUMERIC(4,1) GENERATED ALWAYS AS (
  (synthesis_score * 0.4 + relevance_score * 0.3 + uniqueness_score * 0.3)
  * (1.0 + COALESCE(source_bonus, 0) / 10.0)
) STORED;

-- 3) Recreate index
CREATE INDEX idx_news_queue_score ON news_queue(total_score DESC) WHERE status = 'pending';

-- 4) Recreate news_queue_selectable view
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
