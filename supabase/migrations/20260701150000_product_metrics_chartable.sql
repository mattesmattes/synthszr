-- Vorberechneter Chart-Filter + primäre Kategorie, damit getRankedProducts EINEN
-- indexierten Query mit Server-Limit fahren kann (statt alle Produkte in JS zu filtern).
ALTER TABLE product_metrics ADD COLUMN IF NOT EXISTS chartable BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE product_metrics ADD COLUMN IF NOT EXISTS primary_category TEXT;

CREATE INDEX IF NOT EXISTS idx_product_metrics_chart
  ON product_metrics(chartable, mention_count, momentum DESC);
CREATE INDEX IF NOT EXISTS idx_product_metrics_cat
  ON product_metrics(primary_category, chartable, momentum DESC);
