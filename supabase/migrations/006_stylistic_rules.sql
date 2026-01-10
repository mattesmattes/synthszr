-- Synthszr Stylistic Rules Extension
-- Run this migration in Supabase SQL Editor

-- ============================================
-- Stylistic Rules & Observations
-- ============================================
-- Stores metadata about writing style that cannot be expressed as simple term replacements

CREATE TABLE IF NOT EXISTS stylistic_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_type TEXT NOT NULL CHECK (rule_type IN (
    'sprachregister',      -- Language register (academic, journalistic, colloquial)
    'metapherntyp',        -- Types of metaphors used
    'interpunktion',       -- Punctuation preferences
    'personalpronomina',   -- Pronoun preferences (wir/uns vs ich/man)
    'textlaenge',          -- Sentence/text length preferences
    'zitierverhalten',     -- Citation behavior
    'autorenzitat',        -- Frequently cited authors
    'stilregel'            -- General style rules
  )),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  examples TEXT,           -- Optional examples
  priority INTEGER DEFAULT 50,  -- 1-100, higher = more important
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stylistic_rules_type ON stylistic_rules(rule_type);
CREATE INDEX idx_stylistic_rules_active ON stylistic_rules(is_active) WHERE is_active = true;

-- Row Level Security
ALTER TABLE stylistic_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON stylistic_rules FOR ALL USING (true);

-- ============================================
-- Extend vocabulary_dictionary categories
-- ============================================
-- Add a comment documenting the extended category values
COMMENT ON COLUMN vocabulary_dictionary.category IS
'Categories: general, tech, business, brand, style,
fachbegriff, eigener_fachbegriff, anglizismus, metapher, neologismus,
business_jargon, startup_jargon, akronym, bildliche_sprache,
redewendung, satzkonstruktion, phrase, umgangssprache, fremdwort,
wortspiel, mantra, praefixbildung, zitat';
