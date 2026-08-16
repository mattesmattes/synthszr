-- Add article-level tracking to post_company_mentions
-- This allows showing which specific article (H2 section) within a post mentions a company

-- Add new columns for article-level data
ALTER TABLE post_company_mentions
ADD COLUMN article_index INTEGER,
ADD COLUMN article_queue_item_id UUID,
ADD COLUMN article_headline TEXT,
ADD COLUMN article_excerpt TEXT;

-- Drop old unique constraint (one company per post)
ALTER TABLE post_company_mentions DROP CONSTRAINT post_company_mentions_post_id_company_slug_key;

-- Add new unique constraint (one company per article per post)
-- A company can now appear in multiple articles within the same post
ALTER TABLE post_company_mentions
ADD CONSTRAINT post_company_mentions_post_article_company_key
UNIQUE(post_id, company_slug, article_index);

-- Index for fast lookups by queue item ID (stable article identifier)
CREATE INDEX idx_pcm_queue_item ON post_company_mentions(article_queue_item_id);

-- Index for article-based queries
CREATE INDEX idx_pcm_article ON post_company_mentions(post_id, article_index);

-- Update table comment
COMMENT ON TABLE post_company_mentions IS 'Tracks which companies are mentioned in which articles (H2 sections) within blog posts. Used for /companies page with article-level detail.';
COMMENT ON COLUMN post_company_mentions.article_index IS '0-based index of the H2 section where the company is mentioned';
COMMENT ON COLUMN post_company_mentions.article_queue_item_id IS 'Stable reference to news_queue item (survives article reordering)';
COMMENT ON COLUMN post_company_mentions.article_headline IS 'The H2 headline of the article section';
COMMENT ON COLUMN post_company_mentions.article_excerpt IS 'Short excerpt from the article for preview display';
