-- Synthszr Ghostwriter Feature
-- Run this migration in Supabase SQL Editor

-- ============================================
-- Ghostwriter Prompts
-- ============================================
CREATE TABLE ghostwriter_prompts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure only one active ghostwriter prompt at a time
CREATE UNIQUE INDEX idx_ghostwriter_prompts_active ON ghostwriter_prompts(is_active) WHERE is_active = true;

-- Insert default ghostwriter prompt
INSERT INTO ghostwriter_prompts (name, prompt_text, is_active) VALUES (
  'Synthzr Blog Standard',
  'Du bist ein erfahrener Tech-Blogger und schreibst für den Synthzr Newsletter.

STIL UND TONALITÄT:
- Schreibe in einem persönlichen, aber professionellen Ton
- Nutze aktive Sprache und direkte Ansprache
- Vermeide Buzzwords und leere Phrasen
- Sei konkret und praxisorientiert
- Bringe eigene Perspektiven und Meinungen ein

STRUKTUR:
- Beginne mit einem fesselnden Hook
- Gliedere den Artikel in klare Abschnitte
- Nutze Zwischenüberschriften für bessere Lesbarkeit
- Schließe mit einem Call-to-Action oder Ausblick

INHALT:
- Fokussiere auf die originellsten Insights aus dem Digest
- Verbinde verschiedene Themen zu einer kohärenten Geschichte
- Erkläre komplexe Konzepte verständlich
- Füge praktische Beispiele oder Anwendungen hinzu

FORMAT:
- Schreibe auf Deutsch
- Nutze Markdown für Formatierung
- Ziel: 800-1200 Wörter
- Füge am Ende relevante Links aus dem Digest ein',
  true
);

-- ============================================
-- Vocabulary Dictionary
-- ============================================
CREATE TABLE vocabulary_dictionary (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  term TEXT NOT NULL,
  preferred_usage TEXT,
  avoid_alternatives TEXT,
  context TEXT,
  category TEXT DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for searching
CREATE INDEX idx_vocabulary_term ON vocabulary_dictionary(term);
CREATE INDEX idx_vocabulary_category ON vocabulary_dictionary(category);

-- Insert some example vocabulary
INSERT INTO vocabulary_dictionary (term, preferred_usage, avoid_alternatives, context, category) VALUES
  ('AI', 'AI oder Künstliche Intelligenz', 'KI (nur wenn Kontext klar)', 'Bevorzuge "AI" für internationale Konsistenz', 'tech'),
  ('Synthese', 'Synthese, Verschmelzung, Zusammenführung', 'Vermischung, Kombination', 'Kernbegriff des Newsletters - die kreative Verbindung verschiedener Disziplinen', 'brand'),
  ('Transformation', 'Transformation, Wandel, Neugestaltung', 'Änderung, Umstellung', 'Für tiefgreifende Veränderungen nutzen', 'business'),
  ('Wertschöpfung', 'Wertschöpfung, Mehrwert', 'Profit, Gewinn', 'Im Kontext von Dienstleistungen und Produkten', 'business'),
  ('Disruption', 'Umbruch, Neuordnung', 'Disruption (zu abgenutzt)', 'Sparsam verwenden, besser konkret beschreiben', 'business');

-- ============================================
-- Generated Blog Posts
-- ============================================
CREATE TABLE generated_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  digest_id UUID REFERENCES daily_digests(id) ON DELETE SET NULL,
  prompt_id UUID REFERENCES ghostwriter_prompts(id) ON DELETE SET NULL,
  title TEXT,
  content TEXT NOT NULL,
  word_count INTEGER,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_generated_posts_digest ON generated_posts(digest_id);
CREATE INDEX idx_generated_posts_status ON generated_posts(status);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE ghostwriter_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_dictionary ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON ghostwriter_prompts FOR ALL USING (true);
CREATE POLICY "Service role full access" ON vocabulary_dictionary FOR ALL USING (true);
CREATE POLICY "Service role full access" ON generated_posts FOR ALL USING (true);
