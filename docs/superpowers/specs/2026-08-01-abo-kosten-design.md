# Design-Spec: Admin-Seite „Abo-Kosten" (kostenpflichtige Newsletter-Abonnements)

**Datum:** 2026-08-01
**Status:** Freigegeben (Brainstorming), bereit für Implementierungsplan

## 1. Ziel

Eine neue Admin-Seite in der Synthszr-App, die kostenpflichtige E-Mail-/
Newsletter-Abonnements aus der verbundenen Gmail-Inbox erkennt, mit auf den
Monat normalisierten Kosten auflistet und pro Abo einen Kündigungs-Workflow
anbietet. Ziel ist persönliches Ausgaben-Management (Überblick + gezieltes
Kündigen), nicht die redaktionelle Content-Ingestion.

## 2. Abgrenzung / Nicht-Ziele

- **Nicht** die bestehende „Newsletter-Quellen"-Funktion (`newsletter_sources`,
  redaktionelle Content-Ingestion). Überschneidungen werden nur markiert.
- **Keine** serverseitige Browser-Automation (kein Puppeteer/Playwright/
  Chromium). Kündigung läuft über HTTP-One-Click bzw. Link-Öffnen im Browser
  des Nutzers.
- **Kein** automatischer Login in Anbieter-Portale, **kein** Anfassen von
  Zahlungsdaten.
- Kein Job-/Queue-System in V1 (synchroner Scan; später umstellbar).

## 3. Architektur

Dockt vollständig an bestehende Synthszr-Muster an — keine neue Infrastruktur.

