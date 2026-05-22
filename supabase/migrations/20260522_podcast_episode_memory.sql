-- Persistent episode memory for the two podcast agents (HOST + GUEST).
--
-- The existing podcast_personality table holds style axes (warmth,
-- humor, relationship_phase, etc.) and a tiny memorable_moments slot.
-- It does NOT remember what was discussed, what positions the hosts
-- took on recurring topics (OpenAI, Anthropic, etc.), or which inside
-- jokes / studio moments accumulated. Without that, the script
-- generator silently contradicts past episodes and never calls back
-- to running gags.
--
-- One row per completed podcast_jobs run. Filled by an LLM extraction
-- pass after the audio mix lands; queried by the script generator
-- when the next episode starts (recent + semantically similar).

CREATE TABLE IF NOT EXISTS podcast_episode_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  job_id UUID REFERENCES podcast_jobs(id) ON DELETE CASCADE,
  post_id UUID REFERENCES generated_posts(id) ON DELETE SET NULL,
  episode_number INT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'de',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Inhaltliche Memory — gewonnen durch LLM-Extraction-Pass über Skript + News.
  topics_covered TEXT[] NOT NULL DEFAULT '{}',
  -- host_positions and guest_positions: JSON arrays of
  -- { topic: string, stance: string } pairs so the next episode can
  -- check "did HOST already commit to a view on OpenAI?".
  host_positions JSONB NOT NULL DEFAULT '[]',
  guest_positions JSONB NOT NULL DEFAULT '[]',
  running_gags_introduced TEXT[] NOT NULL DEFAULT '{}',
  running_gags_called_back TEXT[] NOT NULL DEFAULT '{}',
  key_moments TEXT[] NOT NULL DEFAULT '{}',
  tone_summary TEXT,

  -- gemini-embedding-001 over topics + tone_summary; used to retrieve
  -- semantically similar past episodes for the memory brief.
  embedding VECTOR(768),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (job_id)
);

CREATE INDEX IF NOT EXISTS idx_podcast_memory_episode
  ON podcast_episode_memory (locale, episode_number DESC);

CREATE INDEX IF NOT EXISTS idx_podcast_memory_recorded
  ON podcast_episode_memory (locale, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_podcast_memory_embedding
  ON podcast_episode_memory
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 25);

-- Retrieval RPC: top-N semantically similar past episodes for a query
-- embedding. Used by the script generator to pull "you've discussed
-- this topic before, here's what you said" context.
CREATE OR REPLACE FUNCTION match_podcast_memory(
  query_embedding VECTOR(768),
  match_locale TEXT DEFAULT 'de',
  exclude_job_id UUID DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.35,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  episode_number INT,
  recorded_at TIMESTAMPTZ,
  topics_covered TEXT[],
  host_positions JSONB,
  guest_positions JSONB,
  running_gags_introduced TEXT[],
  key_moments TEXT[],
  tone_summary TEXT,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    m.id, m.episode_number, m.recorded_at,
    m.topics_covered, m.host_positions, m.guest_positions,
    m.running_gags_introduced, m.key_moments, m.tone_summary,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM podcast_episode_memory m
  WHERE m.embedding IS NOT NULL
    AND m.locale = match_locale
    AND (exclude_job_id IS NULL OR m.job_id <> exclude_job_id)
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
$$;
