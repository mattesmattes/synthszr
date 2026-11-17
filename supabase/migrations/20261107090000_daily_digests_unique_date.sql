-- Ein Digest pro Tag — ab 2026-11-07.
--
-- BEFUND 2026-11-07: Drei parallel gestartete Tagesanalysen (Testlauf mit
-- echtem CRON_SECRET gegen Production) speicherten drei Digests fuer
-- denselben Tag. digest_date hatte nur einen einfachen Index; Code, der den
-- Tages-Digest per .single() liest — u. a. die Bestandspruefung der Analyse
-- selbst —, bricht bei mehreren Zeilen.
--
-- PARTIELL, weil die Historie 28 Tage mit Doppeln enthaelt (Jan.–Sep. 2026),
-- teils manuelle Zweitanalysen, an denen 26 Posts und 5 Artikel-Jobs haengen.
-- Die bleiben unangetastet; der Index gilt nur ab dem ersten bereinigten Tag.
--
-- Einspielen NUR per
--   cd /Users/mattes/dev/synthszr && npx -y supabase@2.84.1 db query --linked --file <absoluter Pfad>
-- (niemals supabase db push).

CREATE UNIQUE INDEX IF NOT EXISTS daily_digests_digest_date_unique_since_20261107
  ON daily_digests (digest_date)
  WHERE digest_date >= DATE '2026-11-07';
