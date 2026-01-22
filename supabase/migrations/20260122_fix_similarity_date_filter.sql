-- Fix find_similar_items to use newsletter_date instead of collected_at
--
-- ROOT CAUSE: collected_at is the INSERT timestamp, not the article date.
-- When embeddings are backfilled, all items get collected_at = backfill date,
-- making the 90-day filter useless (all items appear as "new").
--
-- Solution: Use newsletter_date (the actual article date) for the date filter.

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
BEGIN
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
    -- FIX: Use newsletter_date instead of collected_at for the date filter
    -- newsletter_date is the actual article date, collected_at is just import timestamp
    AND dr.newsletter_date::date > (CURRENT_DATE - max_age_days)
    AND 1 - (dr.embedding <=> query_embedding) > match_threshold
  ORDER BY dr.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Also create an index on newsletter_date for better query performance
CREATE INDEX IF NOT EXISTS daily_repo_newsletter_date_idx ON daily_repo(newsletter_date);
