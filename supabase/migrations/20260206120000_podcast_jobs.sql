-- Podcast Generation Job Queue
-- Allows long-running podcast generation without API timeouts

CREATE TABLE podcast_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Job configuration
  script TEXT NOT NULL,
  host_voice_id TEXT NOT NULL,
  guest_voice_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'elevenlabs', -- 'elevenlabs' or 'openai'
  model TEXT, -- elevenlabs model or openai model
  title TEXT,

  -- Progress tracking
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  progress INTEGER DEFAULT 0, -- 0-100
  current_line INTEGER DEFAULT 0,
  total_lines INTEGER DEFAULT 0,

  -- Results
  audio_url TEXT,
  segment_urls JSONB, -- Array of segment URLs for stereo mixing
  segment_metadata JSONB, -- Metadata for each segment
  duration_seconds INTEGER,

  -- Error handling
  error_message TEXT,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- User tracking (optional)
  created_by TEXT
);

-- Index for finding pending jobs
CREATE INDEX idx_podcast_jobs_status ON podcast_jobs(status, created_at);
CREATE INDEX idx_podcast_jobs_pending ON podcast_jobs(status) WHERE status = 'pending';

-- RLS
ALTER TABLE podcast_jobs ENABLE ROW LEVEL SECURITY;

-- Allow all operations (admin-only endpoint anyway)
CREATE POLICY "Allow all podcast_jobs operations"
  ON podcast_jobs FOR ALL
  USING (true)
  WITH CHECK (true);
