-- Add cover_email to image_type CHECK constraint
-- Allows storing a separate email-optimized cover image (natively dithered at 604px)

-- Drop the existing constraint and add updated one
ALTER TABLE post_images DROP CONSTRAINT IF EXISTS post_images_image_type_check;
ALTER TABLE post_images ADD CONSTRAINT post_images_image_type_check
  CHECK (image_type IN ('cover', 'cover_email', 'article_thumbnail'));
