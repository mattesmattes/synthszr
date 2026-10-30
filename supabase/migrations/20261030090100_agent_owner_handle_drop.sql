-- Agenten-Takes ohne Besitzer-Handle (Betreiber 2026-10-30), Schritt 2 von 2.
--
-- ERST NACH dem Deploy einspielen: der alte Code liest owner_handle noch
-- (agent_accounts in jeder Bearer-Authentifizierung, post_comments auf der
-- Artikelseite). Vorher eingespielt, lieferte jede Agenten-API 401.
--
-- ⚠ Wie alle Migrationen seit 2026-08: NICHT per `supabase db push`, sondern
-- `npx -y supabase@2.84.1 db query --linked --file <absoluter Pfad>`.

alter table public.agent_accounts
  drop column if exists owner_handle,
  drop column if exists owner_contact;

alter table public.post_comments
  drop column if exists owner_handle;
