-- Edit Learning System
-- Tracks edits to AI-generated posts and extracts patterns for future generations

-- ============================================
-- Edit History - Version tracking for posts
-- ============================================
CREATE TABLE IF NOT EXISTS edit_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES generated_posts(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,

  -- Content snapshots (TipTap JSON)
  content_before JSONB NOT NULL,
  content_after JSONB NOT NULL,

  -- Metadata
  ai_model TEXT,
  word_count_before INT,
  word_count_after INT,

  -- Analysis status
  analysis_completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(post_id, version)
);

CREATE INDEX idx_edit_history_post ON edit_history(post_id);
CREATE INDEX idx_edit_history_unanalyzed ON edit_history(analysis_completed_at)
  WHERE analysis_completed_at IS NULL;

-- RLS
ALTER TABLE edit_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON edit_history FOR ALL USING (true);

-- ============================================
-- Edit Diffs - Sentence-level change tracking
-- ============================================
CREATE TABLE IF NOT EXISTS edit_diffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edit_history_id UUID NOT NULL REFERENCES edit_history(id) ON DELETE CASCADE,

  -- Position in document
  paragraph_index INT NOT NULL,
  sentence_index INT NOT NULL,

  -- The actual change
  original_text TEXT NOT NULL,
  edited_text TEXT NOT NULL,

  -- Classification (populated by AI analysis)
  edit_type TEXT CHECK (edit_type IN (
    'stylistic',      -- Tone, voice, formality changes
    'structural',     -- Reorganization, paragraph flow
    'factual',        -- Content corrections
    'vocabulary',     -- Word choice improvements
    'grammar',        -- Grammar/syntax fixes
    'deletion',       -- Removed content
    'addition',       -- Added content
    'formatting'      -- Markdown/formatting changes
  )),

  -- Semantic embedding for similarity search (768 dimensions for text-embedding-3-small)
  embedding vector(768),

  -- Quality/importance scores (1-10)
  significance_score INT CHECK (significance_score BETWEEN 1 AND 10),
  generalizability_score INT CHECK (generalizability_score BETWEEN 1 AND 10),

  -- AI-generated reasoning
  pattern_explanation TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_edit_diffs_history ON edit_diffs(edit_history_id);
CREATE INDEX idx_edit_diffs_type ON edit_diffs(edit_type);
CREATE INDEX idx_edit_diffs_generalizable ON edit_diffs(generalizability_score)
  WHERE generalizability_score >= 6;

-- Vector index for similarity search
CREATE INDEX idx_edit_diffs_embedding ON edit_diffs
  USING hnsw (embedding vector_cosine_ops);

-- RLS
ALTER TABLE edit_diffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON edit_diffs FOR ALL USING (true);

-- ============================================
-- Learned Patterns - Extracted rules from edits
-- ============================================
CREATE TABLE IF NOT EXISTS learned_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Pattern classification
  pattern_type TEXT NOT NULL CHECK (pattern_type IN (
    'replacement',    -- "Replace X with Y"
    'avoidance',      -- "Avoid X"
    'preference',     -- "Prefer X over Y"
    'structure',      -- "Use pattern X for situation Y"
    'tone'            -- "Maintain tone X when discussing Y"
  )),

  -- The actual pattern
  trigger_pattern TEXT,       -- What triggers this pattern (regex or keywords)
  original_form TEXT,         -- What the AI tends to write
  preferred_form TEXT,        -- What the user prefers
  context_description TEXT,   -- When this applies

  -- Confidence and usage tracking
  confidence_score FLOAT DEFAULT 0.5 CHECK (confidence_score BETWEEN 0 AND 1),
  times_applied INT DEFAULT 0,
  times_overridden INT DEFAULT 0,
  last_applied_at TIMESTAMPTZ,

  -- Source tracking
  derived_from_edit_ids UUID[],
  extraction_version INT DEFAULT 1,

  -- Embedding for context-aware retrieval
  embedding vector(768),

  -- Status
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_learned_patterns_active ON learned_patterns(is_active, confidence_score DESC)
  WHERE is_active = true;
CREATE INDEX idx_learned_patterns_type ON learned_patterns(pattern_type);
CREATE INDEX idx_learned_patterns_embedding ON learned_patterns
  USING hnsw (embedding vector_cosine_ops);

-- RLS
ALTER TABLE learned_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON learned_patterns FOR ALL USING (true);

-- ============================================
-- Edit Examples - Curated before/after pairs
-- ============================================
CREATE TABLE IF NOT EXISTS edit_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source reference
  source_diff_id UUID REFERENCES edit_diffs(id) ON DELETE SET NULL,

  -- The example content
  context_text TEXT,          -- Surrounding context for understanding
  original_text TEXT NOT NULL, -- What AI wrote
  edited_text TEXT NOT NULL,   -- What user changed it to

  -- Classification
  example_type TEXT NOT NULL CHECK (example_type IN (
    'stylistic', 'structural', 'factual', 'vocabulary', 'grammar', 'formatting'
  )),
  topic_tags TEXT[],          -- e.g., ['AI', 'business', 'technical']

  -- Quality metrics
  quality_score INT CHECK (quality_score BETWEEN 1 AND 10),
  is_curated BOOLEAN DEFAULT false,  -- Manually approved?

  -- Embedding for retrieval
  embedding vector(768),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_edit_examples_type ON edit_examples(example_type);
