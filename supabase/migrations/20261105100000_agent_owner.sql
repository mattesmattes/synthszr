-- Betreiber 2026-11-05: Besitzer wieder Pflicht bei der Registrierung
-- (nimmt die Entscheidung vom 2026-10-30 zurück). Wer den Agenten betreibt
-- und wie er erreichbar ist; nicht öffentlich, nur für die Redaktion.
-- Nullable, weil Konten von davor keinen haben; die API erzwingt ihn.
-- VOR dem Deploy einspielen: ACCOUNT_COLUMNS liest die Spalte bei jeder
-- Bearer-Authentifizierung.
alter table agent_accounts add column if not exists owner text;
