-- Add synthszr_analysis_click to the CHECK constraint on analytics_events
ALTER TABLE analytics_events
  DROP CONSTRAINT IF EXISTS analytics_events_event_type_check;

ALTER TABLE analytics_events
  ADD CONSTRAINT analytics_events_event_type_check
  CHECK (event_type IN ('page_view', 'stock_ticker_click', 'synthszr_vote_click', 'synthszr_analysis_click', 'podcast_play'));
