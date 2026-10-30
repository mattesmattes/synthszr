# Synthszr Project

A Next.js 16 application for AI-powered financial analysis and newsletter generation.

## Key Features

### Synthszr Vote Badges
- Display investment ratings (BUY/HOLD/SELL) for companies mentioned in blog posts
- Public companies: Analysis generated via `/api/stock-synthszr` (AI-powered, cached)
- Premarket companies: Data fetched from glitch.green API

### Company Detection
- Natural mentions in text (e.g., "Nvidia reported...")
- Explicit `{Company}` directive tags (e.g., `{Palantir}`)
- Tags are hidden in rendered output but trigger rating display
- Exclusion list prevents false positives (e.g., "Insider", "Experte" are common nouns, not companies)

### Ghostwriter
- AI-powered blog post generation from daily digests
- Automatically adds `{Company}` tags for thematically relevant companies
- Supports multiple AI models (Claude, Gemini)

### Edit Learning System
- Learns from manual edits made to AI-generated blog posts
- Tracks all changes at sentence-level (edit_history → edit_diffs)
- Extracts patterns from recurring edits (learned_patterns)
- Classifies edits: factual, stylistic, vocabulary, grammar
- Confidence-based pattern activation with time decay

## Architecture

### Company Data
- `lib/data/companies.ts` - Auto-generated company dictionaries
- `KNOWN_COMPANIES` - Public companies with stock tickers
- `KNOWN_PREMARKET_COMPANIES` - Premarket companies from glitch.green
- `lib/data/company-exclusions.ts` - Words excluded from company detection
- Sync via: `npx tsx scripts/sync-premarket-companies.ts`

### TipTap Editor
- `components/tiptap-editor.tsx` - Admin editor
- `components/tiptap-renderer.tsx` - Reader component with company detection
- `lib/email/tiptap-to-html.ts` - Email HTML generation with vote badges

### Rating Generation
- `/api/stock-synthszr` - Generate/cache public company analysis
- `/api/stock-synthszr/batch-ratings` - Batch read ratings (read-only)
- `/api/premarket/batch-ratings` - Batch read premarket ratings

### Edit Learning
- `lib/edit-learning/history.ts` - Edit history tracking (ensureInitialEditHistory, recordEditVersion)
- `lib/edit-learning/diff-extractor.ts` - Sentence-level diff extraction
- `lib/edit-learning/retrieval.ts` - Pattern/example retrieval for Ghostwriter
- `app/api/admin/analyze-edits/route.ts` - Analyze pending edits (GET: stats, POST: run analysis)
- `app/api/admin/pattern-feedback/route.ts` - Update pattern confidence (keep/revert)
- `app/api/cron/extract-patterns/route.ts` - Extract patterns from clustered diffs
- Database tables: `edit_history`, `edit_diffs`, `learned_patterns`, `applied_patterns`

**Ghostwriter Integration:**
- `streamGhostwriter()` calls `getActiveLearnedPatterns()` and `findSimilarEditExamples()`
- `buildPromptEnhancement()` adds "GELERNTE STILPRÄFERENZEN" section to prompt
- Patterns with confidence ≥ 0.4 are included (max 20)
- Similar examples found via pgvector embedding search

**Editor Highlighting:**
- `components/tiptap-editor-with-patterns.tsx` - Editor with pattern highlights
- `lib/tiptap/pattern-highlight-mark.ts` - TipTap Mark extension for yellow highlighting
- Click on highlight → Popover with "Behalten/Ablehnen/Deaktivieren" options
- Feedback updates confidence via `/api/admin/pattern-feedback`

### Premarket Data
- `lib/premarket/client.ts` - Fetches from glitch.green API
- `lib/premarket/types.ts` - PremarketItem, PremarketSynthesis types
- `app/api/premarket/route.ts` - Single company lookup
- `app/api/premarket/batch-ratings/route.ts` - Batch fetch for multiple companies
- `components/premarket-synthszr-layer.tsx` - Dialog showing full analysis
- Source: External API at `https://glitch.green/api/public/premarket-syntheses`
- Auth: `STOCKS_PREMARKET_API_KEY` via X-API-Key header
- Company mapping: `KNOWN_PREMARKET_COMPANIES` in `lib/data/companies.ts`
- Sync: `npx tsx scripts/sync-premarket-companies.ts`

### News Queue & Article Selection
The news queue system manages article selection for Ghostwriter blog post generation:

**Flow:**
1. Articles arrive in `daily_repo` from newsletter ingestion
2. Synthesis pipeline scores articles (originality + relevance)
3. Articles added to `news_queue` with status `pending`
4. User manually selects articles → status becomes `selected`
5. Ghostwriter uses selected items for blog generation

**Key Files:**
- `lib/news-queue/service.ts` - Queue management with source diversity (30% limit)
- `app/api/ghostwriter-queue/route.ts` - Article generation from queue items
- `app/admin/news-queue/page.tsx` - Queue management UI with rankings
- `app/admin/create-article/page.tsx` - Blog creation using queue items

**Item Selection Priority (ghostwriter-queue API):**
1. Specific `queueItemIds` if provided
2. Manually selected items (status='selected') - DEFAULT
3. Balanced selection from pending items (30% source diversity)

**Database:**
- `news_queue` table with status: pending → selected → used
- `get_balanced_queue_selection()` PostgreSQL function for fair source distribution
- Score formula (production, GENERATED STORED column, since migration
  `20260328_optimized_scoring.sql` — this is now the only ranking basis):
  `total_score = source_pub_rate×17.5 + relevance_score×0.82 + synthesis_score×0.31 + min(content_length/10000, 1)×0.31`

**Ranking-Vorschlag (Admin-Button):**
- `lib/news-queue/ranking-service.ts` (`generateRankingSuggestions`) sortiert Kandidaten
  rein nach `total_score` und entfernt Themen-Duplikate über semantischen Dedup
  (`lib/news-queue/semantic-dedup.ts`) — kein LLM-Call, kein Modell zur Laufzeit.
- Grund: Gate-Vergleich über 36 Reranker-Runs (2026-08-25..2026-09-29, gleiche
  Pools/Relevanzmengen; Recall@15 / NDCG@15) — `total_score` 0.142 / 0.138 schlägt
  das beste trainierte Modell (LambdaRank, 0.118 / 0.089), logistische Regression
  (0.104 / 0.116), den früheren LLM-Reranker (0.095 / 0.089) und Random
  (0.018 / 0.015). Details: `scripts/taste-train-report.json`.
