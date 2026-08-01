-- Kostenpflichtige Newsletter-/E-Mail-Abos, erkannt aus der Gmail-Inbox.
-- Ein Eintrag pro Anbieter (Dedup über provider_key = normalisierter provider_name).
CREATE TABLE IF NOT EXISTS paid_subscriptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name        TEXT NOT NULL,
  provider_key         TEXT NOT NULL,                    -- lowercase(getrimmt(provider_name)) — Dedup-Anker
  sender_domain        TEXT,                             -- nur Info, NICHT Dedup
  sender_email         TEXT,
  amount               NUMERIC(10,2),
  currency             TEXT,
  interval             TEXT DEFAULT 'unknown'
                         CHECK (interval IN ('monthly','yearly','quarterly','weekly','one_time','unknown')),
  amount_monthly       NUMERIC(10,2),
  last_payment_at      TIMESTAMPTZ,
  evidence_message_ids JSONB DEFAULT '[]'::jsonb,        -- [{id,subject,date,gmailLink}]
  unsubscribe_type     TEXT DEFAULT 'unknown'
                         CHECK (unsubscribe_type IN ('oneclick','http','mailto','login_portal','unknown')),
  unsubscribe_target   TEXT,
  is_content_source    BOOLEAN DEFAULT false,
  status               TEXT DEFAULT 'active'
                         CHECK (status IN ('active','cancelling','cancelled','ignored')),
  manually_added       BOOLEAN DEFAULT false,
  cancel_log           JSONB DEFAULT '[]'::jsonb,        -- [{ts,type,result,detail}]
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_paid_subscriptions_provider_key
  ON paid_subscriptions(provider_key);
CREATE INDEX IF NOT EXISTS idx_paid_subscriptions_status
  ON paid_subscriptions(status);