| Komponente | Pfad | Rolle |
|---|---|---|
| Seite | `app/admin/subscriptions/page.tsx` | Client-Component, liest `paid_subscriptions` via Supabase-Browser-Client, Aktionen via API-Routes |
| Nav-Eintrag | `components/admin/admin-nav.tsx` | Neuer `NavItem` in Gruppe „Repo", neben „Newsletter-Quellen" (Icon z. B. `Wallet`/`CreditCard`) |
| Scan-API | `app/api/admin/scan-subscriptions/route.ts` | Gmail-Scan (Hybrid) → Upsert in `paid_subscriptions` |
| Kündigungs-API | `app/api/admin/subscriptions/cancel/route.ts` | Führt One-Click-Unsubscribe aus bzw. liefert Ziel-Link; schreibt Protokoll |
| Status-Update-API | `app/api/admin/subscriptions/route.ts` (PATCH) | Manuelle Status-Änderung (`ignored`, „als gekündigt markiert"), manuelles Anlegen |
| Migration | `supabase/migrations/<utc>_paid_subscriptions.sql` | Tabelle `paid_subscriptions` (via `supabase db push`) |
| Gmail-Zugriff | `lib/gmail/client.ts` (`GmailClient`) + Tabelle `gmail_tokens` | Wiederverwendet, Vorbild `app/api/admin/scan-gmail-senders/route.ts` |
| Erkennung | `lib/subscriptions/detector.ts` (neu) | Gmail-Query + LLM-Klassifikation + Normalisierung + Dedup |
| Kündigungs-Logik | `lib/subscriptions/cancel.ts` (neu) | Klassifikation Fall A/B, HTTP-One-Click-Ausführung |

**Auth:** Admin-Gate wie alle Admin-Routen (Session/`isAdmin`; API-Routes via
`getSession()` bzw. bestehendem Cron-/Admin-Auth-Muster).

## 4. Datenmodell — Tabelle `paid_subscriptions`

Ein Eintrag pro Anbieter (Dedup über normalisierte Absender-Domain +
Anbietername). Migration idempotent (`CREATE TABLE IF NOT EXISTS`).

| Spalte | Typ | Beschreibung |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `provider_name` | text | Anbietername (LLM-normalisiert, z. B. „Stratechery") |
| `provider_key` | text | normalisierter Dedup-Schlüssel (lowercase `provider_name`); **Unique** |
| `sender_domain` | text | normalisierte Absender-Domain (nur Info; NICHT Dedup-Anker) |
| `sender_email` | text | konkreter Absender der jüngsten Beleg-Mail |
| `amount` | numeric | Betrag im Original-Intervall |
| `currency` | text | ISO-Währung (z. B. `EUR`, `USD`) |
| `interval` | text | `monthly` / `yearly` / `quarterly` / `weekly` / `one_time` / `unknown` |
| `amount_monthly` | numeric | auf Monat normalisiert (yearly/12, quarterly/3, …) |
| `last_payment_at` | timestamptz | Datum der jüngsten erkannten Zahlung |
| `evidence_message_ids` | jsonb | Liste `{ id, subject, date, gmail_link }` der Beleg-Mails |
| `unsubscribe_type` | text | `oneclick` / `http` / `mailto` / `login_portal` / `unknown` |
| `unsubscribe_target` | text | URL bzw. mailto-Adresse (für Fall A) oder Portal-URL (Fall B) |
| `is_content_source` | boolean default false | Abgleich mit `newsletter_sources` (Badge/Warnung) |
| `status` | text | `active` / `cancelling` / `cancelled` / `ignored` |
| `manually_added` | boolean default false | vom Nutzer manuell angelegt (Re-Scan überschreibt nicht) |
| `cancel_log` | jsonb default '[]' | Protokoll: `{ ts, type, result, detail }` je Versuch |
| `created_at` | timestamptz default now() | |
| `updated_at` | timestamptz default now() | |

**Constraints:** `status`-, `interval`- und `unsubscribe_type`-CHECK-Constraints
auf die o. g. Werte. Unique-Index auf `provider_key` (Dedup-Anker). `provider_key`
wird deterministisch aus `provider_name` abgeleitet (lowercase, getrimmt); NICHT
über `sender_domain`, da Plattformen (Substack, beehiiv, Ghost) viele verschiedene
Abos unter einer Domain bündeln.

## 5. Scan-Pipeline (Hybrid)

Ausgeführt in `scan-subscriptions/route.ts` → `lib/subscriptions/detector.ts`.

1. **Kandidaten-Query (Gmail):** `GmailClient` mit Query über die letzten
   12 Monate. Beispiel-Query (ODER-verknüpft):
   `newer_than:1y AND (from:stripe.com OR from:paypal.com OR from:*.substack.com
   OR "receipt" OR "invoice" OR "Ihre Rechnung" OR "payment" OR "subscription"
   OR "Zahlungsbestätigung" OR "renewed")`.
   Kandidatenzahl begrenzen (z. B. max. 300 Mails) — hält LLM-Kosten/Laufzeit
   im Rahmen.
2. **Pro Kandidat:** Header (inkl. `List-Unsubscribe`, `List-Unsubscribe-Post`,
   `From`, `Date`, `Subject`) + Body-Auszug holen.
3. **LLM-Klassifikation** (günstiges Modell, Haiku-Klasse, analog
   `runCategorization`): pro Mail strukturierte Ausgabe
   `{ is_paid_subscription: bool, provider_name, amount, currency, interval,
   confidence }`. Kostenlose Newsletter → `is_paid_subscription:false` → verworfen.
4. **Normalisierung:** `amount_monthly` aus `amount` + `interval`.
5. **Kündigungs-Klassifikation** (deterministisch, aus Headern):
   - `List-Unsubscribe-Post: List-Unsubscribe=One-Click` vorhanden → `oneclick`
   - `List-Unsubscribe` mit `https:`-URL → `http`
   - `List-Unsubscribe` mit `mailto:` → `mailto`
   - bekannte Billing-Portale (stripe/paypal/apple/google play) oder kein
     Unsubscribe-Header → `login_portal` bzw. `unknown`
6. **Dedup + Upsert:** pro `provider_key` ein Eintrag; jüngste Zahlung gewinnt
   (`last_payment_at`, `amount`, `interval`). Beleg-Mails akkumulieren.
7. **Re-Scan-Semantik:** neue Abos anlegen, bestehende aktualisieren.
   `status='ignored'`, `manually_added=true` und bereits gesetzte
   `cancelled`-Status bleiben **unberührt**.

**Laufzeit:** synchron mit `maxDuration` (300s). Fortschritt/Status wird an die
UI zurückgemeldet (einfacher Response mit Zählern; optional Zwischenstand in DB).

## 6. UI (`app/admin/subscriptions/page.tsx`)

- **Kopf:** Titel, **Summe monatlicher Gesamtkosten**, Button **„Neu scannen"**
  (ruft Scan-API, zeigt Laufzustand/Ergebnis: „X gefunden, Y neu").
- **Tabelle** (shadcn `Table`): Anbieter · Monatsbetrag (+ Original-Intervall
  als Sub-Text) · letzte Zahlung · Beleg-Mails (Gmail-Links) ·
  Content-Quellen-Badge · Status-Badge · Aktionen.
- **Aktionen je Zeile:** „Kündigen" (öffnet Kündigungs-Flow, s. §7),
  „Ausblenden / Kein Abo" (→ `ignored`). Ausgeblendete separat einblendbar.
- **Manuelles Anlegen:** kleiner Dialog zum Nachtragen verpasster Abos
  (`manually_added=true`).
- Leerzustand vor erstem Scan mit CTA „Jetzt scannen".

## 7. Kündigungs-Workflow (sicherheitskritisch)

**Grundregel:** Keine Kündigung ohne explizite Bestätigung pro Abo. Jeder
Versuch wird in `cancel_log` protokolliert.

**Fall A — automatisch, serverseitig (`oneclick` / `http`):**
1. Klick „Kündigen" → Bestätigungs-Dialog: „Führt einen Unsubscribe-Request an
   `<provider>` aus. Fortfahren?" (Bei `is_content_source=true` zusätzliche
   Warnung: „Damit fällt auch eine redaktionelle Content-Quelle weg.")
2. Nach Bestätigung → `cancel/route.ts`:
   - `oneclick`: `fetch(unsubscribe_target, { method: 'POST' })` serverseitig
     (RFC 8058 One-Click); Erfolg = 2xx.
   - `http`: `fetch(unsubscribe_target, { method: 'GET' })` serverseitig;
     Erfolg = 2xx.
3. Status → `cancelling` → bei Erfolg `cancelled`; Ergebnis + Zeitpunkt ins
   `cancel_log`. Bei Fehler: Status bleibt `active`, Fehler protokolliert und
   in UI angezeigt, Fallback-Angebot „Link öffnen" (Fall B).

**Fall B — manuell im Browser des Nutzers (`mailto` / `login_portal` / `unknown`):**
1. Klick „Kündigen" → Dialog erklärt den manuellen Abschluss.
2. Öffnet das Ziel **client-seitig** (`window.open`), **kein** Server-Browser,
   **kein** Auto-Login:
   - `mailto`: öffnet den Mail-Client mit vorbereiteter Unsubscribe-Mail — der
     Versand erfolgt aus der **eigenen** Adresse des Nutzers (serverseitig nicht
     möglich: kein `gmail.send`-Scope, falsche Absender-Domain via Resend).
   - `login_portal`/`unknown`: öffnet `unsubscribe_target` bzw. die beste
     Portal-Vermutung in einem neuen Tab; Nutzer schließt manuell ab.
3. Danach Button „Als gekündigt markieren" → Status `cancelled` (+ Log-Eintrag
   „manuell").

**Guardrails (durchgängig):** nie ohne Bestätigung; kein Ausfüllen von
Login-Formularen; kein Ändern von Zahlungsdaten; jede Aktion protokolliert.

## 8. Sicherheit & Datenschutz

- Alle Routen admin-authentifiziert (bestehendes Gate).
- Gmail-Zugriff read-only für den Scan (Header/Body lesen); `gmail.modify`-Scope
  wird für dieses Feature nicht zum Ändern von Mails genutzt.
- Beleg-Mail-Inhalte werden **nicht** dauerhaft gespeichert — nur Message-IDs +
  Metadaten (Subject/Datum/Link) und die extrahierten Felder.
- Unsubscribe-Requests gehen nur an aus der jeweiligen Mail stammende
  Unsubscribe-Ziele (keine frei geratenen URLs bei Fall A).

## 9. Testing-Strategie

- **Unit (vitest):**
  - `lib/subscriptions/detector.ts`: Normalisierung `amount_monthly`
    (yearly/quarterly/weekly), Dedup pro Domain, Re-Scan-Erhalt von
    `ignored`/`manually_added`.
  - Kündigungs-Klassifikation aus Headern (`oneclick`/`http`/`mailto`/
    `login_portal`/`unknown`) mit Beispiel-Headern.
  - LLM-Klassifikation: mit gemocktem LLM-Response (Fixtures), kein Live-Call.
- **Integration (leichtgewichtig):** Scan-Route mit gemocktem `GmailClient`
  (Fixture-Mails) → erwartete Upserts. Cancel-Route mit gemocktem `fetch`.
- **Manuell/Prod:** erster echter Scan gegen die verbundene Inbox, Stichprobe
  der Treffer + Belege; ein echter One-Click-Unsubscribe an einem
  unkritischen Abo.

## 10. Angenommene Defaults

- Abo-Identität = normalisierter Anbietername (`provider_key`), NICHT
  Absender-Domain (Plattformen wie Substack/beehiiv bündeln viele Abos je Domain).
- Scan synchron (kein Job-System); bei zu großer Kandidatenzahl später auf das
  vorhandene `article_jobs`-Pattern umstellbar.
- LLM: günstiges Klassifikationsmodell (Haiku-Klasse) über die bestehende
  Modell-Konfiguration (`getModelForUseCase`), keine Frontier-Modelle.
- Scan-Fenster: 12 Monate, änderbar an einer Stelle.

## 11. Implementierungs-Phasen

- **Phase 1:** Migration `paid_subscriptions` + `lib/subscriptions/detector.ts`
  + Scan-API. Verifikation: echter Scan füllt Tabelle plausibel.
- **Phase 2:** Seite + Nav-Eintrag + Anzeige (Summe, Belege, Badges,
  „Neu scannen", Ausblenden, manuelles Anlegen).
- **Phase 3:** Kündigungs-Workflow (Fall A HTTP-One-Click + Fall B Link öffnen)
  + Protokoll + Bestätigungs-Dialoge.

Nach jeder Phase: kurzer Stopp + Zwischenstand.
