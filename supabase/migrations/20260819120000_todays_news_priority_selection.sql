-- Heutiger Kalendertag zuerst in der Balanced Queue Selection
--
-- Befund 2026-08-19: Eine 18h alte Techmeme-Story mit sehr hohem Rohscore
-- (Rang 0 auf Techmeme, 17 berichtende Quellen, total_score 10.56) gewann im
-- automatischen Tages-Lauf gegen frischere, aber noch schwach bewertete News
-- vom selben Morgen (total_score 6.1-6.7, nur ~2.5h alt). Der bestehende
-- Recency-Malus (20260322_recency_boost_selection.sql, max -20% nach 48h)
-- kann einen Score-Abstand dieser Groessenordnung rechnerisch nicht
-- ausgleichen: selbst mit einem auf -50% verschaerften Malus haette die
-- AirPods-Story bei ihrem tatsaechlichen Alter (18.6h) noch 8.51 erreicht,
-- die frischen Konkurrenten nur 6.1-6.7. Ein Malus, der das umdreht, muesste
-- Scores nach 1-2 Tagen praktisch auf Null decken — und wuerde damit auch
-- echte, weiterhin wichtige grosse Stories aus der Auswahl kippen.
--
-- Deshalb keine staerkere Dämpfung, sondern eine harte Prioritaet DAVOR:
-- Items, die seit Mitternacht (Europe/Berlin, DST-sicher via AT TIME ZONE)
-- in der Queue stehen, werden IMMER vor aelterem Bestand einsortiert —
-- unabhaengig vom Score. Der bestehende Recency-Malus bleibt unveraendert
-- als Sortierkriterium INNERHALB jeder der beiden Gruppen bestehen (er ist
-- dort weiterhin sinnvoll, z.B. um eine 20h alte "heutige" Story leicht
-- gegenueber einer druckfrischen zu daempfen). Aelterer Bestand wird nur
-- herangezogen, wenn der heutige Vorrat max_items nicht fuellt — der
-- bisherige Normalfall bei duennem Nachrichtenaufkommen.
--
-- Ein einziger Durchlauf statt zwei getrennter Schleifen: die
-- Tages-Zugehoerigkeit geht als Sortier-Prioritaet VOR den Score ein
-- (ORDER BY is_backlog ASC, boosted_score DESC). is_backlog ist FALSE fuer
-- heutige Items und sortiert in Postgres vor TRUE — identische Wirkung zu
-- zwei Durchgaengen, ohne die Schleife und ihre Sperren-Logik zu duplizieren.

CREATE OR REPLACE FUNCTION get_balanced_queue_selection(
  max_items INTEGER DEFAULT 10,
  target_source_limit NUMERIC DEFAULT 0.30
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  source_identifier TEXT,
  source_display_name TEXT,
  total_score NUMERIC,
  selection_rank INTEGER
) AS $$
DECLARE
  selected_count INTEGER := 0;
  source_counts JSONB := '{}'::jsonb;
  item RECORD;
  max_per_source INTEGER;
  today_start TIMESTAMPTZ;
BEGIN
  -- Calculate absolute maximum items per source (30% of max_items, at least 1)
  max_per_source := GREATEST(1, FLOOR(max_items * target_source_limit)::INTEGER);

  -- Mitternacht in Berliner Ortszeit, als TIMESTAMPTZ — vergleichbar direkt
  -- gegen queued_at/email_received_at, DST-sicher weil AT TIME ZONE die
  -- Zonenregeln fuer das jeweilige Datum anwendet statt einen festen Offset.
  today_start := date_trunc('day', NOW() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin';

  -- Iterate: heutige Items zuerst (is_backlog=false sortiert vor true),
  -- je Gruppe weiterhin nach recency-geboostetem Score, excluding webcrawl
  FOR item IN
    SELECT
      q.id,
      q.title,
      q.source_identifier,
      q.source_display_name,
      q.total_score,
      COALESCE(q.email_received_at, q.queued_at) < today_start AS is_backlog,
      -- Recency-boosted score for ordering only
      q.total_score * (
        1.0 - LEAST(
          EXTRACT(EPOCH FROM (NOW() - COALESCE(q.email_received_at, q.queued_at))) / 172800.0,
          1.0
        ) * 0.2
      ) AS boosted_score
    FROM news_queue q
    LEFT JOIN daily_repo dr ON q.daily_repo_id = dr.id
    WHERE q.status = 'pending'
      AND q.expires_at > NOW()
      AND (dr.source_type IS NULL OR dr.source_type != 'webcrawl')
    ORDER BY
      (COALESCE(q.email_received_at, q.queued_at) < today_start) ASC,
      q.total_score * (
        1.0 - LEAST(
          EXTRACT(EPOCH FROM (NOW() - COALESCE(q.email_received_at, q.queued_at))) / 172800.0,
          1.0
        ) * 0.2
      ) DESC
  LOOP
    -- Check if adding this item would exceed source limit
    DECLARE
      current_source_count INTEGER;
      should_skip BOOLEAN := false;
    BEGIN
      current_source_count := COALESCE((source_counts->>item.source_identifier)::INTEGER, 0);

      -- Hard limit: no source can exceed max_per_source items
      IF current_source_count >= max_per_source THEN
        should_skip := true;
      END IF;

      IF should_skip THEN
        CONTINUE;
      END IF;

      -- Select this item
      selected_count := selected_count + 1;
      source_counts := jsonb_set(
        source_counts,
        ARRAY[item.source_identifier],
        to_jsonb(current_source_count + 1)
      );

      id := item.id;
      title := item.title;
      source_identifier := item.source_identifier;
      source_display_name := item.source_display_name;
      total_score := item.total_score;  -- Return the static score, not boosted
      selection_rank := selected_count;

      RETURN NEXT;

      EXIT WHEN selected_count >= max_items;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
