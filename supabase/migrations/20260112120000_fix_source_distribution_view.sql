-- Fix: Source distribution view should show selected items count too
-- Previously only showed pending and used, but "selected" items were invisible

-- Must DROP first because CREATE OR REPLACE can't add columns in the middle
DROP VIEW IF EXISTS news_queue_source_distribution;

CREATE VIEW news_queue_source_distribution AS
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
WHERE queued_at >= NOW() - INTERVAL '3 days'
  AND status IN ('pending', 'selected', 'used')
GROUP BY source_identifier, source_display_name
ORDER BY item_count DESC;
