-- Tip Promos: admin-managed "Tipp des Tages" boxes shown inside the first
-- article of a post, just before the Synthszr Take. Same active/rotate/constant
-- logic as ad_promos but a much simpler schema (no images, no layouts).

CREATE TABLE IF NOT EXISTS tip_promos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  headline TEXT NOT NULL DEFAULT 'TIPP DES TAGES',
  body TEXT NOT NULL,
  link_url TEXT NOT NULL DEFAULT '',
  gradient_from TEXT NOT NULL DEFAULT '#B4E37A',
  gradient_to TEXT NOT NULL DEFAULT '#F6E23E',
  gradient_direction TEXT NOT NULL DEFAULT 'to bottom',
  text_color TEXT NOT NULL DEFAULT '#1a1a0a',
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tip_promos_active ON tip_promos(active, sort_order);

-- Display config stored in settings table:
-- key: 'tip_promo_config'
-- value: { "mode": "constant" | "rotate", "constantId": "<uuid>" | null }
INSERT INTO settings (key, value)
VALUES ('tip_promo_config', '{"mode": "rotate", "constantId": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;