CREATE INDEX idx_edit_examples_quality ON edit_examples(quality_score DESC)
  WHERE quality_score >= 7;
CREATE INDEX idx_edit_examples_curated ON edit_examples(is_curated)
  WHERE is_curated = true;
CREATE INDEX idx_edit_examples_embedding ON edit_examples
  USING hnsw (embedding vector_cosine_ops);

-- RLS
ALTER TABLE edit_examples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON edit_examples FOR ALL USING (true);

-- ============================================
-- Applied Patterns - Track pattern usage per post
-- ============================================
CREATE TABLE IF NOT EXISTS applied_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES generated_posts(id) ON DELETE CASCADE,
  pattern_id UUID NOT NULL REFERENCES learned_patterns(id) ON DELETE CASCADE,

  -- Position in generated text
  paragraph_index INT NOT NULL,
  sentence_index INT,

  -- The actual text positions (for highlighting)
  char_start INT,
  char_end INT,

  -- What was changed
  would_have_written TEXT,    -- Hypothetical: what AI would write without pattern
  actually_written TEXT NOT NULL,  -- What was actually written (with pattern)

  -- User feedback (null = no feedback yet)
  user_accepted BOOLEAN,
  feedback_at TIMESTAMPTZ,

  applied_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_applied_patterns_post ON applied_patterns(post_id);
CREATE INDEX idx_applied_patterns_pattern ON applied_patterns(pattern_id);
CREATE INDEX idx_applied_patterns_unfeedback ON applied_patterns(user_accepted)
  WHERE user_accepted IS NULL;

-- RLS
ALTER TABLE applied_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON applied_patterns FOR ALL USING (true);

-- ============================================
-- Pattern Conflicts - For manual review
-- ============================================
CREATE TABLE IF NOT EXISTS pattern_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_a_id UUID REFERENCES learned_patterns(id) ON DELETE CASCADE,
  pattern_b_id UUID REFERENCES learned_patterns(id) ON DELETE CASCADE,
  conflict_type TEXT NOT NULL,
  resolution TEXT CHECK (resolution IN ('pending', 'keep_a', 'keep_b', 'merge', 'keep_both'))
    DEFAULT 'pending',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pattern_conflicts_pending ON pattern_conflicts(resolution)
  WHERE resolution = 'pending';

-- RLS
ALTER TABLE pattern_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON pattern_conflicts FOR ALL USING (true);

-- ============================================
-- Helper Functions
-- ============================================

-- Function to find similar edit examples by embedding
CREATE OR REPLACE FUNCTION find_similar_edit_examples(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5,
  min_quality int DEFAULT 7
)
RETURNS TABLE (
  id UUID,
  context_text TEXT,
  original_text TEXT,
  edited_text TEXT,
  example_type TEXT,
  quality_score INT,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.context_text,
    e.original_text,
    e.edited_text,
    e.example_type,
    e.quality_score,
    1 - (e.embedding <=> query_embedding) as similarity
  FROM edit_examples e
  WHERE e.quality_score >= min_quality
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function to find similar learned patterns
CREATE OR REPLACE FUNCTION find_similar_patterns(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  pattern_type TEXT,
  original_form TEXT,
  preferred_form TEXT,
  context_description TEXT,
  confidence_score FLOAT,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.pattern_type,
    p.original_form,
    p.preferred_form,
    p.context_description,
    p.confidence_score,
    1 - (p.embedding <=> query_embedding) as similarity
  FROM learned_patterns p
  WHERE p.is_active = true
    AND p.confidence_score >= 0.3
    AND 1 - (p.embedding <=> query_embedding) > match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function to increment pattern usage
CREATE OR REPLACE FUNCTION increment_pattern_usage(pattern_ids UUID[])
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE learned_patterns
  SET
    times_applied = times_applied + 1,
    last_applied_at = NOW(),
    updated_at = NOW()
  WHERE id = ANY(pattern_ids);
END;
$$;

-- Function to handle pattern feedback (accept/reject)
CREATE OR REPLACE FUNCTION handle_pattern_feedback(
  p_applied_pattern_id UUID,
  p_accepted BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_pattern_id UUID;
BEGIN
  -- Get the pattern ID and update applied_patterns
  UPDATE applied_patterns
  SET user_accepted = p_accepted, feedback_at = NOW()
  WHERE id = p_applied_pattern_id
  RETURNING pattern_id INTO v_pattern_id;

  -- Update the learned pattern's confidence
  IF v_pattern_id IS NOT NULL THEN
    IF p_accepted THEN
      -- Acceptance: boost confidence slightly
      UPDATE learned_patterns
      SET
        confidence_score = LEAST(confidence_score + 0.02, 1.0),
        updated_at = NOW()
      WHERE id = v_pattern_id;
    ELSE
      -- Rejection: reduce confidence
      UPDATE learned_patterns
      SET
        times_overridden = times_overridden + 1,
        confidence_score = GREATEST(confidence_score - 0.1, 0),
        is_active = CASE WHEN confidence_score - 0.1 < 0.3 THEN false ELSE is_active END,
        updated_at = NOW()
      WHERE id = v_pattern_id;
    END IF;
  END IF;
END;
$$;
