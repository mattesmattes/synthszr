-- SEC-017: search_path für alle public-Funktionen fixieren.
--
-- Der Supabase Security Advisor meldet 20 Funktionen mit "role mutable
-- search_path". Ohne festen search_path bestimmt der Aufrufer, in welchem
-- Schema unqualifizierte Namen aufgelöst werden - wer CREATE-Rechte auf einem
-- Schema im Suchpfad hat, kann eine Tabelle oder Funktion shadowen.
--
-- EINSCHÄTZUNG: Low. Keine der 20 Funktionen ist SECURITY DEFINER (geprüft
-- über alle 101 Migrationen; die einzige DEFINER-Funktion, claim_ranking_job,
-- steht nicht auf der Advisor-Liste und hat ihren search_path bereits). Bei
-- SECURITY INVOKER läuft die Funktion mit den Rechten des Aufrufers, ein
-- manipulierter Suchpfad eskaliert also keine Rechte. Zudem haben anon und
-- authenticated seit dem RLS-Umbau keine CREATE-Rechte auf public.
-- Der Fix ist trotzdem sinnvoll: er ist einzeilig pro Funktion und schließt
-- die Lücke, falls eine dieser Funktionen später auf DEFINER umgestellt wird.
--
-- Gesetzt wird `pg_catalog, public` - dasselbe Muster wie bei den
-- Cleanup-Funktionen aus SEC-001/008/015. `public` MUSS enthalten bleiben,
-- weil die Extensions `vector` und `pg_trgm` dort installiert sind: die
-- match_*- und find_similar_*-Funktionen brauchen deren Operatoren.

-- ---------------------------------------------------------------------------
-- DIAGNOSE - vor dem Fix ausführen und die Ausgabe prüfen.
-- Erwartung: prosecdef ist überall false. Steht dort auch nur ein true,
-- NICHT blind weitermachen, sondern die betroffene Funktion einzeln ansehen.
-- ---------------------------------------------------------------------------
-- select p.oid::regprocedure as signatur,
--        p.prosecdef        as security_definer,
--        p.proconfig        as aktuelle_settings
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.prokind = 'f'
--   and not exists (
--     select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
--   )
-- order by p.prosecdef desc, signatur;

-- ---------------------------------------------------------------------------
-- FIX
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
  fixed integer := 0;
begin
  for fn in
    select p.oid::regprocedure as signatur
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'   -- nur Funktionen, keine Aggregate/Prozeduren
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
      )
  loop
    execute format('alter function %s set search_path = pg_catalog, public', fn.signatur);
    fixed := fixed + 1;
  end loop;
  raise notice 'search_path gesetzt für % Funktion(en)', fixed;
end $$;

-- ---------------------------------------------------------------------------
-- VERIFIKATION - muss 0 zurückgeben.
-- ---------------------------------------------------------------------------
-- select count(*)
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.prokind = 'f'
--   and not exists (
--     select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
--   );
