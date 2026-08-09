# „Eure Takes" — Kommentare & Take-Barometer — Design

**Datum:** 2026-08-09
**Status:** vom Betreiber freigegeben (inkl. der zwei Abweichungen unten)

## Konzept

Keine generische Kommentarspalte, sondern eine Einladung zum Gegen-Take: Der
Synthszr hat eine Haltung — jetzt ist der Leser dran. Zwei Bausteine mit
bewusst verschiedener Reibung:

| Baustein | Hürde | Integrität | SEO-Markup |
|---|---|---|---|
| **Take-Barometer** (unter jedem Take) | ein Klick, anonym | niedrig | **nein** (nur UI + interactionStatistic) |
| **„Eure Takes"** (Artikelende) | Abo + Verifizierung | hoch | **ja** (comment/commentCount) |

Das Prinzip: billige Signale erzeugen Volumen und Social Proof, teure Signale
erzeugen Glaubwürdigkeit — und nur die teuren wandern ins Markup. Nie dünn
belegtes Rating-Markup (Haus-Präzedenzfall: rankings/[slug]/page.tsx:101 lehnt
aggregateRating explizit ab).

## Entscheidungen des Betreibers

1. Kommentieren nur für Newsletter-Abonnenten (Magic-Link-Verifizierung).
2. KI-Vorprüfung; Grenzfälle in eine Admin-Queue.
3. SEO: strukturierte Daten + indexierbarer Kommentartext + Frische-Signal.
4. **Abweichung a (freigegeben):** kein `aggregateRating` — Article ist für
   Review-Snippets nicht zugelassen, Risiko ohne Ertrag. Stattdessen
   `comment`-Array, `commentCount`, `interactionStatistic`.
