-- Retire the legacy per-article post_audio feature.
--
-- post_audio held a single-voice TTS rendering for each blog post,
-- written by lib/tts/openai-tts.ts::generatePostAudio. The two-speaker
-- podcast superseded it long ago; no frontend reads the table and no
-- /api route still writes to it. The table, its indexes and policies
-- get dropped here so we stop paying for orphaned rows and so the
-- TypeScript types stop referencing a deprecated shape.

DROP TABLE IF EXISTS post_audio CASCADE;
