-- Podcast personality state for episode continuity
-- Tracks evolving HOST/GUEST personalities and their relationship across episodes

CREATE TABLE podcast_personality_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locale text NOT NULL DEFAULT 'de',
  episode_count integer NOT NULL DEFAULT 0,

  -- Relationship phase: strangers → acquaintances → colleagues → friends → close_friends
  relationship_phase text NOT NULL DEFAULT 'strangers',

  -- HOST personality dimensions (0.0 = Minimum, 1.0 = Maximum)
  host_warmth float NOT NULL DEFAULT 0.5,
  host_humor float NOT NULL DEFAULT 0.4,
  host_formality float NOT NULL DEFAULT 0.6,
  host_curiosity float NOT NULL DEFAULT 0.7,
  host_self_awareness float NOT NULL DEFAULT 0.2,

  -- GUEST personality dimensions
  guest_confidence float NOT NULL DEFAULT 0.6,
  guest_playfulness float NOT NULL DEFAULT 0.3,
  guest_directness float NOT NULL DEFAULT 0.7,
  guest_empathy float NOT NULL DEFAULT 0.4,
  guest_self_awareness float NOT NULL DEFAULT 0.2,

  -- Relationship dynamics
  mutual_comfort float NOT NULL DEFAULT 0.2,
  flirtation_tendency float NOT NULL DEFAULT 0.0,
  inside_joke_count integer NOT NULL DEFAULT 0,

  -- Memory: last 5 memorable moments
  memorable_moments jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Timestamps
  last_episode_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(locale)
);
