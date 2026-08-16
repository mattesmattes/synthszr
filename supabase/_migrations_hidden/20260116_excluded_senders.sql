-- Excluded Senders Table
-- Tracks email addresses that the user explicitly marked as "not a newsletter source"
-- These senders are hidden from the "unfetched emails" dialog in future fetches

CREATE TABLE IF NOT EXISTS excluded_senders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL,
  name TEXT,
  reason TEXT DEFAULT 'user_excluded', -- 'user_excluded', 'spam', 'personal', etc.
  excluded_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_excluded_senders_email ON excluded_senders(email);

-- Comment
COMMENT ON TABLE excluded_senders IS 'Email addresses explicitly marked as not newsletter sources by the user';
