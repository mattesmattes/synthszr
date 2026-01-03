-- Newsletter Subscribers and Send Log
-- Für Double-Opt-In Newsletter-System mit Resend

-- Subscriber-Tabelle
CREATE TABLE IF NOT EXISTS subscribers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'unsubscribed', 'bounced')),
  confirmation_token TEXT UNIQUE,
  confirmation_sent_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  preferences JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Newsletter-Versand-Log
CREATE TABLE IF NOT EXISTS newsletter_sends (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID REFERENCES generated_posts(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  preview_text TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  recipient_count INTEGER DEFAULT 0,
  resend_batch_id TEXT,
  status TEXT DEFAULT 'sent' CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indizes für häufige Abfragen
CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);
CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email);
CREATE INDEX IF NOT EXISTS idx_subscribers_confirmation_token ON subscribers(confirmation_token);
CREATE INDEX IF NOT EXISTS idx_newsletter_sends_post_id ON newsletter_sends(post_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_sends_sent_at ON newsletter_sends(sent_at DESC);

-- RLS Policies
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_sends ENABLE ROW LEVEL SECURITY;

-- Public kann sich anmelden (Insert) aber nicht lesen
CREATE POLICY "Allow public to subscribe" ON subscribers
  FOR INSERT TO anon
  WITH CHECK (true);

-- Service Role kann alles
CREATE POLICY "Service role full access subscribers" ON subscribers
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access newsletter_sends" ON newsletter_sends
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Anon kann newsletter_sends nicht lesen (nur Admin)
-- Anon kann Confirmation Token validieren (für Confirm-Endpunkt)
CREATE POLICY "Allow confirmation token lookup" ON subscribers
  FOR SELECT TO anon
  USING (confirmation_token IS NOT NULL);

CREATE POLICY "Allow status update on confirmation" ON subscribers
  FOR UPDATE TO anon
  USING (confirmation_token IS NOT NULL)
  WITH CHECK (true);
