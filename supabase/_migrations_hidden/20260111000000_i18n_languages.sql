-- i18n: Sprachkonfiguration
-- Migration: 20260111_i18n_languages.sql

CREATE TABLE languages (
  code TEXT PRIMARY KEY,           -- 'de', 'en', 'fr'
  name TEXT NOT NULL,              -- 'Deutsch', 'English', 'Français'
  native_name TEXT,                -- 'Deutsch', 'English', 'Français' (in eigener Sprache)
  is_active BOOLEAN DEFAULT false,
  is_default BOOLEAN DEFAULT false,
  llm_model TEXT,                  -- 'claude-3-5-sonnet', 'gemini-2.0-flash', etc.
  backfill_from_date DATE,         -- Stichtag für Backfill älterer Artikel
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Nur eine Default-Sprache erlaubt
CREATE UNIQUE INDEX idx_languages_default ON languages(is_default) WHERE is_default = true;

-- Index für aktive Sprachen
CREATE INDEX idx_languages_active ON languages(is_active) WHERE is_active = true;

-- Initial: Deutsch als Default und aktiv
INSERT INTO languages (code, name, native_name, is_active, is_default)
VALUES ('de', 'Deutsch', 'Deutsch', true, true);

-- Weitere gängige Sprachen vorbereiten (inaktiv)
INSERT INTO languages (code, name, native_name, is_active, is_default) VALUES
  ('en', 'English', 'English', false, false),
  ('fr', 'French', 'Français', false, false),
  ('es', 'Spanish', 'Español', false, false),
  ('it', 'Italian', 'Italiano', false, false),
  ('pt', 'Portuguese', 'Português', false, false),
  ('nl', 'Dutch', 'Nederlands', false, false),
  ('pl', 'Polish', 'Polski', false, false);

-- RLS
ALTER TABLE languages ENABLE ROW LEVEL SECURITY;

-- Jeder kann Sprachen lesen
CREATE POLICY "Anyone can read languages"
  ON languages FOR SELECT
  USING (true);

-- Nur anon kann Sprachen bearbeiten (Admin-API)
CREATE POLICY "Anon can manage languages"
  ON languages FOR ALL
  USING (true)
  WITH CHECK (true);

-- Trigger für updated_at
CREATE OR REPLACE FUNCTION update_languages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER languages_updated_at
  BEFORE UPDATE ON languages
  FOR EACH ROW
  EXECUTE FUNCTION update_languages_updated_at();
