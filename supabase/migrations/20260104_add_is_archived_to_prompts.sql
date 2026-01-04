-- Add is_archived column to all prompt tables
-- Prompts will be archived instead of deleted

ALTER TABLE ghostwriter_prompts
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

ALTER TABLE analysis_prompts
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

ALTER TABLE synthesis_prompts
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

ALTER TABLE image_prompts
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

-- Create indexes for filtering
CREATE INDEX IF NOT EXISTS idx_ghostwriter_prompts_archived ON ghostwriter_prompts(is_archived);
CREATE INDEX IF NOT EXISTS idx_analysis_prompts_archived ON analysis_prompts(is_archived);
CREATE INDEX IF NOT EXISTS idx_synthesis_prompts_archived ON synthesis_prompts(is_archived);
CREATE INDEX IF NOT EXISTS idx_image_prompts_archived ON image_prompts(is_archived);
