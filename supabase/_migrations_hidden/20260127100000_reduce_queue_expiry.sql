-- Reduce news queue item expiry from 3 days to 2 days
-- This makes the queue more current and responsive to news cycles

-- Update default expiry for new items
ALTER TABLE news_queue
ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '2 days');

-- Update the source distribution view to use 2-day window
CREATE OR REPLACE VIEW news_queue_source_distribution AS
SELECT
  source_identifier,
  source_display_name,
  COUNT(*) as item_count,
  COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
  COUNT(*) FILTER (WHERE status = 'selected') as selected_count,
  COUNT(*) FILTER (WHERE status = 'used') as used_count,
  ROUND(
    COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100,
    1
  ) as percentage_of_total
FROM news_queue
WHERE queued_at >= NOW() - INTERVAL '2 days'
  AND status IN ('pending', 'selected', 'used')
GROUP BY source_identifier, source_display_name
ORDER BY item_count DESC;

-- Update the selectable items view to use 2-day window
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

-- Update the auto-expire function's message
CREATE OR REPLACE FUNCTION expire_old_queue_items()
RETURNS INTEGER AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE news_queue
  SET status = 'expired',
      skip_reason = 'Auto-expired after 2 days'
  WHERE status = 'pending'
    AND expires_at < NOW();

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$ LANGUAGE plpgsql;