- Der frühere LLM-Reranker (`lib/news-queue/reranker.ts` + Umfeld, Use Case
  `queue_ranking`) wurde entfernt (Task 11', News-Taste-Modell).

**News-Taste-Pipeline (Offline-Werkzeug, nicht Teil des Laufzeitpfads):**
- Bewertet Artikel entlang mehrerer Geschmacksfragen via Vercel AI Gateway
  (`lib/ai/evaluate.ts`, Modell `typesafe-ai/jev`); Fragenkatalog und
  Feature-Vektoren in `lib/news-taste/questions.ts` / `features.ts`, gespeichert
  in `news_taste_features` (58.602 Vektoren, `FEATURES_VERSION` 1).
- Runbook: `npm run taste:backfill && npm run taste:export && npm run taste:train`
  (Training läuft über `uv`). Der erste vollständige Backfill-Lauf kostete
  ca. $4,53; Reruns sind idempotent (Lookup vor Berechnung, s. o.) und zahlen
  nur für neue Items. Trainiertes Artefakt: `scripts/taste-model.json`.
- Ergebnis siehe Gate-Befund oben — deshalb bleibt der Admin-Vorschlags-Button
  bei `total_score` statt einem trainierten Modell.
- Nach der Umstellung entstehen keine neuen Reranker-Runs mehr
  (`scripts/measure-reranker-baseline.ts` filtert `ranking_runs` mit
  `model = 'total_score'` heraus); künftige Gates vergleichen daher gegen
  `total_score_baseline`, und `gate_comparison` kann für spätere Testzeiträume
  0 Reranker-Runs ausweisen.
- **Methodik-Vorbehalt:** Die Labels stammen aus einer Queue-UI, die selbst
  nach `total_score` sortiert war, und `total_score` wurde (Migration
  `20260328_optimized_scoring.sql`) auf derselben Art von Labels gefittet —
  ein Offline-Gate ist damit strukturell zugunsten von `total_score`
  verzerrt (Positionsbias). Ein fairer künftiger Test ist online: Modell-
  Vorschläge in das Panel mischen und die Annahmequote messen.

### Synthszr Takes — Reform in vier Stufen (2026-10-19)
Befund aus 183 veröffentlichten Takes: p50 drei Sätze à 24 Wörter, 16 % der
Sätze über 30 Wörter, 81 % Doppelpunkt-Pointe, 39 % Prognosen, Schlusssatz nur
zu 22 % mit Zahl; der Betreiber übernimmt 96 % der behaltenen Takes wörtlich und
streicht sonst den letzten Satz. Umgesetzt (alle in `lib/claude/`):
1. **Form** (`take-cap.ts`): Prompt verlangt 50–75 Wörter in einem Absatz,
   sonst **keine Satzstrukturvorgaben** (Betreiber 2026-10-20: „um Abwechslung
   in den Takes zu ermöglichen“); `capTake` kürzt satzweise auf
   `TAKE_MAX_WORDS` 80. Die anfänglichen Vorgaben (drei bis vier Sätze, Satz
   unter acht Wörtern, Satzlängen, ein Doppelpunkt) erzeugten Stakkato nach
   Schablone und sind gestrichen.
2. **Blickwinkel** (`ghostwriter-pipeline.ts`): Blickwinkel im Plan aus sieben
   Typen (`TAKE_ANGLE_TYPES`, `TAKE_ANGLE_RULES`), Auftakt „Der/Die/Das
   eigentliche …“ verboten. Das ursprüngliche Skelett (Mechanismus →
   Konsequenz → Prüfstein, Prognosen nur mit Datum oder Messgröße,
   Skelett-Wörter nicht im Text) hat der Betreiber am 2026-10-20 aus beiden
   Prompts gestrichen, ebenso den Satz „QUELLMATERIAL-SICHERHEIT“ im
   Take-Prompt.
3. **Vorbilder** (`lib/posts/take-exemplars.ts`): drei eigene veröffentlichte
   Takes aus den sechs thematisch nächsten Posts (gleicher
   `match_generated_posts`-Aufruf wie der historische Kontext), bewertet nach
   Nähe, Leser-Zustimmung (`take_feedback`, Anker = `queueItemId` der H2 bzw.
   `idx:N`) und Zielform; Block „SO SCHREIBT MATTES SEINE TAKES“.
4. **Eigener Take-Durchgang** (`take-pass.ts`, `applyTakePass`): zweiter
   Aufruf (Use Case `ghostwriter_take`, Thinking medium) aus Zusammenfassung,
   Blickwinkel, Vorbildern und Quellenauszug. Der System-Prompt (≈ 2.100
   Zeichen) trägt die Stimme in vier Sätzen, ARGUMENT, LESBARKEIT, FORM und
   eine Verbotszeile (bis 2026-10-21 ein 4.100-Zeichen-Prompt mit
   Skill-Spiegel `mattes-voice.ts`, inzwischen gelöscht). `validateTake` prüft
   Wortbudget, unbelegte Zahlen (keine Pflichtzahl mehr), verbotene Auftakte,
   Gedankenstriche und „Wer“-Schluss (keine Satzstruktur, kein Skelett); bei
   Verstoß genau ein
   Korrekturlauf mit den konkreten Problemen, danach die Fassung mit weniger
   Problemen; scheitert der Aufruf, bleibt der Take des Abschnitts-Aufrufs.
   Läuft vor Lektorat, `capTake` und „Wer“-Rewrite (Sicherheitsnetz).
   **Bündel-Kompensation** (`shortenBySentences(section, 2, { take: false })`
   in `writeSectionsBatch` und im Streaming-Pfad): bei aktiven Bündeln werden
   nur noch zwei Sätze der Zusammenfassung gekürzt, der Take bleibt ganz. Bis
   zum 2026-10-19 nahm sie auch dem Take zwei Sätze (fünf → drei; nach der
   Reform drei bis vier → ein bis zwei, Betreiber-Befund am ersten Post).
5. **Kürzung und Lesbarkeit (2026-10-21):** Befund an cron-211026: Takes
   nicht zu lang, aber verschachtelt (19–26 Wörter je Satz, Faktenlisten im
   Relativsatz), drei von sieben erzählten die Zusammenfassung nach. Ursachen:
   Regel-Ballast, Zahl-Pflicht der Prüfung (trieb zum Nacherzählen) und der
   Vorbild-Block, der „Dichte und Satzbau“ der alten, verschachtelten Takes
   zum Muster erklärte. Umgesetzt: Take-Prompt halbiert plus Regel LESBARKEIT
   (ein Gedanke pro Satz, Beobachtung → Grund → Folge, keine Schachtelsätze);
   Vorbilder geben nur „Haltung und Ton“ vor; der Abschnitts-Prompt trägt
   statt des Take-Regelwerks (Mattes-Muster, Interpunktion, Kontrast,
   Self-Check, Inhaltliche Verbote, Schreibstil, Form) einen kompakten Block
   „SYNTHSZR TAKE (Entwurf)“, Tells fängt das Lektorat (`PROOFREADING_PROMPT`).
   A/B an denselben sieben Abschnitten: 15–17 Wörter je Satz, Argument in
   einer Linie. Satzstruktur-Schablonen bleiben tabu (Betreiber 2026-10-20).
6. **Perspektive und Flughöhe (2026-10-22):** Betreiber-Befund am Duet-Take:
   „nicht aus Analystenperspektive, Flughöhe stimmt nicht“ (Take über
   Entschuldigungsmails eines Kleinunternehmers). Zwei Ursachen: Seit dem
   Wegfall des Skeletts definierte kein Satz, für wen und auf welcher Höhe
   der Take spricht, und der Planer hatte einen operativen Blickwinkel
   vergeben („jede Mail spart Arbeitszeit, wenn Duet seltener falsch
   handelt“). Umgesetzt: Abschnitt PERSPEKTIVE im Take-Prompt (Analyst für
   Entscheider; Markt, Strategie, Geschäftsmodell; kein Einzelnutzer-Alltag,
   keine ausgedachte Szene; Beispiel belegt, ersetzt nicht; „Detail aus der
   Nachricht“), Zeile FLUGHÖHE in `TAKE_ANGLE_RULES` plus Stückkosten als
   Preis-/Margen-/Marktstruktur-Frage, Entwurfs-Block mit
   „Analysten-Flughöhe“. Dry-Run: Planer vergab für Duet „Marge je
   Pro-Nutzer unter Druck“ statt „spart Arbeitszeit“, der Take argumentiert
   über Flatrate gegen anlasslos arbeitenden Agenten und Preistest.
**Messen:** `pnpm takes:measure -- --posts 20` bzw. `--since <Datum>`
(`scripts/measure-takes.ts`, lesend): Wörter, Wörter je Satz, kurze Sätze,
Doppelpunkte, Zahl im Take und Schlusssatz, Prognosen, Überleben des letzten
Entwurfssatzes, Leser-Zustimmung. Kosten: ein zusätzlicher Opus-Aufruf je
Abschnitt (≈ 0,05 USD), Ghostwriter-Abschnitt davor Ø 0,13 USD.

### Agenten-Takes — KI-Agenten kommentieren Synthszr Takes (2026-10-26)
Spec `docs/superpowers/specs/2026-10-25-agent-comments-design.md` (v2), Plan
`docs/superpowers/plans/2026-10-25-agent-comments.md`. Moltbook-Muster: ein
Agent liest `/agents/skill.md` (plus `/agents/heartbeat.md`; Middleware lässt
`.md` ohne Locale-Redirect durch), registriert sich per API und schreibt unter
Takes. Betreiber-Entscheidungen 2026-10-25: offen für alle Agenten, KEINE
Bestätigung durch den Besitzer, KEINE Moderation, Sprache = Sprache der
Artikelfassung, globales Tageslimit mit Admin-Freigabe und Tageslöschung.
Betreiber 2026-10-30: kein Besitzer-Handle mehr (Registrierung, Anzeige, DB)
und keine Hinweise auf eine Nutzerfreigabe in skill.md (v1.2.0),
heartbeat.md, llms.txt, Agent-Card, RSS und `/[lang]/agents`.
`owner_handle`/`owner_contact` im Register-Body älterer skill.md-Kopien
werden angenommen und verworfen (kein 400).
- **Module `lib/agents/`:** `keys.ts` (Schlüssel `sk_agent_…`, nur SHA-256 in
  der DB), `accounts.ts` (Registrierung, Bearer-Auth, `isNewAgent` 7 Tage),
  `settings.ts` (`settings.agent_comments`: `enabled`, `daily_cap` 50,
  `relevance_min` 0,55, `paraphrase_max` 0,92, `per_section_max` 5,
  `feed_since`), `feed.ts` (`sectionsOf`: Anker-Regel wie das Take-Barometer,
  `queueItemId` der H2 sonst `idx:N` über alle Takes; Übersetzungen aus
  `content_translations`), `language.ts` (Stoppwort-Heuristik de/en, andere
  Sprachen ungeprüft), `relevance.ts` (Embedding Take↔Abschnitt und
  Take↔Synthszr-Take; Ausfall der API blockiert nicht), `comments.ts`
  (Einreichung: Artikel → Anker → Quellen → Agenten-Tageslimit 5/20 →
  Sprache → Bezug → Abschnitt → Tageslimit → Insert → Revalidate).
- **Endpunkte:** `POST /api/agents/register` (5/h je IP via Upstash, 20/Tag je
  IP-Hash), `GET /api/agents/feed?lang=&since=`, `POST /api/agents/comments`
  (Bearer; 403 bei suspended/Not-Aus; Minutenlimit `agentNew` 1/min bzw.
  `agentEstablished` 3/min; 201 `{status, holdReason}`), `DELETE
  /api/agents/comments/:id`, `GET /api/agents/me`.
- **Tabellen (Migration `20261026090000_agent_comments.sql`, manuell per
  `db query --file` einspielen):** `agent_accounts`; `post_comments` um
  `author_kind`, `agent_id`, `stance`, `sources`, `lang`, `hold_reason`
  (`daily_cap|relevance|language|section_full`), Anzeigefelder `agent_name`,
  `agent_model`; `subscriber_id` nullable mit Identitäts-Check.
  `owner_handle` (beide Tabellen) und `owner_contact` entfallen in zwei
  Schritten: `20261030090000_agent_owner_handle_nullable.sql` VOR dem Deploy
  (NOT NULL weg, Werte geleert), `20261030090100_agent_owner_handle_drop.sql`
  NACH dem Deploy (Spalten weg; vorher bräche die Bearer-Auth des alten Codes).
  Agenten-Takes sind `published` oder `pending` (mit `hold_reason`); Löschen
  ist Hard-Delete wie bei Lesern.
- **Darstellung:** `listPublishedComments(…, lang)` filtert
  `lang = <Locale> or lang is null`; `section-comments.tsx` zeigt Agenten mit
  Bot-Symbol, Modell, Haltung, Quellen und Schalter „nur
  Menschen“ (`localStorage`). Agenten-Takes erscheinen nicht im Newsletter.
- **Admin:** `/admin/agents` (Settings, heutiges Kontingent, wartende Takes mit
  Freigabe über `PATCH /api/admin/comments` `approve`, Tageslöschung
  `POST /api/admin/agents/day-delete` mit `dryRun`, Konten sperren/Schlüssel
  widerrufen über `PATCH /api/admin/agents`); `/admin/comments` und die blaue
  Info-Box auf `/admin` kennzeichnen Agenten-Takes und ihren Wartegrund.
- **Nach dem Start prüfen:** Schwellen nach zwei Wochen an wartenden vs.
  veröffentlichten Takes nachstellen; Anteil `relevance`-Wartende je Agent in
  `agent_accounts.rejections`.

### AI WEEK Wrap-Up — Synthszr Update (2026-10-24)
Der Wochenrückblick (`lib/wrapup/*`, Admin `/admin/week-wrapup`) prüft seit dem
2026-10-24 je Thema per Web-Suche, ob sich die Story seit dem Tagesartikel
weiterentwickelt hat, und ersetzt dort den gekürzten Take durch ein
„Synthszr Update“. Spec: `docs/superpowers/specs/2026-10-24-wrapup-updates-spec.md`.
- **Ablauf:** `collectWeekTopics` → `researchWeekUpdates` (`lib/wrapup/research.ts`,
  je Thema ein Aufruf mit Server-Tool `web_search_20250305`, `max_uses` 4,
  Timeout 90 s, parallel; Use Case `wrapup_research`, Default `claude-sonnet-5`)
  → EIN Compose-Aufruf (`generate.ts`, bekommt je Thema das RECHERCHE-UPDATE)
  → `assembleWrapupDoc(topics, parts, updates)`. Fällt die Recherche aus,
  ergibt das Thema `none`, der Entwurf entsteht trotzdem.
- **Stufen:** `none` (gekürzter Take, 40–60 Wörter), `minor` (Update 40–60
  Wörter, Bericht unverändert), `major` (Update bis 120 Wörter, Bericht darf
  auf etwa die Hälfte schrumpfen). Ein Update zählt nur mit Quelle, deren
  Datum NACH dem Artikeldatum und nicht nach dem Stichtag liegt
  (`parseResearchResponse`); sonst `none`. Das Intro teasert Updates in
  höchstens zwei Sätzen an, ohne Updates kein Teaser.
- **Kürzen heißt Weglassen:** Bei `major` liefert das Modell `keepParagraphs`
  (Indizes in `bodyNodes`, im Prompt als `[0]`, `[1]` … nummeriert);
  `selectParagraphs` behält Index 0 immer und mindestens zwei Knoten. Sätze
  werden nie umformuliert, weil die Quellenlinks an den Marks hängen.
- **Label und Quellen:** `assemble.ts` setzt „Synthszr Update: “ (nie das
  Modell) und darunter „Update-Quellen: Titel (Datum), …“ mit link-Marks.
  Web-Renderer (`lib/tiptap/dom-processors/*`), Newsletter-HTML
  (`lib/email/tiptap-to-html.ts`) und Take-Barometer erkennen den Marker
  `Synthszr Update` wie `Take|Contra`. `take-exemplars.ts` matcht nur
  „Synthszr Take:“, Updates werden also keine Vorbilder.
- **Zeitraum wählbar (2026-10-24):** Das Panel bietet die letzten zehn Berliner
  Tage (heute eingeschlossen) als Von/Bis an; Tage und Vorschlag (Montag der
  laufenden Woche bis heute, sonntags bis Sonnabend) liefert `GET
  /api/admin/week-wrapup` (`selectableDays`, `defaultRange` in `week.ts`).
  `POST` nimmt `{ from, to }` (YYYY-MM-DD, beide Tage inklusiv), prüft mit
  `rangeError` (Format, Reihenfolge, nicht in der Zukunft, höchstens zehn
  Tage → 400) und baut über `dateRangeWindow`; ohne Angabe bleibt es bei der
  letzten abgeschlossenen Woche (`lastCompleteWeek`, auch für die
  Status-Karte). Slug-Stamm ist `ai-week-wrap-up-<from>`.
- **Trockenlauf:** `pnpm wrapup:research-dry` (`scripts/wrapup-research-dry.ts`,
  optional `-- --asof YYYY-MM-DD`): nur Recherche, kein Entwurf; Ausgabe je
  Thema plus Kosten aus `llm_usage` (Web-Suchen separat, 0,01 USD je Suche).
  Erster Lauf 2026-10-24 (Woche 12.–18.10.): 1× none, 3× minor, 2× major,
  25 s, 1,06 USD Token plus 19 Suchen. Der Admin-Lauf dauert damit rund eine
  halbe Minute länger als bisher.

### Artikel-Job im Hintergrund (2026-10-19)
„AI Artikel erstellen“ (`app/admin/create-article/page.tsx`) legt nur noch den
Job an (`POST /api/admin/article-job`) und pollt den Status; der Tab darf
geschlossen oder (iOS) in den Hintergrund gelegt werden, beim Wiederöffnen
holt `GET ?latest=1` den laufenden oder gerade fertigen Job zurück. Getrieben
wird der Job vom Minuten-Cron `/api/cron/article-jobs`, der Phasen innerhalb
eines Aufrufs aneinanderhängt (`LOOP_BUDGET_MS` 240 s, `maxDuration` 800), und
als Zweitlinie vom 15-Minuten-Scheduler. `advanceArticleJob` claimt per
Compare-and-Set (`last_advanced_at` null oder älter als `LEASE_STALE_MS`) und
gibt den Lease am Ende jeder Phase frei; `claimed_elsewhere` ist kein Fehler.
Nacharbeiten laufen im Job (Schritt „Assets“ der lexicon-Phase, best-effort):
Cover-Bilder über `lib/images/cover-image.ts` und Ratings-Vorwärmung über
`lib/stock-synthszr/warm.ts` für die `{Company}`-Tags
(`lib/synthszr/company-tags.ts`); dieselben Funktionen nutzen
`/api/generate-image` und `/api/stock-synthszr`. Der nächtliche Auto-Job
bekommt dadurch ebenfalls ein Cover. Premarket-Firmen werden nicht vorgewärmt.

### Curation Phase 0 — Messgrundlage (2026-10-06)
Vorarbeit für das Agenten-Team „Morgenkonferenz" (Spec
`docs/superpowers/specs/2026-10-05-news-curation-team-design.md`). Kein
LLM-Textaufruf in Phase 0; nur Embeddings (`gemini-embedding-001`, 768 Dim.).

