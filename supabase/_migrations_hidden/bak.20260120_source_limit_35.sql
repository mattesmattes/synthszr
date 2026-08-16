-- Update source limit from 30% to 35%
-- This gives more flexibility while still maintaining source diversity

CREATE OR REPLACE FUNCTION get_balanced_queue_selection(
  max_items INTEGER DEFAULT 10,
  target_source_limit NUMERIC DEFAULT 0.35
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
  -- Calculate absolute maximum items per source (35% of max_items, at least 1)
  max_per_source := GREATEST(1, FLOOR(max_items * target_source_limit)::INTEGER);

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
      total_score := item.total_score;
      selection_rank := selected_count;

      RETURN NEXT;

      EXIT WHEN selected_count >= max_items;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
