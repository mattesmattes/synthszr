-- Add self_irony dimension to podcast personality state
-- Tracks how much the speakers make fun of themselves and their AI nature
ALTER TABLE podcast_personality_state ADD COLUMN IF NOT EXISTS self_irony float NOT NULL DEFAULT 0.5;
