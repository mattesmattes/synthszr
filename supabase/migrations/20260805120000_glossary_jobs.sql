-- supabase/migrations/20260805120000_glossary_jobs.sql
--
-- Servergetriebene Lexikonlaeufe. Bisher trieb der Browser die drei langen
-- Laeufe in for(;;)-Schleifen, um maxDuration=300 zu umgehen. Der Preis war
-- messbar: bei einem Lauf am 2026-08-05 war der Server fuer "Provenienz" um
-- 14:05:51 fertig, das UI zeigte den Begriff um 15:25:58 — 80 Minuten
-- Leerlauf, weil der naechste Request erst nach Verarbeitung der Antwort
-- rausgeht und der Tab gedrosselt war.
create table if not exists glossary_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('generate','images','relink')),
  status text not null default 'pending'
    check (status in ('pending','processing','done','error','cancelled')),
  -- Bekannte Gesamtzahl. Bei relink NULL: die Zahl der noch zu pruefenden
  -- Artikel haengt am Cursor und steht nicht vorab fest.
  total int,
  done_count int not null default 0,
  -- Protokoll fuer die Anzeige. JSONB statt eigener Tabelle: der Verlauf wird
  -- immer komplett gelesen, nie einzeln abgefragt, und ein Lauf erzeugt
  -- Dutzende, nicht Millionen Eintraege. Ausserdem uebersteht er damit ein
  -- Neuladen des Tabs — vorher lebte er nur im React-State.
  log jsonb not null default '[]'::jsonb,
  cancel_requested boolean not null default false,
  -- Lease gegen ueberlappende Ticks. Bei Minutentakt startet waehrend eines
  -- laufenden Ticks fuenfmal ein neuer Cron.
  last_advanced_at timestamptz,
  -- Erfolglose Ticks in Folge (Modell-Ueberlast). Bei Erfolg zurueck auf 0.
  attempts int not null default 0,
  params jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Hoechstens EIN offener Job je Art. Erledigt den Doppelstart auf DB-Ebene,
-- statt sich auf die UI zu verlassen.
create unique index if not exists glossary_jobs_one_open_per_kind
  on glossary_jobs (kind) where status in ('pending','processing');

-- Der Cron sucht den aeltesten offenen Job mit abgelaufenem Lease.
create index if not exists glossary_jobs_open_by_age
  on glossary_jobs (created_at) where status in ('pending','processing');

alter table glossary_jobs enable row level security;
-- Kein anon-Zugriff: die Jobs werden ausschliesslich ueber den
-- Service-Role-Client von Admin-Routen und Cron gelesen und geschrieben
-- (Klasse ADMIN-ONLY des RLS-Umbaus). Ohne Policy sieht anon nichts.
