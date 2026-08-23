-- Tageszählungen für die Admin-Statistik.
--
-- WARUM: Die Statistik-Seite las für die 3-Monats-Ansicht ~100.000 Rohzeilen
-- (~15 MB, ~100 sequenzielle Requests) und zählte sie in JavaScript, um daraus
-- 90 Balken zu machen — die Seite hing (Befund 2026-08-23). Diese Funktion
-- liefert dieselbe Auskunft als ~90 Zeilen.
--
-- WARUM ALS FUNKTION: Supabase verbietet Aggregate in PostgREST-Abfragen
-- (PGRST123 "Use of aggregate functions is not allowed"), und der Schalter dafür
-- ist im Dashboard nicht mehr erreichbar. Innerhalb einer Datenbankfunktion
-- greift das Verbot nicht.
--
-- EINSPIELEN: Supabase-Dashboard → SQL Editor → einfügen → Run.
-- Gefahrlos wiederholbar (create or replace), ändert keine Daten und kein Schema.

create or replace function public.analytics_daily_counts(
  p_from          timestamptz,
  p_to            timestamptz default null,
  p_event_type    text        default null,
  -- POSIX-Regex auf path, z. B. '/rankings(/|$)'
  p_path_match    text        default null,
  -- /admin/… ausschließen: das Redaktionswerkzeug ist keine Leser-Nutzung
  p_exclude_admin boolean     default false
)
returns table (bucket date, n bigint)
language sql
stable
as $$
  -- Tagesgrenze in Berliner Zeit, nicht UTC: der Betreiber denkt in seinem Tag,
  -- und 22:30 UTC ist hier bereits der Folgetag.
  select (created_at at time zone 'Europe/Berlin')::date as bucket,
         count(*)::bigint as n
  from public.analytics_events
  where created_at >= p_from
    and (p_to is null            or created_at <  p_to)
    and (p_event_type is null    or event_type =  p_event_type)
    and (p_path_match is null    or path ~ p_path_match)
    and (not p_exclude_admin     or path is null or path not like '/admin/%')
  group by 1
  order by 1;
$$;

create or replace function public.podcast_plays_daily_counts(
  p_from timestamptz,
  p_to   timestamptz default null
)
returns table (bucket date, n bigint)
language sql
stable
as $$
  select (played_at at time zone 'Europe/Berlin')::date as bucket,
         count(*)::bigint as n
  from public.podcast_plays
  where played_at >= p_from
    and (p_to is null or played_at < p_to)
  group by 1
  order by 1;
$$;

-- Nur der Server ruft diese Funktionen (Admin-Statistik). Kein Zugriff für
-- anon/authenticated — sonst wäre die Besucherstatistik öffentlich auslesbar.
revoke all on function public.analytics_daily_counts(timestamptz, timestamptz, text, text, boolean) from public, anon, authenticated;
revoke all on function public.podcast_plays_daily_counts(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.analytics_daily_counts(timestamptz, timestamptz, text, text, boolean) to service_role;
grant execute on function public.podcast_plays_daily_counts(timestamptz, timestamptz) to service_role;
