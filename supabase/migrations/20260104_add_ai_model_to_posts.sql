-- Add ai_model column to generated_posts table
-- Tracks which AI model was used to generate the article

ALTER TABLE generated_posts
ADD COLUMN IF NOT EXISTS ai_model TEXT DEFAULT 'gemini-2.5-pro';

-- Update existing posts to have the default model
UPDATE generated_posts
SET ai_model = 'gemini-2.5-pro'
WHERE ai_model IS NULL;

-- Create index for filtering by model
CREATE INDEX IF NOT EXISTS idx_generated_posts_ai_model ON generated_posts(ai_model);

-- Add comment for documentation
COMMENT ON COLUMN generated_posts.ai_model IS 'AI model used for generation: claude-opus-4, claude-sonnet-4, or gemini-2.5-pro';