**Merge-Bedingung (hart):** `feat/curation-phase0` erst nach `main` mergen, wenn
die Migration `20261006090000_curation_phase0.sql` auf Prod angewendet UND
verifiziert ist (Plan Task 1 Steps 4/5; anwenden NUR per
`cd /Users/mattes/dev/synthszr && npx -y supabase@2.84.1 db query --linked --file <absoluter Pfad>`,
niemals `supabase db push` — Remote-Registry und Migrationsordner laufen
auseinander). Vercel deployt `main` automatisch. Ohne Spalte fallen PATCH/PUT
beim ersten Publish zwar auf einen Update ohne `published_at` zurück
(`isMissingPublishedAtColumn`, Log `[Curation] published_at-Spalte fehlt`),
diese Posts bekommen ihren Zeitstempel dann erst aus dem Backfill der
Migration (`updated_at`-Näherung), und die Event-Hooks loggen nur Fehler.

**Tabellen (Migration `supabase/migrations/20261006090000_curation_phase0.sql`,
RLS ohne Policy = nur Service-Role):**
- `generated_posts.published_at` — gesetzt beim Übergang auf `published`
  (PATCH/PUT `app/api/admin/generated-posts/route.ts`); Bestand backgefüllt.
  Fehlt die Spalte (PGRST204/42703), speichern beide Routen einmal ohne sie.
