-- Tip-Promo nur im Newsletter ausspielen (nicht im Web-View).
ALTER TABLE tip_promos ADD COLUMN IF NOT EXISTS newsletter_only BOOLEAN NOT NULL DEFAULT false;
