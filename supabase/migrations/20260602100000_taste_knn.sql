-- Taste kNN: instance-based taste signal from Mattes' historical picks.
-- Labels live in a thin table (ids only); embeddings stay in daily_repo and are
-- joined at query time. Scoring runs entirely in-DB (no vector transfer).
-- Spec: assisted-article-ranking. Experimental — eval-gated before production use.

CREATE TABLE IF NOT EXISTS taste_labels (
  daily_repo_id UUID PRIMARY KEY REFERENCES daily_repo(id) ON DELETE CASCADE,
  label SMALLINT NOT NULL CHECK (label IN (0, 1))
);
ALTER TABLE taste_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON taste_labels FOR ALL USING (true);

-- Populate (in-DB, ids only — gentle):
-- positives = items Mattes picked (news_queue.status='used')
INSERT INTO taste_labels (daily_repo_id, label)
SELECT DISTINCT daily_repo_id, 1
FROM news_queue
WHERE status = 'used' AND daily_repo_id IS NOT NULL
ON CONFLICT (daily_repo_id) DO NOTHING;

-- negatives = a sample of items that were candidates but NOT picked
INSERT INTO taste_labels (daily_repo_id, label)
SELECT daily_repo_id, 0 FROM (
  SELECT DISTINCT daily_repo_id
  FROM news_queue
  WHERE status <> 'used' AND daily_repo_id IS NOT NULL
    AND daily_repo_id NOT IN (SELECT daily_repo_id FROM taste_labels)
  ORDER BY daily_repo_id
  LIMIT 6000
) s
ON CONFLICT (daily_repo_id) DO NOTHING;

-- kNN taste score: avg cosine sim to k nearest positives minus avg to k nearest
-- negatives. Higher = closer to the kind of items Mattes picks.
CREATE OR REPLACE FUNCTION taste_knn_score(candidate_ids UUID[], k INT DEFAULT 10)
RETURNS TABLE (daily_repo_id UUID, score FLOAT)
LANGUAGE sql STABLE
AS $$
  WITH cand AS (
    SELECT id, embedding
    FROM daily_repo
    WHERE id = ANY(candidate_ids) AND embedding IS NOT NULL
  )
  SELECT
    c.id AS daily_repo_id,
    COALESCE((
      SELECT avg(pn.sim) FROM (
        SELECT 1 - (d.embedding <=> c.embedding) AS sim
        FROM taste_labels tl
        JOIN daily_repo d ON d.id = tl.daily_repo_id
        WHERE tl.label = 1 AND d.id <> c.id AND d.embedding IS NOT NULL
        ORDER BY d.embedding <=> c.embedding
        LIMIT k
      ) pn
    ), 0) - COALESCE((
      SELECT avg(nn.sim) FROM (
        SELECT 1 - (d.embedding <=> c.embedding) AS sim
        FROM taste_labels tl
        JOIN daily_repo d ON d.id = tl.daily_repo_id
        WHERE tl.label = 0 AND d.id <> c.id AND d.embedding IS NOT NULL
        ORDER BY d.embedding <=> c.embedding
        LIMIT k
      ) nn
    ), 0) AS score
  FROM cand c;
$$;
