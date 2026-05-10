-- Semantic search index for the home-page search bar.
-- Adds a 768-dim vector column to generated_posts (matches the existing
-- gemini-embedding-001 dimensionality used elsewhere in the codebase),
-- plus an RPC the API can call in one round-trip.

ALTER TABLE generated_posts
  ADD COLUMN IF NOT EXISTS content_embedding vector(768);

CREATE INDEX IF NOT EXISTS idx_generated_posts_content_embedding
  ON generated_posts USING ivfflat (content_embedding vector_cosine_ops)
  WITH (lists = 50);

CREATE OR REPLACE FUNCTION match_generated_posts(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.4,
  match_count int DEFAULT 30
)
RETURNS TABLE (
  id uuid,
  title text,
  slug text,
  excerpt text,
  content text,
  created_at timestamptz,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.id, p.title, p.slug, p.excerpt, p.content, p.created_at,
    1 - (p.content_embedding <=> query_embedding) AS similarity
  FROM generated_posts p
  WHERE p.status = 'published'
    AND p.content_embedding IS NOT NULL
    AND 1 - (p.content_embedding <=> query_embedding) > match_threshold
  ORDER BY p.content_embedding <=> query_embedding
  LIMIT match_count;
$$;
