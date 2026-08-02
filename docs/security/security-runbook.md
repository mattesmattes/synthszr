# Security-Runbook — Synthszr

Operative Prozeduren für Secret-Rotation, Session-Revocation und
Incident-Response. Ergänzt `security_best_practices_report.md` (Befunde) und
`docs/superpowers/plans/2026-08-02-security-remediation.md` (Umsetzung).

Stand: 2026-08-02. Alle Befehle sind gegen dieses Projekt verifiziert.

---

## 0. Voraussetzungen

Produktions-Credentials nie aus `.env.local` nehmen — die kann veraltete Keys
enthalten. Immer frisch ziehen und danach löschen:

```bash
vercel env pull /tmp/env.prod --environment=production
# ... arbeiten ...
rm -f /tmp/env.prod
```

DDL (Migrationen) läuft über den **Supabase-SQL-Editor**, nicht über die CLI —
das Projekt ist nicht für `supabase db push` verlinkt.

---

## 1. Secret-Rotation

Reihenfolge ist überall gleich: **neuen Wert setzen → deployen → alten Wert
entwerten**. Umgekehrt entsteht ein Fenster, in dem die App auf ein Secret
zugreift, das es nicht mehr gibt.

### CRON_SECRET

Bricht bei falscher Reihenfolge alle Cron-Jobs (Newsletter-Fetch, Artikel-
Generierung, Cleanups).

```bash
NEW=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
printf '%s' "$NEW" | vercel env add CRON_SECRET production --force
vercel --prod   # oder Push auf main abwarten
# Verifikation: ohne Auth muss 401 kommen
curl -s -o /dev/null -w '%{http_code}\n' https://www.synthszr.com/api/cron/scheduled-tasks
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $NEW" \
  https://www.synthszr.com/api/cron/scheduled-tasks
```

Vercel-Crons senden den Wert automatisch, sobald `CRON_SECRET` gesetzt ist —
keine separate Konfiguration nötig.

### REVALIDATE_SECRET

Betrifft nur `POST /api/revalidate-rankings` und die drei Skripte
`scripts/_recover.ts`, `_seedream_fix.ts`, `_top3.ts`.

```bash
NEW=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
for E in production preview development; do
  vercel env add REVALIDATE_SECRET $E --value "$NEW" --yes --force
done
# lokal für die Skripte nachziehen:
#   REVALIDATE_SECRET=<NEW> in .env.local ersetzen
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer $NEW" https://www.synthszr.com/api/revalidate-rankings   # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "https://www.synthszr.com/api/revalidate-rankings?secret=$NEW"                     # 401
```

Der zweite Aufruf **muss** 401 liefern — Query-Parameter sind kein Credential.

### ADMIN_PASSWORD

```bash
vercel env add ADMIN_PASSWORD production --value "<neu>" --yes --force
vercel --prod
```

Danach **alle Sessions widerrufen** (Abschnitt 2) — ein altes Passwort nützt
nichts mehr, aber bestehende Sessions laufen unabhängig davon weiter.

### SUPABASE_SERVICE_ROLE_KEY

Der mächtigste Wert im System: umgeht RLS vollständig.

1. Supabase-Dashboard → Project Settings → API → **Rotate** service_role key.
2. `vercel env add SUPABASE_SERVICE_ROLE_KEY production --value "<neu>" --yes --force`
3. Deployen, dann verifizieren:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://www.synthszr.com/de            # 200
curl -s -o /dev/null -w '%{http_code}\n' https://www.synthszr.com/de/archive     # 200
```

Der Schlüssel steckt außerdem in lokalen `.env`-Dateien — dort ebenfalls
ersetzen, sonst laufen Skripte gegen einen ungültigen Key.

> Historischer Hinweis: Bis SEC-014 waren die **letzten 16 Zeichen** dieses
> Keys das Secret der Revalidate-Route. Wurde der Key je in einem Access-Log
> oder Referrer geteilt, ist er als kompromittiert zu behandeln.

### Gmail OAuth

Kein Encryption-Key vorhanden (SEC-010/Task 12 ist ausgeschlossen; der
Refresh-Token liegt weiterhin im Klartext in `gmail_tokens`).

1. https://myaccount.google.com/permissions → Zugriff für die App entziehen.
2. `DELETE FROM public.gmail_tokens;` im SQL-Editor.
3. Im Admin-Bereich neu verbinden (`/api/gmail/callback`-Flow).
4. Verifizieren: `GET /api/gmail/status` und ein Newsletter-Fetch.

---

## 2. Alle Admin-Sessions sofort widerrufen

Seit SEC-015 ist das ein einzelnes UPDATE — keine Secret-Rotation nötig, und
niemand außer den Admins ist betroffen.

```sql
-- Alle laufenden Sessions beenden
update public.admin_sessions set revoked_at = now() where revoked_at is null;

-- Eine einzelne Session (Hash aus einem Log/Report)
update public.admin_sessions set revoked_at = now() where token_hash = '<sha256>';

-- Wirkung prüfen: muss 0 sein
select count(*) from public.admin_sessions
where revoked_at is null and expires_at > now();
```

Der Effekt ist sofort: Jeder Request prüft die Zeile. Sessions laufen ohnehin
nach 12 Stunden ab.

---

## 3. Subscriber-Tokens widerrufen

Ein einzelner kompromittierter Link (Preferences/Unsubscribe/Referral):

```sql
-- Alle Tokens eines Subscribers entwerten
delete from public.subscriber_action_tokens
where subscriber_id = '<uuid>';

