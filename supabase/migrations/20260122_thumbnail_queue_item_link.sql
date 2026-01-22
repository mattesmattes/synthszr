-- Link article thumbnails to news_queue items instead of position indices
--
-- Problem: article_index is a position (0, 1, 2...) that breaks when articles
-- are deleted or reordered in the editor.
--
-- Solution: Add article_queue_item_id to link thumbnails directly to queue items.
-- This creates a stable reference that survives article editing.

-- Add the new column
ALTER TABLE post_images ADD COLUMN IF NOT EXISTS article_queue_item_id UUID REFERENCES news_queue(id) ON DELETE SET NULL;

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS post_images_queue_item_idx ON post_images(article_queue_item_id);

-- Comment for documentation
COMMENT ON COLUMN post_images.article_queue_item_id IS 'Stable link to news_queue item. Survives article deletion/reordering unlike article_index.';
