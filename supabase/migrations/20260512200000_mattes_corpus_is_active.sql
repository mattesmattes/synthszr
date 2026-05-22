-- Per-file enable/disable toggle for the Mattes corpus. Disabled files
-- remain in the table (so the toggle is reversible without re-upload)
-- but are filtered out at retrieval time.

ALTER TABLE mattes_corpus_chunks
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_mattes_corpus_active
  ON mattes_corpus_chunks (source_file, is_active);

-- Replace the retrieval RPC so disabled chunks are skipped.
CREATE OR REPLACE FUNCTION match_mattes_chunks(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.35,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  source_file text,
  chunk_index int,
  chunk_text text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id, c.source_file, c.chunk_index, c.chunk_text,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM mattes_corpus_chunks c
  WHERE c.embedding IS NOT NULL
    AND c.is_active = TRUE
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
