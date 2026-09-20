-- Token- und Kostenprotokoll je Modellaufruf (Betreiber-Frage 2026-09-20:
-- "woher kommen die taeglichen Opus-5-Kosten?"). Die Anthropic-Rechnung kennt
-- nur Modell und Tag; welcher Job dahinter steckt, stand nirgends.
--
-- cost_usd ist bewusst beim Schreiben berechnet (lib/ai/usage-cost.ts) statt
-- beim Lesen: Preise aendern sich, die Kosten eines vergangenen Aufrufs nicht.
-- NULL heisst "Modell stand nicht in der Preistabelle" — sichtbare Luecke
-- statt erfundener 0.
CREATE TABLE IF NOT EXISTS llm_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  use_case text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  -- enthaelt die Thinking-Token: die API zaehlt sie hier mit, und sie kosten
  -- den Output-Preis (bei Opus 5 mit effort:high der groesste Posten).
  output_tokens integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6),
  meta jsonb
);

CREATE INDEX IF NOT EXISTS llm_usage_created_at_idx ON llm_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_use_case_idx ON llm_usage (use_case, created_at DESC);

-- Kein Policy-Block: nur der Service-Role-Schluessel schreibt und liest hier
-- (Admin-Auswertung laeuft ueber /api/admin/llm-usage), anon bleibt aussen vor.
ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;
