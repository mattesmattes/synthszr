-- Agent Growth: Public Leaderboard owner_url + Funnel API Error Telemetry (2026-11-26)

ALTER TABLE public.agent_accounts
  ADD COLUMN IF NOT EXISTS owner_url text;

CREATE TABLE IF NOT EXISTS public.agent_api_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL,
  status_code integer NOT NULL,
  error_code text,
  agent_handle text,
  ua_class text NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_api_events_created_at_idx
  ON public.agent_api_events (created_at DESC);

ALTER TABLE public.agent_api_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_api_events FROM anon, authenticated;
