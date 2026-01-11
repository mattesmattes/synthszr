-- i18n: Subscriber Sprachpräferenzen
-- Migration: 20260111_i18n_subscriber_preferences.sql

-- Kommentar zur preferences-Spalte (existiert bereits in subscribers)
COMMENT ON COLUMN subscribers.preferences IS
'JSON with subscriber preferences. Structure: { language?: "de"|"en"|"fr"|..., ... }';

-- Token für Sprachänderung ohne Login
-- Subscriber können über einen Link im Newsletter-Footer ihre Sprachpräferenz ändern
CREATE TABLE subscriber_preference_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pref_tokens_token ON subscriber_preference_tokens(token);
CREATE INDEX idx_pref_tokens_subscriber ON subscriber_preference_tokens(subscriber_id);
CREATE INDEX idx_pref_tokens_expires ON subscriber_preference_tokens(expires_at);

-- Cleanup alte Tokens (Function für Cron)
CREATE OR REPLACE FUNCTION cleanup_expired_preference_tokens()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM subscriber_preference_tokens
  WHERE expires_at < NOW() - INTERVAL '1 day'
     OR used_at IS NOT NULL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- RLS
ALTER TABLE subscriber_preference_tokens ENABLE ROW LEVEL SECURITY;

-- Public read/write für Token-Validierung
CREATE POLICY "Anyone can validate preference tokens"
  ON subscriber_preference_tokens FOR SELECT
  USING (true);

CREATE POLICY "Anon can manage preference tokens"
  ON subscriber_preference_tokens FOR ALL
  USING (true)
  WITH CHECK (true);

-- Hilfsfunktion: Generiert einen neuen Präferenz-Token für einen Subscriber
CREATE OR REPLACE FUNCTION generate_preference_token(p_subscriber_id UUID)
RETURNS TEXT AS $$
DECLARE
  new_token TEXT;
BEGIN
  -- Generiere einen zufälligen Token
  new_token := encode(gen_random_bytes(32), 'hex');

  -- Lösche alte Tokens für diesen Subscriber
  DELETE FROM subscriber_preference_tokens
  WHERE subscriber_id = p_subscriber_id;

  -- Erstelle neuen Token (gültig 7 Tage)
  INSERT INTO subscriber_preference_tokens (subscriber_id, token, expires_at)
  VALUES (p_subscriber_id, new_token, NOW() + INTERVAL '7 days');

  RETURN new_token;
END;
$$ LANGUAGE plpgsql;