- `published_units` — eine Zeile je Top-Level-H2 eines veröffentlichten Posts
  (`position`, `heading`, `bundle_type`, `member_ids uuid[]`, `embedding`).
  Ground Truth für Recall/Precision und Archivbrief.
- `curation_precedents` — Stufen je Tag und Item: `published` |
  `dropped_after_selection` (gewählt, gestrichen) | `pending_never_selected` |
  `merged` (Similarity ≥ 0,8 zu einem veröffentlichten Heading, mit
  `matched_heading`). `unique (day, item_id)`, Tag = Berlin-Datum.
  Keine Zeile bekommen Hand-Items, die einer markerlosen Einheit (eins-zu-eins)
  oder einem Altbestand-Bündel mit gleichem Label und ≤ 1 Member-ID (n-zu-1)
  zugeordnet sind; der Pool „nie gewählt" lässt Items aus, die bei
  `created_at` schon gewählt, verbraucht oder abgelaufen waren.
  `bundle_type_selected` fällt nur bei fehlendem Schlüssel in `selected_items`
  (Jobs vor 2026-07-18) auf `news_queue.bundle_type` zurück. Das Script gibt
  eine Positivkontrolle der 0,8-Schwelle aus (Cosine published-Item ↔ eigene
  Einheit, p10/p50/p90) — liegt p50 darunter, Schwelle vor Nutzung des
  Negativblocks mit dem Betreiber klären.
- `queue_item_events` — jede Statusänderung der News-Queue mit Akteur
  (`operator` | `techmeme` | `agent` | `pipeline`), `from/to_status`,
  `from/to_role`, `reason`. Geschrieben best-effort über `recordQueueEvents`
  (`lib/news-queue/events.ts`) aus allen Status-Setzern in
  `lib/news-queue/service.ts`, `suggestions.ts`, `lib/claude/queue-article.ts`
  (Dedup-Verlierer), `lib/techmeme/job.ts` und den Admin-Routen `reset-item`
  / `bundle-type`. `selectItemsForArticle(ids, { actor })` — `actor` ist Pflicht.
  Herkunft und Hand-Begriff: `lib/curation/origin.ts` (`originOf`, `isHandItem`;
  Fallback ohne Events: `metadata.curation.run_id` → agent,
  `metadata.techmeme` → techmeme, sonst operator).

**Heading-Marker (mehrere je Zeile, am Zeilenende):**
`<!-- data-queue-item-ids:<uuid>,<uuid> --> <!-- data-bundle-type:topic -->`
(Phase 0, Pipeline); ab Phase 1 mit Rang und Tier VOR dem Typ:
`<!-- data-queue-item-ids:<uuid> --> <!-- data-curation-rank:3 --> <!-- data-curation-tier:bench --> <!-- data-bundle-type:topic -->` →
TipTap-Attrs `queueItemId` (= erste ID, Kompatibilität), `bundleType`,
`queueItemIds`, `curationRank`, `curationTier` (alle String;
`lib/utils/markdown-to-tiptap.ts`, `lib/tiptap/heading-with-queue-id.ts`,
Pipeline `ensureQueueIdMarker` in `lib/claude/ghostwriter-pipeline.ts`).
Schreiber (Pipeline `ensureQueueIdMarker`/`ensureBundleMarker`, künftige
Heading-Serializer und ein Reinject nach dem Metaphern-Dedup) setzen
`data-queue-item-ids` vor `data-bundle-type` und den Typ als LETZTEN
Kommentar, auch hinter `data-curation-rank`/`data-curation-tier`. Der
Extraktor (`extractBundleMarkers`) liest jede Reihenfolge; die feste Position schützt den Fall, dass die Pipeline ohne den neuen Extraktor
live ist (die alte `BUNDLE_MARKER_RE` erkennt den Typ nur am Zeilenende).
`embedQueueItemIds` überspringt markierte Headings; `/api/enrich` erhält die Attrs.

**Scripts (`tsx`, Env `~/.synthszr.env.prod` vor `.env.local`; Flags `--dry-run`,
`--since YYYY-MM-DD`):**
- `pnpm curation:units` — `scripts/build-published-units.ts`: Backfill
  `published_units` (erzeugt Embeddings → nur mit Freigabe; idempotent je Post).
  Wird beim Publish NICHT nachgeführt — vor jeder Baseline-Messung mit
  `--since <UTC-Datum des letzten Units-Laufs, (max(published_units.created_at) at time zone 'UTC')::date>`
  auffrischen (UTC, weil `--since` als 00:00 UTC filtert), danach `curation:precedents`
  (beides Prod-Writes, nur mit Freigabe).
- `pnpm curation:precedents` — `scripts/build-curation-precedents.ts`:
  Backfill `curation_precedents` aus manuellen `article_jobs` × `published_units`
  (`classifyPrecedents` in `lib/curation/precedents.ts`).
