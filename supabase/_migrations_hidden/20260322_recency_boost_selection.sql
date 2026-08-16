-- Recency Boost in Balanced Queue Selection
-- Applies a time-decay factor to total_score when ordering for automatic selection:
--   0h = 100%, 12h = 95%, 24h = 90%, 48h+ = 80%
-- Formula: total_score * (1.0 - LEAST(age_seconds / 172800, 1.0) * 0.2)
-- This only affects the selection ORDER, not the stored total_score column.

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
  max_per_source INTEGER;
BEGIN
  -- Calculate absolute maximum items per source (30% of max_items, at least 1)
  max_per_source := GREATEST(1, FLOOR(max_items * target_source_limit)::INTEGER);

  -- Iterate through items by recency-boosted score, excluding webcrawl
  FOR item IN
    SELECT
      q.id,
      q.title,
      q.source_identifier,
      q.source_display_name,
      q.total_score,
      -- Recency-boosted score for ordering only
      q.total_score * (
        1.0 - LEAST(
          EXTRACT(EPOCH FROM (NOW() - COALESCE(q.email_received_at, q.queued_at))) / 172800.0,
          1.0
        ) * 0.2
      ) AS boosted_score
    FROM news_queue q
    LEFT JOIN daily_repo dr ON q.daily_repo_id = dr.id
    WHERE q.status = 'pending'
      AND q.expires_at > NOW()
      AND (dr.source_type IS NULL OR dr.source_type != 'webcrawl')
    ORDER BY q.total_score * (
      1.0 - LEAST(
        EXTRACT(EPOCH FROM (NOW() - COALESCE(q.email_received_at, q.queued_at))) / 172800.0,
        1.0
      ) * 0.2
    ) DESC
  LOOP
    -- Check if adding this item would exceed source limit
    DECLARE
      current_source_count INTEGER;
      should_skip BOOLEAN := false;
    BEGIN
      current_source_count := COALESCE((source_counts->>item.source_identifier)::INTEGER, 0);

      -- Hard limit: no source can exceed max_per_source items
      IF current_source_count >= max_per_source THEN
        should_skip := true;
      END IF;

      IF should_skip THEN
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
      total_score := item.total_score;  -- Return the static score, not boosted
      selection_rank := selected_count;

      RETURN NEXT;

      EXIT WHEN selected_count >= max_items;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
