-- Add optional CTA label for the tip-promo link
ALTER TABLE tip_promos
  ADD COLUMN IF NOT EXISTS cta_label TEXT NOT NULL DEFAULT '';