-- Alle Tokens eines Zwecks flottenweit (z. B. nach einem Mail-Provider-Leak)
delete from public.subscriber_action_tokens where purpose = 'preferences';
```

Folge: Links in bereits versendeten Newslettern funktionieren nicht mehr; der
nächste Versand erzeugt frische. Rohwerte sind nirgends gespeichert, ein
Token lässt sich also nicht wiederherstellen — nur ersetzen.

---

## 4. Dependency-Advisories

Gate: `pnpm audit --audit-level=high` läuft blockierend im CI
(`.github/workflows/security.yml`, Job „Dependency Audit").

**SLA:** Critical innerhalb von 24 Stunden, High innerhalb von 7 Tagen.

Triage:

```bash
pnpm audit --json | node -e "..."   # betroffene Pfade ermitteln
pnpm why <paket>                    # wer zieht es
pnpm update <paket>                 # wenn direkte Dependency
```

Für transitive Pfade ein **gezielter Override innerhalb der Major-Linie** in
`package.json` unter `pnpm.overrides` — nie `pnpm update --latest` über alles.

Lässt sich ein Advisory nicht schließen, wird es **einzeln** in
`pnpm.auditConfig.ignoreGhsas` eingetragen **plus** ein Eintrag in
`pnpm.auditExceptionNotes` mit Grund, Expositionsanalyse, Owner und
Review-Datum. `tests/lib/repository-security.test.ts` schlägt fehl, wenn eine
Ausnahme ohne Notiz hinzugefügt wird. Das Audit-Level selbst wird **nie**
gesenkt.

Aktuelle Ausnahme: `GHSA-f88m-g3jw-g9cj` (sharp < 0.35.0) — 0.35.x crasht auf
Vercel-Lambda. Review bis 2026-11-02.

---

## 5. Nach jeder Migration: RLS und Grants prüfen

Jede neue Tabelle im `public`-Schema ist über PostgREST erreichbar, sobald
Grants existieren. Standard für interne Tabellen:

```sql
alter table public.<t> enable row level security;
revoke all on table public.<t> from public, anon, authenticated;
grant select, insert, update, delete on table public.<t> to service_role;
```

Verifikation mit dem anon-Key (nicht mit service_role — der umgeht RLS):

```bash
node --env-file=/tmp/env.prod -e "
const { createClient } = require('@supabase/supabase-js')
;(async () => {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  for (const t of ['<neue_tabelle>']) {
    const { count, error } = await anon.from(t).select('*', { count: 'exact', head: true })
    console.log(t, error ? 'blockiert: ' + error.message : count + ' Zeilen sichtbar')
  }
})()"
```

`0 Zeilen sichtbar` ist ebenfalls in Ordnung (RLS filtert), `permission denied`
ist strenger. Was **nicht** in Ordnung ist: Zeilen sehen.

Für Funktionen: `security invoker`, `set search_path = pg_catalog, public`,
EXECUTE von `public`/`anon`/`authenticated` entziehen, nur `service_role`
gewähren.

Der **Security Advisor** im Supabase-Dashboard (Advisors → Security) ist nach
jeder Migration zu prüfen; die installierte CLI hat kein `db advisors`.

---

## 6. Incident-Response

### Service-Role-Key geleakt

Höchste Priorität — der Key liest und schreibt alles.

1. Key rotieren (Abschnitt 1), sofort.
2. Alle Admin-Sessions widerrufen (Abschnitt 2).
3. Supabase-Logs auf fremde Zugriffe prüfen (Dashboard → Logs → Postgres/API).
4. `subscribers`, `admin_sessions` und `paid_subscriptions` auf unerwartete
   Änderungen prüfen (`updated_at`-Sprünge, unbekannte Zeilen).
5. `REVALIDATE_SECRET` mitrotieren, falls es je aus dem Key abgeleitet war.

### Admin-Session geleakt

1. Betroffene Session oder alle widerrufen (Abschnitt 2).
2. `ADMIN_PASSWORD` rotieren, falls der Verdacht auf Passwortkenntnis besteht.
3. `admin_sessions` auf unbekannte `email`-Werte prüfen — bei Google-Login
   steht dort die Identität, bei Passwort-Login `null`.

### Subscriber-Token geleakt

1. Tokens entwerten (Abschnitt 3).
2. Prüfen, ob damit gehandelt wurde: `consumed_at` bei `unsubscribe`/`confirm`,
   `subscriber_language_changes` bei Preferences.
3. Ein `unsubscribe`-Token ist single-use — mehr als eine Nutzung ist nicht
   möglich, aber `status = 'unsubscribed'` ggf. manuell zurücksetzen.

### Verdacht auf XSS

`script-src` erlaubt `'self'` plus `va.vercel-scripts.com` und `vercel.live` —
injizierter Code kann also nichts von fremder Origin nachladen, und
`unsafe-eval` ist entfernt. `'unsafe-inline'` ist noch nötig (siehe
`lib/security/csp.mjs`), inline injizierte Handler wären also ausführbar.
Bei Verdacht: betroffenen Content-Pfad identifizieren (Ghostwriter-Ausgabe,
TipTap-Inhalt, Newsletter-HTML) und gegen `sanitize-html` prüfen.

---

## 7. Regelmäßige Kontrollen

| Intervall | Prüfung |
|---|---|
| Pro PR | CI-Gates (Audit, Semgrep, CodeQL, Typecheck, Tests) — alle blockierend |
| Nach jeder Migration | RLS + Grants (Abschnitt 5), Supabase Security Advisor |
| Monatlich | `pnpm audit`, Ausnahmen in `auditExceptionNotes` auf Review-Datum prüfen |
| Quartalsweise | anon-Leseprobe über alle Tabellen; `CRON_SECRET` und `REVALIDATE_SECRET` rotieren |
| Bei Personalwechsel | Alle Admin-Sessions widerrufen, `ADMIN_PASSWORD` rotieren |
