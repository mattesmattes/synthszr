-- Premium Source Bonus: Tier-based scoring for newsletter sources
-- Tier 1 = +3, Tier 2 = +2, Tier 3 = +1 points added to total_score

-- 1a) premium_tier auf newsletter_sources
ALTER TABLE newsletter_sources
  ADD COLUMN premium_tier SMALLINT CHECK (premium_tier IN (1, 2, 3));

-- 1b) source_bonus auf news_queue
ALTER TABLE news_queue
  ADD COLUMN source_bonus NUMERIC(3,1) DEFAULT 0;

-- 1c) Drop dependent view before modifying total_score column
DROP VIEW IF EXISTS news_queue_selectable;

-- 1d) total_score Formel erweitern (DROP + ADD für generated column)
ALTER TABLE news_queue DROP COLUMN total_score;
ALTER TABLE news_queue ADD COLUMN total_score NUMERIC(4,1) GENERATED ALWAYS AS (
  synthesis_score * 0.4 + relevance_score * 0.3 + uniqueness_score * 0.3 + COALESCE(source_bonus, 0)
) STORED;

-- 1e) Index neu erstellen (wurde mit DROP COLUMN gelöscht)
CREATE INDEX idx_news_queue_score ON news_queue(total_score DESC) WHERE status = 'pending';

-- 1f) View news_queue_selectable neu erstellen
CREATE OR REPLACE VIEW news_queue_selectable AS
WITH source_stats AS (
  SELECT
    source_identifier,
    COUNT(*) FILTER (WHERE status IN ('selected', 'used')) as committed_count
  FROM news_queue
  WHERE queued_at >= NOW() - INTERVAL '2 days'
  GROUP BY source_identifier
),
total_committed AS (
  SELECT COALESCE(SUM(committed_count), 0) as total
  FROM source_stats
)
SELECT
  q.*,
  COALESCE(s.committed_count, 0) as source_committed_count,
  t.total as total_committed,
  CASE
    WHEN t.total = 0 THEN true
    WHEN COALESCE(s.committed_count, 0)::numeric / GREATEST(t.total, 1) < 0.30 THEN true
    ELSE false
  END as within_source_limit
FROM news_queue q
LEFT JOIN source_stats s ON q.source_identifier = s.source_identifier
CROSS JOIN total_committed t
WHERE q.status = 'pending'
  AND q.expires_at > NOW()
ORDER BY q.total_score DESC;

-- 1e) Premium-Tiers setzen
-- TIER 1 (+3 Punkte)
UPDATE newsletter_sources SET premium_tier = 1 WHERE email IN (
  'email@stratechery.com',
  'hello@theinformation.com',
  'aaron@theinformation.com',
  'stephanie@theinformation.com',
  'info@theinformation.com',
  'pragmaticengineer+deepdives@substack.com',
  'pragmaticengineer+the-pulse@substack.com',
  'semianalysis@substack.com',
  'casey@platformer.news',
  'wallstreetjournal@mail.dowjones.com',
  'ki.briefing@redaktion.handelsblatt.com',
  'a16z@substack.com',
  'exponentialview@substack.com',
  'newsletters@technologyreview.com',
  'promotions@technologyreview.com',
  'hello@every.to',
  'importai@substack.com',
  'nomercynomalice@mail.profgalloway.com',
  'hello@mail.profgalloway.com',
  'profgmarkets@mail.beehiiv.com',
  'lenny@substack.com',
  'lenny+how-i-ai@substack.com'
);

-- TIER 2 (+2 Punkte)
UPDATE newsletter_sources SET premium_tier = 2 WHERE email IN (
  'noahpinion@substack.com',
  'paulkrugman@substack.com',
  'astralcodexten@substack.com',
  'garymarcus@substack.com',
  'thegeneralist@substack.com',
  'swyx+ainews@substack.com',
  'chipstrat@substack.com',
  'derekthompson@substack.com',
  'newcomer@substack.com',
  'connie@strictlyvc.com',
  'thealgorithmicbridge@substack.com',
  'thealgorithmicbridge+weekly-top-picks@substack.com',
  'thealgorithmicbridge+how-to-guides@substack.com',
  'technology@semafor.com',
  'reply@semafor.com',
  'ki-pro@heise.de',
  'hardcoresoftware@substack.com',
  'pip@mail.doppelgaenger.io',
  'der_tag@angebote.manager-magazin.de',
  'tech.update@angebote.manager-magazin.de',
  'theleverage@substack.com'
);

-- TIER 3 (+1 Punkt)
UPDATE newsletter_sources SET premium_tier = 3 WHERE email IN (
  'newsletter@techmeme.com',
  'dan@tldrnewsletter.com',
  'news@alphasignal.ai',
  'turingpost@mail.beehiiv.com',
  'news@daily.therundown.ai',
  'thesequence@substack.com',
  'subscriptions@seekingalpha.com',
  'account@seekingalpha.com',
  'techbrew@morningbrew.com',
  'crew@morningbrew.com',
  'marketingbrew@morningbrew.com'
);

-- 1f) Bonus für bestehende pending items nachträglich setzen
UPDATE news_queue nq
SET source_bonus = CASE ns.premium_tier
  WHEN 1 THEN 3.0
  WHEN 2 THEN 2.0
  WHEN 3 THEN 1.0
  ELSE 0
END
FROM newsletter_sources ns
WHERE nq.source_identifier = ns.email
  AND ns.premium_tier IS NOT NULL
  AND nq.status = 'pending';
