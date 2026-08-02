-- SEC-016: `newsletter_sources` für anon/authenticated sperren.
--
-- Die Tabelle war für `anon` lesbar und lieferte 221 Zeilen inklusive der
-- Spalte `email` — die Absenderadressen aller abonnierten Newsletter, auch
-- der deaktivierten. Ursache war nicht eine zu weite Policy, sondern der
-- Aufrufer: app/[lang]/sources/page.tsx las serverseitig mit dem ANON-Key und
-- brauchte `email`, um daraus die Website-Domain abzuleiten. Damit musste
-- `anon` die Spalte lesen dürfen — und konnte sie folglich auch direkt über
-- PostgREST abfragen.
--
-- REIHENFOLGE: Diese Migration setzt voraus, dass die Umstellung der Seite auf
-- den Service-Role-Client bereits deployt ist. Läuft sie vorher, liefert
-- /[lang]/sources eine leere Liste (der Query-Fehler wird dort nur geloggt).
--
-- Alle übrigen Zugriffe auf die Tabelle waren schon vorher serverseitig und
-- admin-authentifiziert (/api/admin/newsletter-sources, manage-sources,
-- scan-subscriptions, lib/newsletter/fetcher.ts).

revoke all on table public.newsletter_sources from anon;
revoke all on table public.newsletter_sources from authenticated;

-- Sicherstellen, dass der einzige verbleibende Zugriffsweg vollständig ist.
grant select, insert, update, delete on table public.newsletter_sources to service_role;

-- Verifikation (mit dem anon-Key, nicht mit service_role — der umgeht RLS):
--   select * from public.newsletter_sources limit 1;
-- erwartet: permission denied for table newsletter_sources
