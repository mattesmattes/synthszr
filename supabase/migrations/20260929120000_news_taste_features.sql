-- Jev-Feature-Vektoren je News-Queue-Item (News-Taste-Modell, Spec 2026-09-29).
-- Ein Vektor kostet einen bezahlten Gateway-Call — darum persistiert, damit
-- Training (Export) und Runtime (Ranking) dieselben Werte nutzen und nichts
-- doppelt bezahlt wird. features_version im PK: ändert sich der Fragenkatalog
-- (lib/news-taste/questions.ts), entstehen neue Zeilen, alte bleiben für
-- Reproduzierbarkeit alter Trainingsläufe stehen.
CREATE TABLE IF NOT EXISTS news_taste_features (
  queue_item_id uuid NOT NULL REFERENCES news_queue(id) ON DELETE CASCADE,
  features_version integer NOT NULL,
  -- Name -> Zahl; kanonische Namen und Reihenfolge definiert questions.ts
  features jsonb NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (queue_item_id, features_version)
);

-- Wie llm_usage: nur der Service-Role-Schlüssel liest und schreibt hier.
ALTER TABLE news_taste_features ENABLE ROW LEVEL SECURITY;
