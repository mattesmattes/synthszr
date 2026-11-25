-- Scoring v2: calibrated against historical operator picks & published posts,
-- plus repaired 60-day Laplace-smoothed source_pub_rate (including bundles & status='used').
--
-- Formula changes vs 20260328_optimized_scoring.sql:
-- 1) Restores uniqueness_score (w=0.18) alongside relevance (w=0.68) and synthesis (w=0.24)
--    so applyNoveltyPenalty() and originality affect queue ordering again.
-- 2) Applies a 0.5x multiplier to stubs with content_length < 1000 (<0.02% historical pub rate).
-- 3) Gates source_pub_rate bonus behind relevance_score >= 4 AND synthesis_score >= 4 AND
--    content_length >= 1000, preventing sponsor/junk links from inheriting high source scores.
-- 4) Expands source_pub_rate lookback to 60 days, fixes TipTap heading attrs->queueItemId/queueItemIds[],
--    counts status='used' directly, and applies Laplace shrinkage published/(total+15) capped at 0.30.

-- 1) Drop dependent objects
DROP VIEW IF EXISTS news_queue_selectable;
DROP INDEX IF EXISTS idx_news_queue_score;

-- 2) Recreate total_score generated column with gated v2 formula
ALTER TABLE news_queue DROP COLUMN IF EXISTS total_score;
ALTER TABLE news_queue ADD COLUMN total_score NUMERIC(5,2) GENERATED ALWAYS AS (
  ROUND((
    (
      CASE WHEN COALESCE(content_length, 0) < 1000 THEN 0.5 ELSE 1.0 END
    ) * (
      COALESCE(relevance_score, 0) * 0.68
      + COALESCE(synthesis_score, 0) * 0.24
      + COALESCE(uniqueness_score, 0) * 0.18
    )
    + CASE
        WHEN COALESCE(content_length, 0) >= 1000
          THEN LEAST(COALESCE(content_length, 0) / 12000.0, 1.0) * 0.60
        ELSE 0
      END
    + CASE
        WHEN COALESCE(relevance_score, 0) >= 4
         AND COALESCE(synthesis_score, 0) >= 4
         AND COALESCE(content_length, 0) >= 1000
          THEN LEAST(COALESCE(source_pub_rate, 0), 0.30) * 15.0
        ELSE 0
      END
  )::numeric, 2)
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

-- 5) Backfill missing content_length values
UPDATE news_queue
SET content_length = COALESCE(LENGTH(content), 0)
WHERE content_length = 0 OR content_length IS NULL;

-- 6) Backfill Laplace-smoothed 60-day source_pub_rate across all sources
WITH heading_nodes AS (
  SELECT elem->'attrs' AS attrs
  FROM generated_posts,
    LATERAL jsonb_array_elements(
      CASE jsonb_typeof(content::jsonb)
        WHEN 'object' THEN COALESCE(content::jsonb->'content', '[]'::jsonb)
        WHEN 'array' THEN content::jsonb
        ELSE '[]'::jsonb
      END
    ) AS elem
  WHERE status = 'published'
    AND created_at >= NOW() - INTERVAL '60 days'
    AND elem->>'type' = 'heading'
),
published_ids AS (
  SELECT DISTINCT (attrs->>'queueItemId')::uuid AS queue_item_id
  FROM heading_nodes
  WHERE attrs->>'queueItemId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  UNION
  SELECT DISTINCT (arr_id)::uuid AS queue_item_id
  FROM heading_nodes,
    LATERAL jsonb_array_elements_text(
      CASE jsonb_typeof(attrs->'queueItemIds')
        WHEN 'array' THEN attrs->'queueItemIds'
        ELSE '[]'::jsonb
      END
    ) AS arr_id
  WHERE arr_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
),
source_rates AS (
  SELECT
    nq.source_identifier,
    COUNT(*) AS total_items,
    COUNT(*) FILTER (WHERE nq.status = 'used' OR pi.queue_item_id IS NOT NULL) AS published_items,
    CASE
      WHEN COUNT(*) FILTER (WHERE nq.status = 'used' OR pi.queue_item_id IS NOT NULL) = 0 THEN 0
      ELSE LEAST(
        0.30,
        ROUND(
          (COUNT(*) FILTER (WHERE nq.status = 'used' OR pi.queue_item_id IS NOT NULL))::numeric
          / (COUNT(*) + 15),
          3
        )
      )
    END AS pub_rate
  FROM news_queue nq
  LEFT JOIN published_ids pi ON nq.id = pi.queue_item_id
  WHERE nq.queued_at >= NOW() - INTERVAL '60 days'
  GROUP BY nq.source_identifier
)
UPDATE news_queue nq
SET source_pub_rate = sr.pub_rate
FROM source_rates sr
WHERE nq.source_identifier = sr.source_identifier;
