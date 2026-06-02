-- Taste model: a learned logistic-regression weight vector over embeddings.
-- Trained offline from Mattes' historical picks (taste_labels). Scoring is a
-- single cosine op per candidate (1 - (embedding <=> w)) — MICRO-friendly.
-- The weight vector is upserted from the offline trainer; this migration only
-- creates the table + scoring RPC.

CREATE TABLE IF NOT EXISTS taste_model (
  id TEXT PRIMARY KEY,
  w vector(768) NOT NULL,
  bias FLOAT DEFAULT 0,
  val_auc FLOAT,
  trained_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE taste_model ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON taste_model FOR ALL USING (true);

-- Score candidates by cosine similarity to the learned taste direction.
-- Ranking by this reproduces the LR logit ordering (bias is rank-invariant).
CREATE OR REPLACE FUNCTION taste_lr_score(candidate_ids UUID[])
RETURNS TABLE (daily_repo_id UUID, score FLOAT)
LANGUAGE sql STABLE
AS $$
  SELECT dr.id, (1 - (dr.embedding <=> m.w))::float AS score
  FROM daily_repo dr
  CROSS JOIN (SELECT w FROM taste_model WHERE id = 'lr') m
  WHERE dr.id = ANY(candidate_ids) AND dr.embedding IS NOT NULL;
$$;
