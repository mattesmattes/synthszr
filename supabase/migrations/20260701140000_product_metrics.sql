-- Vorberechnete Ranking-Metriken pro Produkt, damit die Leaderboards nicht bei
-- jedem Seiten-Load ~43k Mentions on-the-fly aggregieren müssen (~12s → <1s).
CREATE TABLE IF NOT EXISTS product_metrics (
  product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  momentum DOUBLE PRECISION NOT NULL DEFAULT 0,
  trend TEXT NOT NULL DEFAULT 'flat',
  mention_count INT NOT NULL DEFAULT 0,
  last_seen TIMESTAMPTZ,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_metrics_momentum ON product_metrics(momentum DESC);

ALTER TABLE product_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_product_metrics" ON product_metrics;
CREATE POLICY "service_role_all_product_metrics" ON product_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);
