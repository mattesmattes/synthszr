-- Add 'cover_desktop' to the image_type CHECK constraint for desktop-optimized cover images
ALTER TABLE post_images DROP CONSTRAINT IF EXISTS post_images_image_type_check;
ALTER TABLE post_images ADD CONSTRAINT post_images_image_type_check
  CHECK (image_type IN ('cover', 'cover_email', 'cover_desktop', 'article_thumbnail'));
