-- Fix find_similar_items to ONLY find HISTORICAL items (from earlier dates)
--
-- ROOT CAUSE: The function was including items from the SAME day as the source item.
-- This caused:
--   1. Finding duplicates (100% similarity)
--   2. Not finding true historical connections
--
-- Solution: Add source_newsletter_date parameter and only return items from EARLIER dates.

CREATE OR REPLACE FUNCTION find_similar_items(
  query_embedding vector(768),
  item_id uuid,
  max_age_days int DEFAULT 90,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  source_type text,
  source_email text,
  collected_at timestamptz,
  similarity float
)
LANGUAGE plpgsql
AS $$
DECLARE
  source_date date;
BEGIN
  -- Get the newsletter_date of the source item
  SELECT newsletter_date::date INTO source_date
  FROM daily_repo
  WHERE daily_repo.id = item_id;

  -- If source item not found, use current date (fallback)
  IF source_date IS NULL THEN
    source_date := CURRENT_DATE;
  END IF;

  RETURN QUERY
  SELECT
    dr.id,
    dr.title,
    dr.content,
    dr.source_type,
    dr.source_email,
    dr.collected_at,
    1 - (dr.embedding <=> query_embedding) as similarity
  FROM daily_repo dr
  WHERE
    dr.id != item_id
    AND dr.embedding IS NOT NULL
    -- CRITICAL FIX: Only return items from EARLIER dates (historical only)
    -- This excludes same-day items (duplicates) and finds true historical connections
    AND dr.newsletter_date::date < source_date
    -- Keep max_age filter: only look back max_age_days from the source item
    AND dr.newsletter_date::date > (source_date - max_age_days)
    AND 1 - (dr.embedding <=> query_embedding) > match_threshold
  ORDER BY dr.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION find_similar_items IS 'Find semantically similar HISTORICAL items (from earlier dates only). Used for synthesis pipeline to find historical connections.';
