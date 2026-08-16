-- Ad Promos: admin-managed promotional blocks (e.g. CODE CRASH book promo)
CREATE TABLE IF NOT EXISTS ad_promos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  layout TEXT NOT NULL DEFAULT 'grid' CHECK (layout IN ('grid', 'single')),
  -- Grid: two images side-by-side. Single: one 880px-wide image above text.
  image_left_url TEXT,
  image_left_bg TEXT DEFAULT '#00FFFF',
  image_left_blend TEXT DEFAULT 'normal' CHECK (image_left_blend IN ('normal', 'multiply')),
  image_right_url TEXT,
  image_right_bg TEXT DEFAULT '#D4D4D4',
  image_right_blend TEXT DEFAULT 'normal' CHECK (image_right_blend IN ('normal', 'multiply')),
  text_bg TEXT NOT NULL DEFAULT '#DDD0BC',
  text_color TEXT NOT NULL DEFAULT '#000000',
  eyebrow TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  cta_label TEXT NOT NULL,
  link_url TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_promos_active ON ad_promos(active, sort_order);

-- Display config stored in settings table:
-- key: 'ad_promo_config'
-- value: { "mode": "constant" | "rotate", "constantId": "<uuid>" | null }
INSERT INTO settings (key, value)
VALUES ('ad_promo_config', '{"mode": "rotate", "constantId": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;
