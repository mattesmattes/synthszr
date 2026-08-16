ALTER TABLE podcast_personality_state ADD COLUMN IF NOT EXISTS relationship_paused boolean DEFAULT false;
