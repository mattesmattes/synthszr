-- Analogy Machine: Video generation from blog post analogies
-- Pattern: podcast_jobs (status tracking, error handling, crash recovery)

CREATE TABLE analogy_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES generated_posts(id) ON DELETE CASCADE,

  -- Extracted content
  analogy_text TEXT NOT NULL,
  context_text TEXT,
  source_section TEXT,

  -- Pipeline status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'generating_image', 'generating_audio', 'compositing', 'review', 'published', 'failed')),
  progress INTEGER DEFAULT 0,

  -- Image
  image_prompt TEXT,
  image_url TEXT,
  image_fallback BOOLEAN DEFAULT FALSE,

  -- Audio
  audio_url TEXT,
  audio_duration_seconds FLOAT,

  -- Video
  video_url TEXT,
  video_duration_seconds FLOAT,
  thumbnail_url TEXT,

  -- Error handling
  error_message TEXT,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for job processing
CREATE INDEX idx_analogy_videos_status ON analogy_videos(status, created_at);
CREATE INDEX idx_analogy_videos_post ON analogy_videos(post_id);
CREATE INDEX idx_analogy_videos_pending ON analogy_videos(status) WHERE status = 'pending';

-- RLS
ALTER TABLE analogy_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all analogy_videos operations"
  ON analogy_videos FOR ALL
  USING (true)
  WITH CHECK (true);