- `pnpm curation:baseline` — `scripts/measure-curation-baseline.ts` →
  `scripts/curation-baseline.json` (git-tracked, lese-only, 5–10 min; Egress
  Größenordnung 100–150 MB — Job-Payloads `selected_items` tragen Volltext,
  gemessen 2026-10-06 im Mittel ~240 KB je manuellem Job, und werden nur für
  manuelle Jobs + Nachtlauf je Tag in Scheiben à 10 geladen). Je Berlin-Tag der Job aus `pickPrecedentJobs`
  (`lib/curation/precedents.ts`, dieselbe Funktion wie `curation_precedents`:
  jüngster manueller Job mit veröffentlichtem Post, ohne Rückfall übersprungen
  bei `no_units` / `no_attributable_units` / `no_selected`; Abgleich mit den
  gespeicherten Präzedenzfällen in `precedents_agreement`): Pool = `news_queue` mit `queued_at`
  in `[asOf−48h, asOf)`, `asOf` = `article_jobs.created_at`, seitenweise à
  1000 bis 2000 (PostgREST `max_rows = 1000` kappt `.limit()` still), ohne
  Zeilen, die bei `asOf` nicht mehr wählbar waren (`poolExclusionAsOf`: in
  einem anderen, vorher veröffentlichten Post verbraucht oder abgelaufen —
  `pool_excluded_as_of` je Tag);
  Baselines `total_score`-Top-20 (`capByUnits` nach `totalScoreCandidates`,
  je K auf K Einheiten gekappt — ein Techmeme-Bündel zählt einmal, auch mit
  bis zu 5 IDs; Hand-Items mit `metadata.manual` auf Score 0, Labels auf null außer
  `topic` auf Techmeme-Items; beide würden sonst die veröffentlichten
  Einheiten vorziehen),
  Nachtlauf-Ist (`selected_items` des Auto-Jobs mit `status='done'`),
  Handauswahl (`isHandItem` mit Events as-of Job wie `curation_precedents` —
  unberührte Techmeme-Themen zählen nicht; P/R; alle `selected_items`
  zusätzlich als `hand_all_selected`), Zufall (seeded); Hand, Nachtlauf und
  Zufall wie `total_score` je K auf K **Einheiten** (`unitListsByK`, Einheit
  wie `capByUnits`), Dubletten-Rate auf Einheiten-Ebene (`unitDuplicateRate`:
  ein gelabeltes Mehr-Quellen-Bündel ist keine Dublette);
  Story-Ebene (`assignStoryKeys`, 0,8) und ID-Ebene bei K=10/15/20, Recall
  zusätzlich je K auf die Pool-Abdeckung normiert (`unit_recall_covered`);
  Pool-Abdeckung, `content_length`-Quantile, Techmeme-Übernahmequote je
  `techmeme_story_index` (ungefilterte Zeilen, je Story dedupliziert),
  Draft-Kosten und Schreibdurchsatz der manuellen `done`-Jobs, Techmeme-Läufe
  je UTC-Tag aus `llm_usage`, Zeitkette (`schedule_config`, Analyse-Ende je
  Tag, Newsletter-Eingang je `source_email` als Vorlauf vor dem Slot),
  Streuung/MDE (n=20/30, je 50 % und 80 % Power), Negativ-Block. Zufalls-Seed
  je Kalendertag (`daySeed`), also stabil bei `--since`. Kosten und Durchsatz sind je **Write-Unit**
  (`written_sections.length`; Bündel + Einzelfassung zählen doppelt →
  Obergrenze je veröffentlichter Einheit). Metriken:
  `lib/curation/baseline-metrics.ts`; Laden, Helfer und Messlogik:
  `lib/curation/baseline-day.ts`. Logs mit Prefix `[Curation]`.
- **Lesehinweis Abdeckung:** Abdeckung und Recall von `total_score`/`random`
  messen gegen den Stufe-1-gefilterten Pool (Junk raus, `content_length ≥ 500`).
  Techmeme-Quellen sind oft kürzer — Einheiten nur aus Techmeme-Items stehen
  separat in `coverage.units_techmeme_only` und sind kein Backfill-Fehler.
  `unit_recall_covered` = Treffer auf abgedeckte ÷ abgedeckte Einheiten
  (Zähler und Nenner pool-beschränkt, daher ≤ 1 auch für Hand/Nachtlauf).
- **Lesehinweis Hand-Leaks:** Artikel, die über `add-from-repo` mit
  `daily_repo.source_type = 'article'` in die Queue kommen, tragen Scores 9,0
  ohne Marker (`queueFromDailyRepo` in `lib/news-queue/service.ts`) und
  sind in `total_score_top20` NICHT neutralisiert — leichte Verzerrung nach oben.
  Ebenso bleibt `bundle_type = 'topic'` auf Techmeme-Items stehen (automatisch
  gesetzt von `lib/techmeme/queue-items.ts` / `promoteExistingTopicSources`);
  hat der Betreiber ein Techmeme-Item über die `bundle-type`-Route von null auf
  `topic` gelabelt, ist das historisch nicht unterscheidbar und zieht das Item
  über `capByUnits` vor die Score-Singles (Rest-Leak; andere Labels auf
  Techmeme-Items werden neutralisiert).
  Außerdem kann die Handauswahl (Hand-Items der `selected_items` des
  manuellen Jobs) Füll-Items aus `getBalancedSelection` enthalten (ohne Event
  und mit `metadata: {}` fallen sie auf `operator` zurück): `selectAndEnrichItems`
  (`lib/claude/queue-article.ts`) füllt auf, wenn nach dem
  Published-Filter weniger Items als `maxItems` übrig sind oder der Slider über
  der Auswahl steht, und nimmt ohne Auswahl ganz die Balanced-Auswahl.
  Historisch nicht erkennbar — `baselines.hand.precision_full` ist dann eine
  Untergrenze, `duplicate_rate_mean` und die Differenz Hand − total_score
  enthalten Pipeline-Picks.
- **Lesehinweis Kosten:** `llm_usage` gibt es erst seit 2026-09-20, bis
  2026-09-22 konnten Zeilen verloren gehen (Fix `dd1dead0`). Im Draft-Pfad
  loggt nur der Anthropic-Zweig von `callModelNonStreaming`, Gemini-Aufrufe
  fehlen. Jobs ohne `llm_usage`-Zeile im Fenster stehen nicht in `per_job`,
  sondern in `costs.draft_jobs.jobs_without_usage` (nicht als 0 $ gemittelt).
  `usage_first_at` zeigt den Datenbeginn. Zeilen mit `cost_usd = NULL`
  (Modell fehlte beim Schreiben in `MODEL_PRICING`, z. B. Opus 5.5 vor dem
  Pricing-Nachtrag) rechnet `llmRowOf` aus den Token-Spalten mit der heutigen
  Preistabelle nach (`repriced_calls`); nur was danach ohne Preis bleibt,
  steht in `unpriced_calls` (0 $, Untergrenze). Die DB bleibt unverändert.
  Die Lexikon-Phase des Jobs (use_case `glossary_candidate_identification`,
  `lib/article-jobs/service.ts:515-578`) fehlt in den Draft-Kosten bewusst:
  derselbe use_case läuft parallel im Artikel-Crawl und ist im Zeitfenster
  des Jobs nicht trennbar. Der Schreibdurchsatz enthält sie (Wanduhr), die
  Kosten nicht. Die beiden Zahlen beziehen sich also auf leicht verschiedene
  Mengen, die Kosten sind eine bekannte Untergrenze.
- **Lesehinweis Nachtlauf:** `nightly_actual` ist das Ist (`selected_items`
  des Auto-Jobs). Ein Replay, wie es die Spec für Phase 0 nennt, fehlt —
  `getBalancedSelection` liest den heutigen DB-Zustand und ist nicht
  as-of-fähig (offene Abweichung von der Spec, dem Betreiber gemeldet).
- **Lesehinweis Newsletter:** `newsletter_arrival_by_source` misst den Vorlauf
  in Minuten vor dem nächsten Analyse-Slot (Berlin), kritischste Quelle zuerst
  (`lead_p10_minutes` aufsteigend). Wer den Slot um X Minuten vorzieht, verliert
  Quellen mit `lead_p10_minutes < X`.
- **Lesehinweis Analyse-Ende:** `daily_repo_id IS NOT NULL` trennt die
  Synthese-Charge nicht ab (Handergänzungen über `add-from-repo` /
  `add-from-synthesis` und manuelle Synthese-Neuläufe tragen ebenfalls
  `daily_repo_id`). Gewertet wird je Berlin-Tag das Ende des ersten
  `queued_at`-Laufs (Lücke 15 min) ab `schedule_config.dailyAnalysis`;
  spätere Zeilen stehen als `later_rows`, Tage ohne solchen Lauf in
  `timeline.analysis_end_days_without_scheduled_run`. Nur volle Berlin-Tage
  der letzten 30 (angeschnittener erster und laufender Tag fallen weg).

