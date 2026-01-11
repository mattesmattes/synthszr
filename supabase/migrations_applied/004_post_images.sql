-- Post Images for AI-generated visualizations
-- Run this migration in Supabase SQL Editor

-- ============================================
-- Post Images Table
-- ============================================
CREATE TABLE post_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID REFERENCES generated_posts(id) ON DELETE CASCADE,
  daily_repo_id UUID REFERENCES daily_repo(id) ON DELETE SET NULL,
  image_url TEXT NOT NULL,
  prompt_text TEXT,
  source_text TEXT,  -- The news text used to generate the image
  is_cover BOOLEAN DEFAULT false,
  generation_status TEXT DEFAULT 'pending' CHECK (generation_status IN ('pending', 'generating', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_post_images_post ON post_images(post_id);
CREATE INDEX idx_post_images_daily_repo ON post_images(daily_repo_id);
CREATE INDEX idx_post_images_cover ON post_images(is_cover) WHERE is_cover = true;

-- Ensure only one cover image per post
CREATE UNIQUE INDEX idx_post_images_single_cover ON post_images(post_id) WHERE is_cover = true;

-- ============================================
-- Add cover_image_id to generated_posts
-- ============================================
ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS cover_image_id UUID REFERENCES post_images(id) ON DELETE SET NULL;

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE post_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON post_images FOR ALL USING (true);

-- ============================================
-- Function: Set cover image (ensures only one)
-- ============================================
CREATE OR REPLACE FUNCTION set_cover_image(p_post_id UUID, p_image_id UUID)
RETURNS void AS $$
BEGIN
  -- Remove existing cover
  UPDATE post_images SET is_cover = false WHERE post_id = p_post_id;
  -- Set new cover
  UPDATE post_images SET is_cover = true WHERE id = p_image_id AND post_id = p_post_id;
  -- Update generated_posts reference
  UPDATE generated_posts SET cover_image_id = p_image_id WHERE id = p_post_id;
END;
$$ LANGUAGE plpgsql;
