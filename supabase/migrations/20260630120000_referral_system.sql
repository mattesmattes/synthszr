-- Newsletter-Referral-/Empfehlungssystem (beehiiv-Vorbild)
-- Belohnung: "Code Crash" bei 10 bestätigten Empfehlungen.

-- 1. Empfehlungscode + Zähler an Subscribers.
--    referral_code UNIQUE, aber nullable: sonst kollidiert der Backfill auf dem leeren Default.
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS referral_count INT NOT NULL DEFAULT 0;

-- Backfill: jeder Bestandsabonnent bekommt einen eindeutigen 10-stelligen Code
-- (gen_random_uuid() ist pro Zeile verschieden → kollisionsfrei).
UPDATE subscribers
  SET referral_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
  WHERE referral_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_subscribers_referral_code ON subscribers(referral_code);

-- 2. Empfehlungs-Tracking. UNIQUE(referrer_id, referred_email) verhindert Doppelzählung
--    desselben Geworbenen durch denselben Werber.
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  referred_email TEXT NOT NULL,
  referred_subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
  referral_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (referrer_id, referred_email)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_email ON referrals(referred_email);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);

-- 3. Ausgelöste Belohnungen (eine pro Subscriber). fulfilled_at = manueller Versand durch Mattes.
CREATE TABLE IF NOT EXISTS referral_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL UNIQUE REFERENCES subscribers(id) ON DELETE CASCADE,
  reward_type TEXT NOT NULL DEFAULT 'code_crash',
  threshold_reached INT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fulfilled_at TIMESTAMPTZ
);

-- 4. Konfiguration (Schwelle + Belohnung) im bestehenden settings-Key-Value-Store.
INSERT INTO settings (key, value)
  VALUES ('referral_config', '{"threshold": 10, "reward": "code_crash", "enabled": true}'::jsonb)
  ON CONFLICT (key) DO NOTHING;

-- 5. RLS: nur Service-Role (alle Zugriffe laufen serverseitig über den Admin-Client).
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_referrals" ON referrals;
DROP POLICY IF EXISTS "service_role_all_referral_rewards" ON referral_rewards;
CREATE POLICY "service_role_all_referrals" ON referrals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_referral_rewards" ON referral_rewards FOR ALL TO service_role USING (true) WITH CHECK (true);
