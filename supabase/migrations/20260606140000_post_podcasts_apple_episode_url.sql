-- Per-episode Apple Podcasts deep link (resolved via iTunes Lookup).
-- Spotify keeps the show-level link (no key-free Spotify lookup available).
ALTER TABLE post_podcasts ADD COLUMN IF NOT EXISTS apple_episode_url TEXT;
