-- Post Audio - Text-to-Speech audio files for blog posts
-- Uses OpenAI TTS with dual voices (female for news, male for Synthszr Take)

-- ============================================
-- Post Audio Files Table
-- ============================================
CREATE TABLE IF NOT EXISTS post_audio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES generated_posts(id) ON DELETE CASCADE,
  locale VARCHAR(5) NOT NULL, -- 'de' or 'en'

  -- Audio file storage
  audio_url TEXT NOT NULL,
  duration_seconds INTEGER,
  file_size_bytes BIGINT,

  -- Generation metadata
  generation_status VARCHAR(20) DEFAULT 'pending'
    CHECK (generation_status IN ('pending', 'generating', 'completed', 'failed')),
  news_voice TEXT,           -- Voice used for news content (e.g., 'nova')
  synthszr_voice TEXT,       -- Voice used for Synthszr Take (e.g., 'onyx')
  model TEXT DEFAULT 'tts-1', -- OpenAI model used
  error_message TEXT,        -- Error details if generation failed

  -- Content hash for cache invalidation
  content_hash TEXT,         -- MD5 of source content, regenerate if changed

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(post_id, locale)
);

-- Indexes
CREATE INDEX idx_post_audio_post ON post_audio(post_id);
CREATE INDEX idx_post_audio_status ON post_audio(generation_status);
CREATE INDEX idx_post_audio_locale ON post_audio(locale);

-- RLS
ALTER TABLE post_audio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON post_audio FOR ALL USING (true);
CREATE POLICY "Public read access" ON post_audio FOR SELECT USING (generation_status = 'completed');

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_post_audio_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_post_audio_updated_at
  BEFORE UPDATE ON post_audio
  FOR EACH ROW
  EXECUTE FUNCTION update_post_audio_updated_at();

-- ============================================
-- TTS Settings in settings table
-- ============================================
-- Insert default TTS settings
INSERT INTO settings (key, value, updated_at) VALUES
  ('tts_news_voice_de', '"nova"'::jsonb, NOW()),
  ('tts_news_voice_en', '"nova"'::jsonb, NOW()),
  ('tts_synthszr_voice_de', '"onyx"'::jsonb, NOW()),
  ('tts_synthszr_voice_en', '"onyx"'::jsonb, NOW()),
  ('tts_model', '"tts-1"'::jsonb, NOW()),
  ('tts_enabled', 'true'::jsonb, NOW())
ON CONFLICT (key) DO NOTHING;
