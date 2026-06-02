-- Assisted Ranking: label store + winner-similarity RPC
-- Spec: docs/superpowers/specs/2026-06-01-assisted-article-ranking-design.md
-- Plan: docs/superpowers/plans/2026-06-01-assisted-article-ranking.md (Task 2)

-- 1) One row per ranking run (one daily invocation)
CREATE TABLE IF NOT EXISTS ranking_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_count INT NOT NULL DEFAULT 0,
  suggested_count INT NOT NULL DEFAULT 0,
  stage1_method TEXT NOT NULL DEFAULT 'rrf',   -- 'rrf' | 'all'
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE ranking_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON ranking_runs FOR ALL USING (true);

-- 2) The label store: one row per suggested (or user-added) item per run
CREATE TABLE IF NOT EXISTS ranking_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES ranking_runs(id) ON DELETE CASCADE,
  queue_item_id UUID NOT NULL REFERENCES news_queue(id) ON DELETE CASCADE,
  suggested_rank INT,                  -- NULL when user-added (not suggested)
  llm_reason TEXT,
  confidence FLOAT,
  user_action TEXT NOT NULL DEFAULT 'pending'
    CHECK (user_action IN ('pending','accepted','rejected','added','reordered')),
  final_rank INT,
  acted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(run_id, queue_item_id)
);
CREATE INDEX idx_ranking_suggestions_run ON ranking_suggestions(run_id);
CREATE INDEX idx_ranking_suggestions_action ON ranking_suggestions(user_action);
ALTER TABLE ranking_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON ranking_suggestions FOR ALL USING (true);

-- 3) Winner-similarity: max cosine similarity of each candidate to the
--    embeddings of items that made it into PUBLISHED posts ("winners").
--    Winner extraction reuses the published-queueItemId query from
--    20260328_optimized_scoring.sql.
CREATE OR REPLACE FUNCTION get_winner_similarity(
  candidate_ids UUID[],
  winner_limit INT DEFAULT 60
)
RETURNS TABLE (queue_item_id UUID, similarity FLOAT)
LANGUAGE sql STABLE
AS $$
  WITH winners AS (
    SELECT dr.embedding
    FROM generated_posts gp
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE jsonb_typeof(gp.content::jsonb)
        WHEN 'object' THEN gp.content::jsonb->'content'
        WHEN 'array'  THEN gp.content::jsonb
        ELSE '[]'::jsonb
      END
    ) AS elem
    JOIN news_queue nq ON nq.id = (elem->'attrs'->>'queueItemId')::uuid
    JOIN daily_repo dr ON dr.id = nq.daily_repo_id
    WHERE gp.status = 'published'
      AND elem->>'type' = 'heading'
      AND elem->'attrs'->>'queueItemId' IS NOT NULL
      AND elem->'attrs'->>'queueItemId' <> 'null'
      AND dr.embedding IS NOT NULL
    ORDER BY gp.created_at DESC
    LIMIT winner_limit
  ),
  cand AS (
    SELECT nq.id AS queue_item_id, dr.embedding
    FROM news_queue nq
    JOIN daily_repo dr ON dr.id = nq.daily_repo_id
    WHERE nq.id = ANY(candidate_ids)
      AND dr.embedding IS NOT NULL
  )
  SELECT c.queue_item_id,
         MAX(1 - (c.embedding <=> w.embedding))::float AS similarity
  FROM cand c CROSS JOIN winners w
  GROUP BY c.queue_item_id;
$$;
