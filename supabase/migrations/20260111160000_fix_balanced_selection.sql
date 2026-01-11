-- Fix: Balanced selection algorithm too restrictive for small item counts
-- The 30% rule should only apply when we have enough items to make it meaningful

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
  min_items_for_limit INTEGER := 4; -- Only enforce 30% limit after 4 items selected
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
      should_skip BOOLEAN := false;
    BEGIN
      current_source_count := COALESCE((source_counts->>item.source_identifier)::INTEGER, 0);

      -- Only enforce source limit after we have min_items_for_limit items
      -- This prevents the algorithm from being too restrictive with small item counts
      IF selected_count >= min_items_for_limit THEN
        source_percentage := (current_source_count + 1)::numeric / (selected_count + 1)::numeric;
        IF source_percentage > target_source_limit THEN
          should_skip := true;
        END IF;
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
