-- Add video_type and script_data for "The Machine" concept
ALTER TABLE analogy_videos
  ADD COLUMN IF NOT EXISTS video_type TEXT NOT NULL DEFAULT 'analogy'
    CHECK (video_type IN ('analogy', 'machine')),
  ADD COLUMN IF NOT EXISTS script_data JSONB;

-- Update status check to include machine-specific statuses
ALTER TABLE analogy_videos DROP CONSTRAINT IF EXISTS analogy_videos_status_check;
ALTER TABLE analogy_videos ADD CONSTRAINT analogy_videos_status_check
  CHECK (status IN ('pending', 'generating_image', 'generating_audio', 'compositing', 'review', 'published', 'failed'));

CREATE INDEX IF NOT EXISTS idx_analogy_videos_type ON analogy_videos(video_type);
