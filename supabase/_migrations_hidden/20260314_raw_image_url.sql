-- Add raw_image_url column to post_images for storing the pre-dithered raw image
-- Needed to regenerate email covers when a different cover is selected in admin
ALTER TABLE post_images ADD COLUMN IF NOT EXISTS raw_image_url text;
