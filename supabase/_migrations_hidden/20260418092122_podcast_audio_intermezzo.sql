-- Allow 'intermezzo' as a third type for podcast audio files.
-- Intro plays before dialog, outro after — intermezzo plays as background
-- music parallel to voice takes between two news articles.

ALTER TABLE podcast_audio_files
  DROP CONSTRAINT IF EXISTS podcast_audio_files_type_check;

ALTER TABLE podcast_audio_files
  ADD CONSTRAINT podcast_audio_files_type_check
  CHECK (type IN ('intro', 'outro', 'intermezzo'));
