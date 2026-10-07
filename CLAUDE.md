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

### Curation Phase 0 — Messgrundlage (2026-10-06)
Vorarbeit für das Agenten-Team „Morgenkonferenz" (Spec
`docs/superpowers/specs/2026-10-05-news-curation-team-design.md`). Kein
LLM-Textaufruf in Phase 0; nur Embeddings (`gemini-embedding-001`, 768 Dim.).

**Tabellen (Migration `supabase/migrations/20261006090000_curation_phase0.sql`,
RLS ohne Policy = nur Service-Role):**
- `generated_posts.published_at` — gesetzt beim Übergang auf `published`
  (PATCH/PUT `app/api/admin/generated-posts/route.ts`); Bestand backgefüllt.
- `published_units` — eine Zeile je Top-Level-H2 eines veröffentlichten Posts
  (`position`, `heading`, `bundle_type`, `member_ids uuid[]`, `embedding`).
  Ground Truth für Recall/Precision und Archivbrief.
- `curation_precedents` — Stufen je Tag und Item: `published` |
  `dropped_after_selection` (gewählt, gestrichen) | `pending_never_selected` |
  `merged` (Similarity ≥ 0,8 zu einem veröffentlichten Heading, mit
  `matched_heading`). `unique (day, item_id)`, Tag = Berlin-Datum.
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
  1000 bis 2000 (PostgREST `max_rows = 1000` kappt `.limit()` still);
  Baselines `total_score`-Top-20 (`capByUnits` nach `totalScoreCandidates`,
  je K auf K Einheiten gekappt — ein Techmeme-Bündel zählt einmal, auch mit
  bis zu 5 IDs; Hand-Items mit `metadata.manual` auf Score 0, Labels auf null außer
  `topic` auf Techmeme-Items; beide würden sonst die veröffentlichten
  Einheiten vorziehen),
  Nachtlauf-Ist (`selected_items` des Auto-Jobs mit `status='done'`),
  Handauswahl (`isHandItem` mit Events as-of Job wie `curation_precedents` —
  unberührte Techmeme-Themen zählen nicht; P/R; alle `selected_items`
  zusätzlich als `hand_all_selected`), Zufall (seeded);
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

**Gate-Referenz (Spec „Entscheidungsregel", Schwellen final nach Phase 0):**
Shadow → Assist, wenn Unit-Recall@20 ≥ `baselines.total_score_top20.unit_recall["20"]`
+ 0,10 (gepaarter Bootstrap, 90 % > 0), Boden 0,5 / Setzlisten-Recall@10 ≥ 0,35
(pool-normiert daneben: `unit_recall_covered["10"]` / `["20"]`),
Precision@10 ≥ `baselines.hand.precision_full` (n = `baselines.hand.n`; Untergrenze, siehe Lesehinweis Hand-Leaks), Dubletten-Rate 0
(Referenz: `baselines.hand.duplicate_rate_mean`, nur gemessener Job je Tag).
`stats.diff_hand_minus_total_score_unit_recall_20` liefert `sd`, `mde50_n20`/`mde50_n30`
(z = 1,645, 50 % Power) und `mde80_n20`/`mde80_n30` (z = 1,645 + 0,8416, 80 % Power).
**Die +0,10-Schwelle wird am 80-%-Wert kalibriert:** liegt `mde80_n20` über 0,10, ist
ein Effekt von +0,10 bei 20 Gate-Tagen nicht verlässlich nachweisbar (Task 14 Entscheidung 7).

**Negativ-Block** „Gewählt, aber gestrichen" (`lib/curation/negatives.ts`,
`loadNegativeBlock(supabase, { days: 14 })`): Stufe-2-Einheiten, ≤ 20, ≤ 8 je
Rolle, mit Kontrast-Heading (0,65–0,8); Tokenzahl steht in
`curation-baseline.json → negative_block.approx_tokens`.

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
