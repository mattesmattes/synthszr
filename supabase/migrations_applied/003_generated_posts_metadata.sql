-- Add metadata fields to generated_posts for direct publishing
-- Run this migration in Supabase SQL Editor

-- Add slug column for URL-friendly identifier
ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS slug TEXT;

-- Add excerpt for article preview/SEO description
ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS excerpt TEXT;

-- Add category for content organization
ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'AI & Tech';

-- Create index on slug for fast lookups
CREATE INDEX IF NOT EXISTS idx_generated_posts_slug ON generated_posts(slug);

-- Create index on category for filtering
CREATE INDEX IF NOT EXISTS idx_generated_posts_category ON generated_posts(category);

-- Add unique constraint on slug (only for non-null slugs)
CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_posts_slug_unique ON generated_posts(slug) WHERE slug IS NOT NULL;