**Gate-Referenz (Spec „Entscheidungsregel“, Schwellen final — Betreiber 2026-10-15; Böden nachkalibriert 2026-10-17):**
Shadow → Assist, wenn Unit-Recall@20 ≥ `total_score`-Top-20 desselben Runs + 0,10 (gepaarter
Bootstrap, 90 % > 0), Böden **pool-normiert** `unit_recall_covered_20` ≥ 0,60 und
`setzlisten_recall_covered_10` ≥ 0,45, Precision@10 ≥ `baselines.hand.precision_full`
(0,243, n = 49; Untergrenze, siehe Lesehinweis Hand-Leaks), Dubletten-Rate 0
(Referenz `baselines.hand.duplicate_rate_mean` = 0,016, nur gemessener Job je Tag).
**Währung:** alle Recall-Zahlen des Gates entstehen in der Rekonziliation (`publishedHitsOf`:
Member-ID, Story-Cluster oder Similarity ≥ 0,8 zum Abschnitts-Embedding; Pool des Kickoffs).
Die Phase-0-Baseline (`baselines.total_score_top20.unit_recall["20"]` = 0,240, covered 0,31/0,22,
Gesamtauswahl 0,70/0,54) misst anders (as-of Job-Zeit, Embeddings nur aus `daily_repo`, ohne
Abschnitts-Similarity) und ist mit den Gate-Zahlen nicht vergleichbar. Referenzen in der
Gate-Währung aus dem Backtest precedents-only (49 Tage, `scripts/curation-backtest.json`):
`total_score` 0,45 roh, covered 0,53/0,45; Gesamtauswahl covered 0,69/0,48; Agent 0,55/0,46.
`stats.diff_hand_minus_total_score_unit_recall_20`: sd 0,233, `mde80_n20` = 0,129, `mde80_n30` = 0,106
(z = 1,645 + 0,8416, 80 % Power); in der Gate-Währung sd 0,169, MDE80 0,094 / 0,077.
**Deshalb Gate-Entscheidung erst ab 30 Tagesdifferenzen**
(`gate.decision_ready`), der Abbruch-Check ab 20 (`gate.abort`); Alternative „20 Tage mit +0,13“ verworfen.

**Negativ-Block** „Gewählt, aber gestrichen" (`lib/curation/negatives.ts`,
`loadNegativeBlock(supabase, { days: 14 })`): Stufe-2-Einheiten, ≤ 20, ≤ 8 je
Rolle, mit Kontrast-Heading (0,65–0,8); Tokenzahl steht in
`curation-baseline.json → negative_block.approx_tokens`.

### Curation Phase 1 — Shadow (2026-10-14)
**Status: GESTOPPT (Betreiber 2026-10-18).** Drei Offline-Backtests (precedents-only,
full mit Lernkreis, Betreiber-Regeln; 53/53/20 Tage, ≈ 220 USD) brachten keinen
Vorsprung vor `total_score`-Top-20 (+0,01 / +0,02 / Regeln −0,055 gegen denselben
Arm); Shadow wurde nie eingeschaltet. Abschlussbefund in der Spec
`docs/superpowers/specs/2026-10-05-news-curation-team-design.md`. Der Code bleibt
(Engine, Tabellen, Scripts, Admin-Seite), der Minuten-Cron `/api/cron/curation-jobs`
ist aus `vercel.json` entfernt; `settings.curation` existiert nicht, die Route täte
ohne `shadow_enabled` ohnehin nichts. Das Runbook unten gilt nur, falls das Thema
wieder aufgegriffen wird — dann Cron wieder eintragen.

Das Agenten-Team „Morgenkonferenz" (Scout, Cluster, Archivar, Chefredaktion,
Kritiker) läuft täglich im Schatten auf Vercel und schreibt eine Setzliste
plus Bank als `curation_runs`/`curation_units`. Kein Write auf `news_queue`,
`queue_item_events`, `article_jobs`, `generated_posts` oder `ranking_*` — die
Queue, der Draft und der Techmeme-Lauf bleiben unangetastet.

**Tabellen** (Migration `supabase/migrations/20261014090000_curation_phase1.sql`,
RLS ohne Policy = nur Service-Role):
- `curation_runs` — ein Lauf je Tag und Modus (`shadow`/`backtest`) mit Phase,
  Lease, Versuchszähler, Protokoll und den Zwischenergebnissen jeder Phase als
  JSONB-Spalten (`pool`, `cards`, `story_keys`, `brief`, `baseline`, `plan`,
  `critique`) sowie dem Rekonziliations-Ergebnis.
- `curation_units` — eine Zeile je Plan-Einheit (Tier, Rang, Mitglieder,
  Grund, Alternative, Präzedenzen), nach der Rekonziliation um Outcome und
  finale Rolle/Rang ergänzt.
- `curation_item_embeddings` / `curation_cards` — Caches für Embeddings ohne
  `daily_repo`-Pendant und für Scout-Cards je Item und Modell.
- `get_precedent_units` (RPC) — liefert in einem Round-Trip die Top-`per_role`-
  Präzedenzeinheiten je Rolle für einen Satz Kandidaten-Embeddings.
- `get_pool_excerpts` (RPC) — Excerpt je Item, auf `max_chars` gekappt (spart
  den Volltext-Egress; `excerpt` ist bei ~77 % des Pools NULL).

**Engine** (`lib/curation/run.ts`, `lib/curation/service.ts`, Cron
`app/api/cron/curation-jobs/route.ts`):
- Minuten-Cron (`vercel.json`, `*/1 * * * *`), `maxDuration = 800`.
- Phasenfolge `pool → scout → cluster → archive → compose → units → finished`
  (`advanceRun`), jede Phase persistiert ihr Ergebnis sofort. `scout` macht
  nach dem ersten Durchgang genau einen Nachpass über alle Items ohne Card in
  Batches à `scout_batch_size`/5 (Befund 2026-10-17: Haiku ließ 19 % der
  Items aus, eine Wiederholung holt 90–100 % nach); was dann noch fehlt,
  bekommt die Titel-Card, über 10 % → `scout_partial`.
- Lease `LEASE_STALE_MS` = 15 min gegen überlappende Ticks; `claimRun` ist
  ein Compare-and-Set (nur ohne oder mit abgelaufenem Lease), verliert ein
  Tick den Claim, endet er ohne Arbeit. `runDayInline` (Scripts) claimt
  seinen Run ebenso.
- Tick-Budget `TICK_BUDGET_MS` = 600 s; `COMPOSE_MIN_REMAINING_MS` = 420 s —
  reicht die Restzeit des Ticks nicht, vertagt `phaseCompose` den Versuch
  (inkl. Zwischenstand) in den nächsten Tick, statt ins Timeout zu laufen.
- Unter `POOL_MIN_ITEMS` = 40 endet der Run als `error` (`pool_small`), ohne
  Modellaufruf.
- `MAX_ATTEMPTS` = 10 erfolglose Ticks in Folge, dann gibt der Run auf; jeder
  Phasenwechsel setzt den Zähler auf 0 zurück.

**Settings** (`settings.curation`, `loadCurationSettings`, Defaults aus
`DEFAULT_CURATION_SETTINGS`):
- `shadow_enabled` (Default `false`) — **[FREIGABE]** schaltet scharf.
- `kickoff_utc` (Default `'04:25'`) — fester UTC-Kickoff ohne
  Analyse-Bedingung/Deadline (die kommen erst in Phase 2 mit der Techmeme-Phase).
- `budget_usd` (Default 4, je Run) / `daily_budget_usd` (Default 12, je Tag).
- `min_content_length` (Default 500) / `pool_window_hours` (Default 48) /
  `scout_batch_size` (Default 25) / `critic_enabled` (Default `true`).
