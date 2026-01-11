-- i18n: Content-Übersetzungen
-- Migration: 20260111_i18n_translations.sql

-- Content-Übersetzungen (Artikel + Statische Seiten)
CREATE TABLE content_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Referenz zum Original (EINE der folgenden)
  generated_post_id UUID REFERENCES generated_posts(id) ON DELETE CASCADE,
  static_page_id UUID REFERENCES static_pages(id) ON DELETE CASCADE,

  language_code TEXT NOT NULL REFERENCES languages(code) ON DELETE CASCADE,

  -- Übersetzte Felder
  title TEXT,
  slug TEXT,
  excerpt TEXT,
  content JSONB,  -- TipTap JSON

  -- Tracking
  translation_status TEXT DEFAULT 'pending'
    CHECK (translation_status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  is_manually_edited BOOLEAN DEFAULT false,
  error_log TEXT,

  -- Timestamps für Change-Detection
  source_updated_at TIMESTAMPTZ,  -- Wann wurde das Original zuletzt aktualisiert
  translated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints: Genau eine Quelle muss gesetzt sein
  CONSTRAINT content_translations_one_source CHECK (
    (generated_post_id IS NOT NULL AND static_page_id IS NULL) OR
    (generated_post_id IS NULL AND static_page_id IS NOT NULL)
  ),
  -- Unique pro Quelle + Sprache
  UNIQUE (generated_post_id, language_code),
  UNIQUE (static_page_id, language_code)
);

-- Indizes für schnelle Lookups
CREATE INDEX idx_translations_status ON content_translations(translation_status);
CREATE INDEX idx_translations_language ON content_translations(language_code);
CREATE INDEX idx_translations_post ON content_translations(generated_post_id) WHERE generated_post_id IS NOT NULL;
CREATE INDEX idx_translations_page ON content_translations(static_page_id) WHERE static_page_id IS NOT NULL;
CREATE INDEX idx_translations_slug ON content_translations(slug, language_code);
CREATE INDEX idx_translations_manually_edited ON content_translations(is_manually_edited) WHERE is_manually_edited = true;

-- UI-Übersetzungen (Navigation, Labels, Buttons, etc.)
CREATE TABLE ui_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,           -- 'nav.home', 'footer.imprint', 'newsletter.title'
  language_code TEXT NOT NULL REFERENCES languages(code) ON DELETE CASCADE,
  value TEXT NOT NULL,
  is_manually_edited BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (key, language_code)
);

CREATE INDEX idx_ui_translations_lang ON ui_translations(language_code);
CREATE INDEX idx_ui_translations_key ON ui_translations(key);

-- Übersetzungs-Queue für Batch-Processing
CREATE TABLE translation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Was soll übersetzt werden
  content_type TEXT NOT NULL CHECK (content_type IN ('generated_post', 'static_page', 'ui')),
  content_id UUID,        -- generated_post_id oder static_page_id
  ui_key TEXT,            -- Für UI-Übersetzungen

  target_language TEXT NOT NULL REFERENCES languages(code) ON DELETE CASCADE,
  priority INTEGER DEFAULT 0,  -- Höher = wichtiger

  -- Status
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_error TEXT,

  -- Timing
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Partial unique index to prevent duplicate pending/processing items
-- Uses COALESCE to handle NULL values (content_id for ui, ui_key for posts)
CREATE UNIQUE INDEX idx_queue_prevent_duplicates
  ON translation_queue (
    content_type,
    COALESCE(content_id::text, ''),
    COALESCE(ui_key, ''),
    target_language
  )
  WHERE status IN ('pending', 'processing');

CREATE INDEX idx_queue_status_priority ON translation_queue(status, priority DESC, created_at);
CREATE INDEX idx_queue_language ON translation_queue(target_language);
CREATE INDEX idx_queue_content ON translation_queue(content_type, content_id);

-- RLS für alle Tabellen
ALTER TABLE content_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ui_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_queue ENABLE ROW LEVEL SECURITY;

-- Public read für Translations
CREATE POLICY "Anyone can read content_translations"
  ON content_translations FOR SELECT
  USING (true);

CREATE POLICY "Anyone can read ui_translations"
  ON ui_translations FOR SELECT
  USING (true);

-- Admin write (via anon key)
CREATE POLICY "Anon can manage content_translations"
  ON content_translations FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anon can manage ui_translations"
  ON ui_translations FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anon can manage translation_queue"
  ON translation_queue FOR ALL
  USING (true)
  WITH CHECK (true);

-- Updated_at Trigger für content_translations
CREATE OR REPLACE FUNCTION update_content_translations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER content_translations_updated_at
  BEFORE UPDATE ON content_translations
  FOR EACH ROW
  EXECUTE FUNCTION update_content_translations_updated_at();

-- Updated_at Trigger für ui_translations
CREATE TRIGGER ui_translations_updated_at
  BEFORE UPDATE ON ui_translations
  FOR EACH ROW
  EXECUTE FUNCTION update_content_translations_updated_at();