5. **Abweichung b (freigegeben):** Kommentare gepoolt am Artikelende mit
   optionalem Abschnitts-Chip („zu: …"), nicht als getrennte Threads je
   Abschnitt — bei dem Traffic sähen zehn Einzelthreads alle leer aus.

## Take-Barometer

- Unter jedem `Synthszr Take:`-Absatz: „Sehe ich auch so" / „Sehe ich anders",
  nach dem Klick Prozentbalken („72 % stimmen dem Take zu").
- Anker: `queueItemId` der Abschnitts-H2 (stabil), Fallback Abschnitts-Index.
- Dedup weich: Cookie + Rate-Limit. Keine Identität nötig.
- Interner Name `take_feedback` — „Vote" ist durch BUY/HOLD/SELL-Badges belegt.
- Einbau als DOM-Prozessor nach dem Muster der bestehenden Pipeline
  (tiptap-renderer, synthese-text.ts erkennt Takes bereits) — idempotent, läuft
  nach der Hydration-Mutation.

## Kommentare („Eure Takes")

- Schreibbox fragt „Was ist dein Take?". Plain-Text, hartes Escaping, KEIN
  HTML (CSP hat unsafe-inline; Sanitization ist die einzige XSS-Linie).
- Flach, kein Threading (v1). Anzeige: Name, Datum, Text, optionaler
  Abschnitts-Chip (Headline denormalisiert gespeichert).
- Identität, zwei Wege:
  - Newsletter-Link trägt Token (subscriber_action_tokens, neue Purpose
    `comment`) → sofort schreibfähig.
  - Web: E-Mail → Magic-Link „Take bestätigen" → Kommentar live + langlebiger
    signierter Reader-Cookie (90 Tage) für künftige Kommentare.
  - Nicht-Abonnenten sehen die Abo-Einladung (Conversion-Hebel).
  - Anti-Enumeration: Antwort immer „Prüf dein Postfach".
- Moderation: synchroner Haiku-Call, Tool-Schema `publish|review|reject`.
  Fail-open IMMER nach `review`, nie nach `publish`.
- DSGVO: Löschlink in der Bestätigungsmail, Admin-Delete.

## SEO-Mechanik

- Kommentare stehen im SSR-HTML (Sektion `#eure-takes` nach dem Artikel).
- Article-JSON-LD erweitert um: `comment` (Comment-Objekte), `commentCount`,
  `interactionStatistic` (UserComments + LikeAction aus agree-Zählern),
  `dateModified` = max(Artikel-updated_at, neuester freigegebener Kommentar).
- Freigabe eines Kommentars → `revalidatePath` der Artikel-Seite (beide
  Quellen: /de/posts/[slug] etc. über alle Locales). Edge-Cache läuft binnen
  60 s nach — Crawler brauchen keine Echtzeit; Nutzer bekommen Frische über
  Client-Refetch nach Hydration.

## Datenmodell

- `post_comments`: id, post_source ('posts'|'generated_posts'), post_id,
  subscriber_id (FK subscribers), display_name, body (Plain-Text),
  section_anchor (queueItemId|null), section_headline (denormalisiert|null),
  status ('published'|'pending'|'rejected'|'deleted'), moderation_verdict,
  moderation_reason, created_at, published_at. RLS: anon SELECT nur
  status='published'; Writes ausschließlich Service-Role.
- `take_feedback`: id, post_source, post_id, section_anchor, vote
  ('agree'|'disagree'), voter_hash, created_at. Unique-Index
  (post_source, post_id, section_anchor, voter_hash) als Dedup.
- `subscriber_action_tokens`: neue Purpose `comment` im CHECK-Constraint.

## Schreibrouten (Hausmuster)

`requireValidOrigin` → Upstash-Rate-Limit → `readJsonBody` (8 KB) → Zod
`.strict()` → Service-Role. Kommentar-POST zusätzlich: Identität (Reader-Cookie
ODER gültiges Token) vor der Moderation.

## Risiken (bewusst getragen)

- dateModified über Kommentare: legitim (Seiteninhalt ändert sich real), aber
  dokumentiert, falls Google-Guidance sich verschärft.
- Reader-Cookie ist Komfort, kein Sicherheitsanker — jede Schreibaktion läuft
  trotzdem durch Moderation und Rate-Limit.
- Migration muss manuell im SQL-Editor laufen (CLI-Historie nicht synchron,
  s. Session 2026-08-08).

## Sicherheits-Nachschärfungen (Review 2026-08-09)

Eine adversariale 5-Dimensionen-Review nach der ersten Umsetzung fand 11
bestätigte Punkte, alle behoben:

- **Mail-Bombing / Amplifikation:** Web-Flow drosselt jetzt je Ziel-Abonnent
  (10-Min-Cooldown über frische pending_verify), nicht nur je IP.
- **Kommentar-Unterschiebung:** Geparkte Kommentare tragen `verify_token_hash`;
  ein Magic-Link veröffentlicht nur den zugehörigen Kommentar, nicht alle
  pending_verify des Abonnenten.
- **Timing-Orakel:** Web-Flow-Arbeit läuft in `after()`; beide Zweige
  (Abonnent/Unbekannt) antworten sofort identisch.
- **SEO-Regression:** `?ct=` wird aus `window.location` gelesen statt über
  `useSearchParams` — die SSR-Kommentarliste steht wieder im statischen HTML.
- **Doktrin-Bruch:** Barometer-Votes (`take_feedback`) NICHT mehr im JSON-LD —
  nur der Kommentar-Zähler (CommentAction) bleibt.
- **Revalidation:** über alle `PUBLIC_LOCALES`, nicht nur `/de`.
- **DSGVO:** Admin-`delete` ist ein echter Hard-Delete; Origin-Check auf der
  Admin-PATCH-Route; Klarname-Kollision mit dem Seiten-Autor entschärft.
- **Hydration:** feste `timeZone` in der Kommentar-Datumsausgabe.

## OFFEN — Betreiberaufgabe (nicht im Code lösbar)

**Datenschutzerklärung nachziehen** (static_pages, „Stand: Januar 2026"):
Das Feature führt drei meldepflichtige Punkte ein, die die DSE noch nicht nennt:
1. Kommentartext + Artikeltitel gehen zur Moderation an die **Anthropic-API**
   (US-Auftragsverarbeiter) — Art. 13/28, Drittlandtransfer.
2. **Öffentlicher Klarname** unter dem Kommentar.
3. Neue Cookies: `synthszr_reader` (90 T), `synthszr_tb` (365 T) + localStorage.
Bis zur Anpassung ist das Feature datenschutzrechtlich unvollständig
dokumentiert. Bewusst NICHT automatisch generiert — Rechtstext gehört geprüft.

## Phase 2 (nicht in diesem Build)

„Leser-Take der Woche": Admin markiert einen Kommentar als featured, der
Newsletter zeigt ihn. Threading. Formatierung im Kommentartext.
