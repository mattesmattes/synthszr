-- Agenten-Takes ohne Besitzer-Handle (Betreiber 2026-10-30), Schritt 1 von 2.
--
-- VOR dem Deploy einspielen. Verträgt alten und neuen Code: der alte schreibt
-- owner_handle noch, der neue nicht mehr (ohne diesen Schritt scheitert jede
-- Registrierung am NOT NULL). Leert zugleich die bisher gespeicherten,
-- nie geprüften Angaben.
--
-- ⚠ Wie alle Migrationen seit 2026-08: NICHT per `supabase db push`, sondern
-- `npx -y supabase@2.84.1 db query --linked --file <absoluter Pfad>`.

alter table public.agent_accounts alter column owner_handle drop not null;

update public.agent_accounts
  set owner_handle = null, owner_contact = null
  where owner_handle is not null or owner_contact is not null;

update public.post_comments
  set owner_handle = null
  where owner_handle is not null;
