-- Article Thumbnails Extension
-- Adds support for per-article thumbnails with vote-based background colors

-- Add article_index to distinguish cover images from article thumbnails
-- NULL = cover image, 0+ = article thumbnail at that index
ALTER TABLE post_images ADD COLUMN IF NOT EXISTS article_index INTEGER;

-- Add vote_color to store the background color based on Synthszr Vote
-- Values: #CCFF00 (no vote), #39FF14 (BUY), #00FFFF (HOLD), #FF6600 (SELL)
ALTER TABLE post_images ADD COLUMN IF NOT EXISTS vote_color TEXT;

-- Add image_type to clearly distinguish image purposes
ALTER TABLE post_images ADD COLUMN IF NOT EXISTS image_type TEXT DEFAULT 'cover'
  CHECK (image_type IN ('cover', 'article_thumbnail'));

-- Index for efficient article thumbnail queries
CREATE INDEX IF NOT EXISTS idx_post_images_article ON post_images(post_id, article_index)
  WHERE article_index IS NOT NULL;

-- Comment
COMMENT ON COLUMN post_images.article_index IS 'Article position in post (0-based). NULL for cover images.';
COMMENT ON COLUMN post_images.vote_color IS 'Background color hex based on Synthszr Vote for article thumbnails.';
COMMENT ON COLUMN post_images.image_type IS 'Type of image: cover or article_thumbnail';
