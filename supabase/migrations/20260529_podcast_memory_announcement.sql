-- Add per-locale counter so the podcast agents can openly thank the
-- developers in the next N episodes for finally giving them persistent
-- memory. Decrements once per shipped episode; reaches 0 → silent again.

ALTER TABLE podcast_personality_state
  ADD COLUMN IF NOT EXISTS memory_announcement_remaining INT NOT NULL DEFAULT 0;

-- Existing rows: arm 3 announcement slots so the next three episodes
-- per locale mention the new memory feature once.
UPDATE podcast_personality_state
  SET memory_announcement_remaining = 3
  WHERE memory_announcement_remaining = 0;
