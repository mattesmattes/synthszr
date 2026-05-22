-- Mattes corpus for retrieval-augmented Synthszr Take generation.
-- Chunks of all 18 source files in
--   /Users/mattes/Library/CloudStorage/Dropbox/_Mattes Kram/04_Projekte/Repos/___Mattes Repo/repo.md/
-- get embedded with gemini-embedding-001 (768-dim, matches the rest of
-- the stack), and the ghostwriter pipeline retrieves the top-N nearest
-- passages per news item to ground the Synthszr Take in Mattes' voice.

CREATE TABLE IF NOT EXISTS mattes_corpus_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source bookkeeping so chunks can be re-synced when a file changes
  source_file TEXT NOT NULL,           -- filename within repo.md/, e.g. "Code Crash Q2.md"
  chunk_index INT NOT NULL,            -- position of chunk within file (0-based)
  total_chunks INT,                    -- how many chunks the file produced

  -- Content
  chunk_text TEXT NOT NULL,            -- raw text chunk (~500-800 tokens)
  embedding vector(768),               -- gemini-embedding-001

  -- Provenance for the dedup-on-reimport workflow
  source_sha TEXT,                     -- sha256 of the source file when chunked

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (source_file, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_mattes_corpus_embedding
  ON mattes_corpus_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

CREATE INDEX IF NOT EXISTS idx_mattes_corpus_source
  ON mattes_corpus_chunks (source_file);

-- Cosine-similarity retrieval RPC. Returns the top-N closest chunks
-- above a threshold. Used at writeSection time to ground the Take in
-- the author's vocabulary and argument patterns.
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
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
