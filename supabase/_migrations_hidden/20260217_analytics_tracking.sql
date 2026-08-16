-- Newsletter send recipients: maps Resend email IDs to newsletter sends
CREATE TABLE IF NOT EXISTS newsletter_send_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  newsletter_send_id UUID NOT NULL REFERENCES newsletter_sends(id) ON DELETE CASCADE,
  subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
  resend_email_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_send_recipients_send_id ON newsletter_send_recipients(newsletter_send_id);
CREATE INDEX idx_send_recipients_resend_id ON newsletter_send_recipients(resend_email_id);
ALTER TABLE newsletter_send_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON newsletter_send_recipients FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Email events: stores Resend webhook events (opens, clicks, bounces, etc.)
CREATE TABLE IF NOT EXISTS email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resend_email_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  recipient_email TEXT,
  newsletter_send_id UUID REFERENCES newsletter_sends(id) ON DELETE SET NULL,
  click_url TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_email_events_send_id ON email_events(newsletter_send_id);
CREATE INDEX idx_email_events_type ON email_events(event_type);
CREATE INDEX idx_email_events_resend_id ON email_events(resend_email_id);
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON email_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Podcast plays: anonymous play tracking with session dedup
CREATE TABLE IF NOT EXISTS podcast_plays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES generated_posts(id) ON DELETE CASCADE,
  locale TEXT DEFAULT 'de',
  user_agent TEXT,
  referrer TEXT,
  session_hash TEXT,
  played_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_podcast_plays_post_id ON podcast_plays(post_id);
CREATE INDEX idx_podcast_plays_played_at ON podcast_plays(played_at DESC);
ALTER TABLE podcast_plays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON podcast_plays FOR ALL TO service_role USING (true) WITH CHECK (true);
