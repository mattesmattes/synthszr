-- Editor-in-Chief wird durch "Enrich" ersetzt (2026-08-31): statt eine zweite,
-- parallele Prompt-Tabelle+Admin-Seite aufzubauen, wird die bestehende
-- Struktur umbenannt und wiederverwendet — es gibt nach dem Umbau keinen
-- Code-Pfad mehr, der editor_in_chief_prompts unter altem Namen braucht.
--
-- MUSS MANUELL ÜBER DAS SUPABASE-DASHBOARD (SQL-Editor) AUSGEFÜHRT WERDEN —
-- die Supabase-CLI ist fuer dieses Projekt strukturell blockiert
-- (s. reference_supabase_migrationen in der Projekt-Memory), service_role
-- kann kein DDL. Erst NACH dieser Migration funktioniert die neue Route
-- app/api/admin/enrich-prompts und die neue Seite app/admin/enrich-prompts.

ALTER TABLE editor_in_chief_prompts RENAME TO enrich_prompts;

-- Bestehende Zeilen bleiben als Alt-Prompts erhalten (inaktiv nutzbar, vom
-- Betreiber in der neuen UI loeschbar) — ihr Inhalt (Sortier-/Stilregeln)
-- passt nicht zum Enrich-Zweck, wird deshalb NICHT automatisch aktiv
-- gesetzt. Der neue Default-Prompt wird nach dem Deploy per API-Aufruf
-- eingefuegt (scripts/_seed_enrich_prompt.ts), nicht hier per INSERT, damit
-- der Prompttext an EINER Stelle im Repo lebt statt in Code UND SQL.
