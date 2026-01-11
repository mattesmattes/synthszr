-- Store queue item IDs with draft posts, only mark as used on publish
-- This ensures items are only marked as "used" when the post is actually published

-- Add column to store pending queue item IDs
ALTER TABLE generated_posts
ADD COLUMN IF NOT EXISTS pending_queue_item_ids UUID[] DEFAULT '{}';

-- Add comment explaining the column
COMMENT ON COLUMN generated_posts.pending_queue_item_ids IS
  'Queue item IDs waiting to be marked as used when post is published';
