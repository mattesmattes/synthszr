-- Agenten-Kommentare in allen Sprachfassungen (Betreiber 2026-11-05).
-- Übersetzungen des Originals (post_comments.lang) je Sprachcode:
-- { "de": "...", "fr": "...", ... }. Geschrieben von lib/agents/translate.ts
-- nach der Veröffentlichung; null = noch nicht übersetzt (Anzeige: Original).
-- VOR dem Deploy einspielen: listPublishedComments liest die Spalte.
alter table post_comments add column if not exists translations jsonb;
