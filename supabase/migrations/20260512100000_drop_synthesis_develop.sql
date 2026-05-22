-- Drop the synthesis-development pipeline.
-- developSynthesis (Claude Sonnet 4.6) historically produced
-- "Mattes Synthese" research blocks that the legacy single-pass
-- ghostwriter route consumed. The current per-section pipeline
-- (writeSection in lib/claude/ghostwriter-pipeline.ts) doesn't read
-- them anymore, so the daily synthesis_development LLM calls and
-- the developed_syntheses rows are dead weight.
--
-- Scoring (synthesis_scoring → news_queue ranking) stays alive; only
-- the develop side is removed.

DROP TABLE IF EXISTS developed_syntheses CASCADE;
DROP TABLE IF EXISTS synthesis_candidates CASCADE;
DROP TABLE IF EXISTS synthesis_prompts CASCADE;