- `settings.curation_operator_rules` (`{text: string}`, `loadOperatorRules`) —
  freier Markdown-Text für den Archivbrief; fehlende Zeile = leer, kein Fehler.
  Wortlaut und Belege: `docs/curation-operator-rules.md` (Fassung 1, 2026-10-17,
  acht Regeln aus dem Backtest); der Regelblock steht im Brief an erster Stelle.
  Fassung 1 wurde im Backtest 27.09.–16.10. getestet und verschlechterte den
  Unit-Recall@20 um 0,055 gegenüber demselben Arm ohne Regeln — das Setting
  leer lassen (`{"text": ""}`), bis eine neue Fassung getestet ist.

**Modelle über Use Cases** (`lib/ai/use-cases.ts`, im Admin einstellbar):
`curation_scout` (Default `claude-haiku-4-5-20251001`, Kernsatz je Meldung),
`curation_editor` (Default `claude-opus-5`, Setzliste/Bank über `compose_day`),
`curation_critic` (Default `claude-sonnet-5`, harte/weiche Verstöße).

**Kosten:** Budget 4 USD je Run, 12 USD je Tag (`daily_budget_usd`);
`reserveBudget` reserviert vor JEDEM Modellaufruf (Scout, Compose, Kritiker)
und prüft im Shadow neben dem Run-Budget auch die Tageskappe: eigener Spend
plus die Ausgaben der anderen Shadow-Runs des Tages (`spentTodayUsd`, einmal je
Tick bzw. je `runDayInline` geladen). Die Tageskappe wird also je Tick
geprüft, nicht nur beim Kickoff. `spend_usd` bucht alle bezahlten Antworten
eines Aufrufs, auch Retry und Fehlerpfade (`CallInvalidError`/
`CallRefusedError` tragen `costUsd`). Das Budget ist weich um höchstens einen
Retry je Call, weil die Reservierung ein Estimate je Call ist. Reicht das
Budget nicht, degradiert die Phase (`'budget'`), statt den Lauf abzubrechen. Ein Kritiker-Degrade mit Grund `'budget'` heißt NICHT,
dass der Plan die Baseline ist: nur der Kritiker-Durchgang entfällt, der
zuletzt komponierte Plan bleibt stehen, solange er keine harten Verstöße hat;
die `total_score`-Baseline kommt nur zum Zug, wenn der Compose-Aufruf selbst
am Budget scheitert oder beide Versuche ohne gültigen Plan enden.

**Rekonziliation** (`lib/curation/reconcile.ts`, `reconcileRun`, über
`getRunsToReconcile` erst nach dem Abgleichfenster, `MATCH_WINDOW_MS` = 24 h
nach `asof` — der Kickoff-Tick des Folgetags gleicht den Vortag ab, bevor der
neue Run vorankommt; früher fände sie den Post noch nicht und schriebe
dauerhaft `attribution: 'none'`): Attribution-Kaskade
(`pickMatchingPost`) — zuerst der jüngste manuell zugeordnete
`article_jobs`-Eintrag (`job`), sonst der nächste `published_at` danach
(`published_at`), sonst derselbe Berlin-Tag (`created_at_day`), sonst kein
Treffer. Pflegt `published_units` über `processPost`
(`scripts/lib/published-units-backfill.ts`) nach — ohne das veraltet der
Archivbrief nach dem ersten Tag, weil beim Publish kein Hook schreibt.
Ein Fehler beim Abgleich blockiert den Advance nicht: der Tick protokolliert
`reconcile_error` am Run und arbeitet weiter; nach drei Fehlversuchen wird
der Run mit `reconciled_at`, `metrics: null` und `reconcile_failed`
abgeschlossen (zählt in keinem Aggregat).

**Admin:** `/admin/curation` (read-only, `app/api/admin/curation/runs/route.ts`)
— Läufe, drei Tiers, Metriken, Protokoll.

**Scripts** (`tsx`, Env `~/.synthszr.env.prod` vor `.env.local`; alle mit
`--dry-run`: nur `phasePool`/`phaseCluster`, ohne Modellaufruf, Run endet
`cancelled` mit `error_message = 'dry_run'` — der Cron-Kickoff zählt ihn
nicht als Lauf des Tages):
- `pnpm curation:backtest` (`scripts/backtest-curation.ts`) — Gate-Fenster
  plus letzte 30 Tage, `runDayInline` je Tag mit sofortiger Rekonziliation;
  u. a. `--last`, `--brief`, `--sequential`, `--max-usd`, `--force`,
  `--label <name>`. Das Label (Default `bt-<brief>-<YYYYMMDD>`) steht auf
  `curation_runs.label` und trennt die Arme: übersprungen wird nur ein
  `done`-Tag mit gleichem `brief_mode` und Label, Korrektur-Paare kommen nur
  aus dem eigenen Arm, `--report` aggregiert je Arm. `--brief full` nur mit
  `--sequential`.
- `pnpm curation:shadow-once` (`scripts/shadow-once-curation.ts`) — ein Lauf
  in einem Rutsch, von Hand angestoßen; `--asof`. Gleicht nur ab, wenn das
  Abgleichfenster (24 h nach `asof`) zu ist, sonst übernimmt der Cron am
  Folgetag; `--force` gleicht sofort ab.
- `pnpm curation:reconcile` (`scripts/reconcile-curation.ts`) — Nachschlag für
  liegen gebliebene Läufe; `--mode shadow|backtest`, `--since YYYY-MM-DD`,
  `--report` (aggregiert alle rekonziliierten Läufe des angefragten Modus);
  überspringt Läufe mit offenem Abgleichfenster, außer mit `--force`.

**Testregel:** Tests laufen mit `SUPABASE_SERVICE_ROLE_KEY=` (leer
vorangestellt), damit kein Test auf Prod schreibt.

**Gate-Regel (final 2026-10-15, Böden nachkalibriert 2026-10-17):** Shadow → Assist nach ≥ 30 Shadow-Tagen (`gate.decision_ready`),
wenn Unit-Recall@20 ≥ `total_score`-Baseline + 0,10 (gepaarter Bootstrap, 90 % > 0),
Böden pool-normiert 0,60 (`unit_recall_covered_20`) / 0,45 (`setzlisten_recall_covered_10`),
Precision@10 ≥ Hand (0,243), Dubletten-Rate 0. Abbruch (`gate.abort`, kein Rollout), wenn
Unit-Recall@20 nach 20 Tagen weiterhin unter der `total_score`-Baseline liegt. Alle Gate-Zahlen
gelten in der Währung der Rekonziliation (`publishedHitsOf`, Pool-Snapshot des Kickoffs) — die
Phase-0-Baseline misst `total_score` dort mit 0,24 statt 0,45 und ist nicht vergleichbar.

**Runbook „Shadow scharf schalten":**
1. Migration 20261014090000 eingespielt (Task 1 Step 8) und Phase-0-Migration
   vorhanden.
2. `pnpm curation:shadow-once -- --dry-run` (lesend): Pool und Cluster
   plausibel.
3. **[FREIGABE]** `pnpm curation:shadow-once` (ein echter Lauf, ~1–2 USD) →
   `/admin/curation` prüfen.
4. **[FREIGABE]** Settings setzen (SQL, lesend prüfbar):
   ```sql
   insert into settings (key, value) values ('curation', '{"shadow_enabled": true}'::jsonb)
     on conflict (key) do update set value = settings.value || '{"shadow_enabled": true}'::jsonb;
   insert into settings (key, value) values ('curation_operator_rules', '{"text": ""}'::jsonb) on conflict (key) do nothing;
   ```
   Betreiber-Regeln: Fassung 1 (`docs/curation-operator-rules.md`) wurde am 2026-10-17
   getestet und verworfen — das Setting soll leer sein; das `do nothing` oben
   überschreibt einen vorhandenen Eintrag nicht, vorher lesend prüfen.
5. Deploy auf `main` (Vercel-Cron `*/1` ist in `vercel.json`); am nächsten
   Morgen ab 04:26 UTC entsteht der Run. Am Folgetag ab 04:26 UTC
   rekonziliiert der Kickoff-Tick den Vortag vor dem neuen Run.
6. Nach 20 Shadow-Tagen: `pnpm curation:reconcile -- --report` (Gate-Aggregat
   je Arm; `/admin/curation` zeigt nur die Tage einzeln) — Abbruch-Check
   (`gate.abort`); nach 30 Tagen (`gate.decision_ready`) Gate-Entscheidung
   durch den Betreiber.

