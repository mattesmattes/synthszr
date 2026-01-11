-- Synthesis Enhancement: Add embedding column and synthesis tables
-- Requires pgvector extension (see 20260103_enable_pgvector.sql)

-- Add embedding column to daily_repo for semantic search
ALTER TABLE daily_repo
ADD COLUMN IF NOT EXISTS embedding vector(768);

-- Create HNSW index for fast similarity search
CREATE INDEX IF NOT EXISTS daily_repo_embedding_idx
ON daily_repo USING hnsw (embedding vector_cosine_ops);

-- Synthesis candidates (intermediate results from similarity search)
CREATE TABLE IF NOT EXISTS synthesis_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_item_id UUID REFERENCES daily_repo(id) ON DELETE CASCADE,
  related_item_id UUID REFERENCES daily_repo(id) ON DELETE CASCADE,
  similarity_score FLOAT NOT NULL,
  synthesis_type TEXT CHECK (synthesis_type IN ('contradiction', 'evolution', 'cross_domain', 'validation', 'pattern')),
  originality_score INT CHECK (originality_score BETWEEN 0 AND 10),
  relevance_score INT CHECK (relevance_score BETWEEN 0 AND 10),
  reasoning TEXT,
  digest_id UUID REFERENCES daily_digests(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(source_item_id, related_item_id, digest_id)
);

-- Indexes for synthesis_candidates
CREATE INDEX IF NOT EXISTS synthesis_candidates_digest_idx ON synthesis_candidates(digest_id);
CREATE INDEX IF NOT EXISTS synthesis_candidates_source_idx ON synthesis_candidates(source_item_id);

-- Developed syntheses (output from Claude Opus)
CREATE TABLE IF NOT EXISTS developed_syntheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES synthesis_candidates(id) ON DELETE CASCADE,
  digest_id UUID REFERENCES daily_digests(id) ON DELETE CASCADE,
  synthesis_content TEXT NOT NULL,
  synthesis_headline TEXT,
  historical_reference TEXT,
  core_thesis_alignment INT CHECK (core_thesis_alignment BETWEEN 0 AND 10),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for developed_syntheses
CREATE INDEX IF NOT EXISTS developed_syntheses_digest_idx ON developed_syntheses(digest_id);

-- Synthesis prompts (configurable in admin)
CREATE TABLE IF NOT EXISTS synthesis_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  scoring_prompt TEXT NOT NULL,
  development_prompt TEXT NOT NULL,
  core_thesis TEXT,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Only one active prompt at a time
CREATE UNIQUE INDEX IF NOT EXISTS synthesis_prompts_active_idx
ON synthesis_prompts (is_active) WHERE is_active = true;

-- SQL Function for similarity search
CREATE OR REPLACE FUNCTION find_similar_items(
  query_embedding vector(768),
  item_id uuid,
  max_age_days int DEFAULT 90,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  source_type text,
  source_email text,
  collected_at timestamptz,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dr.id,
    dr.title,
    dr.content,
    dr.source_type,
    dr.source_email,
    dr.collected_at,
    1 - (dr.embedding <=> query_embedding) as similarity
  FROM daily_repo dr
  WHERE
    dr.id != item_id
    AND dr.embedding IS NOT NULL
    AND dr.collected_at > NOW() - (max_age_days || ' days')::interval
    AND 1 - (dr.embedding <=> query_embedding) > match_threshold
  ORDER BY dr.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Insert default synthesis prompt
INSERT INTO synthesis_prompts (name, scoring_prompt, development_prompt, core_thesis, is_active)
VALUES (
  'Standard Synthese',
  'Bewerte diese Verbindung zwischen zwei News-Items:

NEWS A (aktuell): {current_news}
NEWS B (historisch, {days_ago} Tage alt): {historical_news}

Bewertungskriterien:
1. ORIGINALITÄT (0-10): Wie unerwartet/überraschend ist diese Verbindung?
2. RELEVANZ (0-10): Wie bedeutsam ist der Zusammenhang?
3. SYNTHESE-TYP: Wähle einen:
   - contradiction: Widerspruch zu früherer Aussage
   - evolution: Entwicklung einer laufenden Story
   - cross_domain: Verbindung verschiedener Bereiche
   - validation: Bestätigung einer früheren Prognose
   - pattern: Wiederkehrendes Muster

Antworte im Format:
ORIGINALITÄT: [0-10]
RELEVANZ: [0-10]
TYP: [type]
BEGRÜNDUNG: [1-2 Sätze]',

  'Entwickle einen originellen Synthese-Insight basierend auf dieser Verbindung:

AKTUELLE NEWS: {current_news}
HISTORISCHE NEWS ({days_ago} Tage alt): {historical_news}
SYNTHESE-TYP: {synthesis_type}

KERNTHESE ZUR ORIENTIERUNG:
{core_thesis}

Erstelle einen prägnanten Synthese-Kommentar (2-4 Sätze), der:
1. Die Verbindung zwischen beiden News erklärt
2. Einen originellen Insight liefert, der über beide Einzelnews hinausgeht
3. Zur Kernthese passt (falls relevant)
4. Als "Mattes Synthese" im Blog verwendbar ist

Format:
HEADLINE: [Kurze, prägnante Überschrift]
SYNTHESE: [Der Insight-Text]
REFERENZ: [Kurzer Verweis auf die historische News]',

  'AI macht nicht alles effizienter, sondern die Synthese aus allen Bereichen (Marketing, Design, Business, Code) führt zu völlig neuen Produkten und Services und verändert die Wertschöpfung von IT- und Agenturdienstleistern komplett.',

  true
)
ON CONFLICT DO NOTHING;
