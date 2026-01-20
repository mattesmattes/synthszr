-- Add gmail_message_id column for bulletproof deduplication
-- Instead of complex timestamp tracking, we simply store the Gmail message ID
-- and skip emails that have already been imported

ALTER TABLE daily_repo ADD COLUMN IF NOT EXISTS gmail_message_id TEXT;

-- Create unique index for fast lookups and to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_repo_gmail_message_id
ON daily_repo(gmail_message_id)
WHERE gmail_message_id IS NOT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN daily_repo.gmail_message_id IS 'Gmail message ID for deduplication. Newsletters always fetch last 48h and skip existing IDs.';