Not-Aus: `update curation_runs set cancel_requested = true where id = …` —
`advanceRun` schließt den Run beim nächsten Tick als `cancelled` ab, bevor er
weiterarbeitet. `shadow_enabled = false` stoppt nur neue Kickoffs.

## Recent Changes (2026-10-21)

### Podcast-Dialogregeln
- Die Regeln für natürlichen Dialog liegen in `lib/podcast/dialogue-style.ts`
  (`DIALOGUE_STYLE_RULES_EN/DE`) und sind in beide eingebauten Prompts von
  `app/api/podcast/generate-script` eingebunden. Sie verlangen nur, was die
  Kette hörbar macht: eine Sprechanweisung am Zeilenanfang (wird zur
  `instructions` von gpt-4o-mini-tts, weitere Klammern werden gelöscht),
  Reaktionen als eigene 1–3-Wort-Zeilen, Abbrüche mit `...`, `(overlapping)`
  für echtes Gleichzeitig-Sprechen. Gestrichen: die Quoten (mind. 8×
  overlapping, 4 Falschstarts, 3 Studio-Momente) und die Direktiv-Tags
  `[beat]`, `[short pause]`, `[paper rustle]`, `[sip]`, die `stripDirectiveTags`
  vor der Synthese löscht, ohne Stille zu erzeugen.
- Mixer (`lib/audio/crossfade.ts`, `analyzeText`): ignoriert die freie
  Sprechanweisung am Zeilenanfang (vorher zählte sie als Wörter, kurze
  Reaktionen wurden nie erkannt) und wertet `...`, `…` und `—` am Zeilenende
  als Trail-off.
- **Editierbar in Admin → Audio** („Dialogregeln (englisches Skript)“):
  Setting `podcast_dialogue_rules_en`, leer = Code-Default. Die Settings-API
  liefert den Default als `podcast_dialogue_rules_default_en` aus dem Code,
  die Seite hält keine Kopie. Die Route setzt zur Laufzeit `{dialogueRules}`
  per `resolveDialogueRules(ttsLang, override)` ein; die DE-Vorlage bleibt
  beim Code-Default. Das frühere Volltext-Feld (`podcast_script_prompt`) war
  tot, kein Aufrufer schickte `customPrompt`; es ist entfernt, der alte Wert
  vom 16.08. liegt unbenutzt in `settings`.
- Alle vier Sprachzeilen in `post_podcasts` tragen dasselbe englische Skript
  (Auslöser z. B. Artikel-Editor: „EN only“); die DE-Vorlage greift nur bei
  manueller Generierung mit Sprache de in Admin → Audio.

## Recent Changes (2026-01-14)

### Ghostwriter Queue Fix
Fixed critical issue where manually selected news queue items were being ignored:

**Problem:** `get_balanced_queue_selection()` only fetched `status='pending'` items,
so items the user selected (status='selected') were never used by the Ghostwriter.

**Solution:**
- Added `getSelectedItems()` function to fetch status='selected' items
- Updated ghostwriter-queue API to use selected items by default
- Create-article page now shows count of selected items

## Recent Changes (2026-01-13)

### Edit Learning System
Enables the Ghostwriter to learn from manual edits:
1. **Edit Capture**: When posts are saved, content_before/content_after stored in `edit_history`
2. **Diff Analysis**: `/api/admin/analyze-edits` extracts sentence-level diffs and classifies via Claude
3. **Pattern Extraction**: `/api/cron/extract-patterns` clusters similar edits (embedding > 0.85)
4. **Ghostwriter Integration**: Active patterns retrieved and applied during generation

**Edit Types:** factual, stylistic, vocabulary, grammar, structural
**Confidence:** Starts at 0.5, +0.1 when kept, -0.1 when reverted, auto-deactivate < 0.3
**Decay:** 0.95/week factor keeps patterns current

**Admin UI:** Links on Blog Posts page (`/admin`) for Analyze Edits | Extract Patterns

### Company Exclusion List
Prevents false positive Synthszr Vote badges for common German/English nouns:
- `lib/data/company-exclusions.ts` - Centralized exclusion Set
- Words like "Insider", "Experte", "Analyst", "Manager", "Partner" are excluded
- Applied in both `tiptap-renderer.tsx` (frontend) and `tiptap-to-html.ts` (email)
- To add exclusions: Edit `EXCLUDED_COMPANY_NAMES` Set in `company-exclusions.ts`

## Recent Changes (2026-01-11)

### Auto-trigger Synthszr Ratings on Post Save
When the Ghostwriter adds `{Company}` tags and the article is saved:
1. `extractCompanyTags()` extracts all `{Company}` patterns from TipTap JSON
2. Maps company names to API slugs using `KNOWN_COMPANIES` / `KNOWN_PREMARKET_COMPANIES`
3. `triggerSynthszrRatings()` fires background API calls:
   - Public companies: POST to `/api/stock-synthszr` (generates AI analysis)
   - Premarket companies: GET to `/api/premarket` (fetches from glitch.green)

This ensures Synthszr Vote badges appear when the post is viewed, even for companies not explicitly mentioned in the news.

**Location:** `app/admin/create-article/page.tsx` lines 394-472, 510-511

### Synthszr Take Styling
- Bold + uppercase for "Synthszr Take:" text
- Non-italic rendering in both editor and reader
- Background highlight: `#CCFF00`

### Company Tags Display Fix
- `{Company}` tags are stripped from visible text via `hideExplicitCompanyTags()`
- Tags still detected for rating lookup before removal

### Zeitplan-Zeitzone (2026-10-18)
Die Kette Newsletter-Abruf → WebCrawl → Analyse/Synthese → Draft läuft über
`app/api/cron/scheduled-tasks/route.ts` (Vercel-Cron alle 15 min, UTC) und
vergleicht die Uhrzeiten aus `settings.schedule_config` mit der Uhr in
`schedule_config.timezone` (IANA, Default `Europe/Berlin`; Helfer
`lib/scheduler/clock.ts`: `localClock`, `localDay`, `dayKeys`,
`isValidTimeZone`). Admin: `/admin/settings` → Zeitplan → „Zeitzone des
Zeitplans“ (volle IANA-Liste des Browsers, nach Region gruppiert); die
Schedule-API weist ungültige Namen mit 400 ab, der Scheduler fällt bei einem
ungültigen Wert auf Berlin zurück.
- Tagesmarke (`hasRunToday`, `last_run_*`) und `daily_digests.digest_date`
  folgen dem lokalen Datum der Zone; das Analyse-Fenster bleibt bei zwei
  UTC-Tagen (`newsletter_date`), damit nach einem Zonenwechsel weder ein
  Digest kollidiert noch Mails der Stunden vor UTC-Mitternacht herausfallen.
  „Synthese lief schon“ prüft seit `created_at` des Digests, nicht seit
  UTC-Mitternacht.
- Reise-Muster (Betreiber, China ab 25.10.2026): nach dem Berliner Morgenlauf
  auf `Asia/Shanghai` stellen, Zeiten z. B. 04:30/04:35/04:45/05:00 — kein
  Doppellauf am Wechseltag, erster Lauf in der folgenden Nacht (20:30 UTC),
  Queue gegen 05:00 Ortszeit voll. Rückweg: nach dem Berliner Morgen
  zurückstellen; an diesem einen Tag zeigt die Queue die Analyse aus der
  China-Nacht, Abruf und Crawl laufen trotzdem. US-Nachmittags-Newsletter
  liegen zur Laufzeit 20:30 UTC noch nicht vor und kommen einen Tag später.
- Techmeme-Cron (`0 */4`, UTC) und Health-Check sind zonenunabhängig;
  Anzeigen wie `lib/admin/fetch-status.ts` rechnen weiter in Berlin.

## Development

```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run sync-companies  # Sync premarket companies from glitch.green
```

## Environment Variables

Required:
- `STOCKS_API_BASE_URL` - glitch.green API base (default: https://glitch.green)
- `STOCKS_PREMARKET_API_KEY` - API key for premarket data
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- AI model API keys (OpenAI, Anthropic, Google)
- `AI_GATEWAY_API_KEY` - nur Offline-Skripte (News-Taste)
