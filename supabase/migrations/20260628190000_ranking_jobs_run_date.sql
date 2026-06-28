-- Genau ein Daily-Ranking-Job pro Tag (P0: createRankingJob race-/mehrfach-sicher).
ALTER TABLE ranking_jobs ADD COLUMN IF NOT EXISTS run_date date NOT NULL DEFAULT current_date;
CREATE UNIQUE INDEX IF NOT EXISTS ranking_jobs_daily_run_uq
  ON ranking_jobs(mode, run_date) WHERE mode = 'daily';
