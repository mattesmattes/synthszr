# Morgenkonferenz Phase 1 „Shadow" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Agenten-Team „Morgenkonferenz" läuft täglich im Schatten auf Vercel — Scout, Cluster, Archivar, Chefredaktion, Kritiker erzeugen aus dem Tages-Pool der `news_queue` eine Setzliste plus Bank, schreiben sie als `curation_runs`/`curation_units`, und die Rekonziliation misst am Folgetag gegen den veröffentlichten Post, ohne dass die Queue, der Draft oder der Techmeme-Lauf angefasst werden. Ein lokales Backtest-Script bewertet dieselben Module über die 36 Gate-Tage und die letzten 30 Tage mit Ablationen.

**Architecture:** Eine Job-Engine nach dem Muster `glossary_jobs`/`article_jobs` (Tabelle `curation_runs` mit Phasen, Lease, Versuchszähler und Protokoll; Minuten-Cron `app/api/cron/curation-jobs/route.ts` mit `maxDuration = 800`), deren Zwischenergebnisse (Pool-Snapshot, Scout-Cards, Story-Schlüssel, Archivbrief, Plan, Kritik) als Spalten auf dem Run liegen, damit jede Phase in einem eigenen Tick laufen kann. Die Phasenlogik steckt in reinen, getesteten Modulen `lib/curation/{types,pool,cluster,scout,archive,compose,critic,run,reconcile,service}.ts`, die Modellaufrufe in `lib/ai/call.ts` (Streaming ab großem `max_tokens`, `tool_choice: auto` + Anweisung + `strict` für Modelle mit Thinking, Kostenreservierung). Das Backtest-Script `scripts/backtest-curation.ts` treibt dieselben Phasen in-process (`runDayInline`) und rekonziliert sofort; der Cron treibt sie tickweise (`advanceRun`). Eine Migration legt `curation_runs`, `curation_units`, zwei Cache-Tabellen und zwei RPCs an.

**Tech Stack:** Next.js 16 (App Router, Node-Runtime, Fluid Compute, Pro-Plan), TypeScript strict, Supabase (PostgREST + pgvector, Migration ausschließlich per `npx -y supabase@2.84.1 db query --linked --file`), `@anthropic-ai/sdk` 0.71.2 direkt (kein Gateway), Gemini `gemini-embedding-001` (768) für Embeddings, Vitest 4, pnpm 10, `tsx` für Scripts.

**Spec:** `docs/superpowers/specs/2026-10-05-news-curation-team-design.md` — Abschnitte „Das Team", „Pool", „Herkunft und Hand-Begriff", „Drei Tiers", „Harte Regeln", „Datenquellen und Lernen", „Archivbrief", „Ablauf", „Output-Vertrag" (nur Lesestellen), „Umgang mit den Techmeme-Bündeln", „Evaluation und Gate", „Kosten", „Rollout → Phase 1". Schnittstellen-Vertrag der Tasks: **Anhang A** am Ende dieses Dokuments (verbindlich). Vorgänger: `docs/superpowers/plans/2026-10-06-curation-phase0.md` (Anhang A dort gilt weiter für alle Phase-0-Module).

**Betreiber-Entscheidungen 2026-10-14, die von der Spec abweichen (Änderungsprotokoll v4 → v4.1, in die Spec zu übernehmen in Task 14):**
1. **Shadow läuft auf Vercel, nicht per launchd vom Mac Studio.** Begründung: Pro-Plan mit `maxDuration = 800` (heute schon `app/api/cron/article-jobs/route.ts:6`), zwei fertige Job-Engines als Muster, und Phase 2 braucht dieselbe Engine ohnehin. Lokal bleibt nur der einmalige Backtest.
2. **Schreibrechte des Shadow:** zusätzlich zu `curation_runs`/`curation_units` schreibt Phase 1 (a) `llm_usage` über `withUsageLogging` (Kostenkontrolle, wie jeder Modellaufruf der App), (b) `published_units` für den in der Rekonziliation attribuierten Post (idempotent über `processPost` aus `scripts/lib/published-units-backfill.ts:102` — ohne das veraltet der Archivbrief nach dem ersten Tag, denn beim Publish schreibt kein Hook), (c) die Cache-Tabellen `curation_item_embeddings` und `curation_cards`. Keine Writes auf `news_queue`, `queue_item_events`, `article_jobs`, `generated_posts`, `ranking_*`.
3. **`get_precedent_units` nimmt keine Rolle als Parameter**, sondern liefert in EINEM Aufruf die Top-`per_role` Einheiten je Rolle (ein Round-Trip statt fünf).
4. **Kickoff in Phase 1 ist ein fester UTC-Zeitpunkt** (`settings.curation.kickoff_utc`, Default `04:25`) ohne Analyse-Bedingung und Deadline — die kommen in Phase 2 mit der Run-Phase `techmeme`.

## Global Constraints

- **Repo:** `/Users/mattes/dev/synthszr` (NICHT der Dropbox-Pfad). Vor Beginn `git fetch --prune` und Stand gegen `origin/main` prüfen (Memory „github-ist-die-quelle").
- **Prod-Writes nur mit Betreiber-Freigabe:** Migration anwenden (`cd /Users/mattes/dev/synthszr && npx -y supabase@2.84.1 db query --linked --file <absoluter Pfad>`, niemals `supabase db push`), Settings-Schlüssel `curation` setzen (`shadow_enabled: true` schaltet den Shadow scharf), Backtest-Lauf (Modellkosten ~55–90 USD je Iteration), erster Shadow-Lauf. Diese Schritte tragen **[FREIGABE]**. Lesende Scripts gegen Prod sind erlaubt. Hinweis: der Auto-Mode-Classifier dieser Sessions blockiert `supabase db query --linked` auch für reine SELECTs als „Production Deploy" (2026-10-14) — betroffene Schritte dann dem Betreiber zum Ausführen geben, nicht umgehen.
- **Migration idempotent** (`if not exists`, `create or replace function`), RLS `enable row level security` ohne Policy **plus** REVOKE von `public`/`anon`/`authenticated` und GRANT an `service_role` auf Tabellen UND Funktionen, Verifikations-SELECT am Ende — Muster `supabase/migrations/20261006090000_curation_phase0.sql:113-192` und `20260804120000_glossary_related_terms_rpc.sql:24-61` (RPC: `language sql`, `security invoker`, `set search_path = pg_catalog, public`). **Keine Postgres-Enums** (Repo-Konvention: `text … check (x in (…))`).
- **Kein Write auf `news_queue`/`queue_item_events`/`article_jobs`/`generated_posts`** in Phase 1 — der Protokollant (Commit, Events `merged_into`, Draft) ist Phase 2. Erlaubte Writes: Entscheidung 2 oben.
- **Modelle nur über Use Cases:** `curation_scout` (Default `claude-haiku-4-5-20251001`), `curation_editor` (Default `claude-opus-5`, `max_tokens` 24000, `output_config.effort: 'medium'`), `curation_critic` (Default `claude-sonnet-5`, effort `low`). Aufrufe ausschließlich über `lib/ai/call.ts`; Modell-Fähigkeiten über `getModelCapabilities` (`lib/claude/model-capabilities.ts:129`). Regeln: Streaming (`messages.stream(...).finalMessage()`) ab `max_tokens > 16384`; forced `tool_choice` nur wenn `supportsForcedToolChoice && !thinking`, sonst `{type:'auto'}` + Anweisung „Antworte ausschließlich über das Tool X" als letzter System-Block + ein Retry ohne `tool_use`; `strict: true` auf jedem Tool; `stop_reason === 'refusal'` → `CallRefusedError`; Haiku 4.5 ohne `thinking`/`effort`. Pricing-Lookup exakt über `MODEL_PRICING[model].pricing` (`lib/ai/model-pricing.ts:31`); unbekanntes Modell → Schätzung mit `{input: 5, output: 25}` (fail-closed nach oben).
- **Kosten-Bremse:** `budget_usd` je Run (Default 4), `daily_budget_usd` (Default 12) über alle Runs eines Tages; Reservierung VOR jedem Call (`estimateUsd`), Korrektur NACH dem Call mit `computeCostUsd` (`lib/ai/usage-cost.ts:41`); Reservierung über Budget → kein Call, Phase degradiert (`degraded` enthält `'budget'`).
- **as-of überall:** Pool `queued_at < asOf` im Fenster `[asOf − 48 h, asOf)` (`poolWindow`, `lib/curation/baseline-day.ts:195`), Status as-of über `poolExclusionAsOf` (`lib/curation/precedents.ts:344`), Hand-Begriff `isHandItem(item, eventsAsOf(events, asOf))`, Coverage/Präzedenzen/Negativmenge/Panel/Korrektur-Paare mit `published_at < asOf` bzw. `at < asOf`. Shadow und Backtest nutzen DIESELBE Pool-Logik; ein nachgeholter Lauf sieht denselben Pool wie der Betreiber um 04:30 UTC.
- **PostgREST:** `.in()` in Scheiben à 200, schmale Zeilen in Seiten à 1000 per `.range()` mit Zweitschlüssel `id`, breite Zeilen (Embeddings, Content) in Seiten à 200; pgvector immer über `parseEmbedding` (`lib/news-queue/semantic-dedup.ts:120`); `news_queue.content` NIE komplett laden — Excerpts kommen gekappt aus der RPC `get_pool_excerpts`.
- **Embeddings:** nur `generateEmbeddings` (`lib/embeddings/generator.ts:57`, Batch 16) mit `prepareTextForEmbedding(title, text)` OHNE `includeSource` (vergleichbar mit `daily_repo.embedding` und `published_units.embedding`, beide ohne Quelle). Vorhandene `daily_repo.embedding` wiederverwenden; Items ohne `daily_repo_id` oder ohne Embedding on-the-fly, Ergebnis in `curation_item_embeddings` cachen. 3 Embedding-Fehler in Folge → Phase scheitert (`createEmbedFailGuard`-Muster); einzelne Fehler → Item ohne Embedding = eigener Cluster.
- **Schwellen:** Merge/Story `DEFAULT_DEDUP_THRESHOLD = 0.8` (`semantic-dedup.ts:19`); `related` 0.65–0.8 nur als Hinweis im Prompt; Rekonziliation `merged`/Story-Treffer ≥ 0.8.
- **Tests:** Vitest 4, nur `tests/**/*.test.ts`; Testlauf immer `SUPABASE_SERVICE_ROLE_KEY= pnpm vitest run tests/lib tests/api/<datei>` (leerer Key: `tests/setup.ts` lädt `.env.local` = Prod, `tests/lib/rankings-resolve-product-db.test.ts` schriebe sonst nach Prod). Supabase-Mock je Testdatei kopiert (`makeChain` mit FIFO je Tabelle + `chain.then`, Vorlage `tests/lib/curation-baseline-day.test.ts:29-57`; Methoden `select,eq,neq,in,is,or,not,lt,lte,gt,gte,order,limit,range,update,insert,upsert,delete,single,maybeSingle,rpc` bereitstellen). Modellaufrufe in Tests NIE echt: Module nehmen `callTool: CallToolFn` und `embed: EmbedTexts` als Parameter. `pnpm typecheck` (umfasst `tests/` und `scripts/`) muss grün sein; `pnpm lint` ist tot (keine ESLint-Config).
- **Stil:** deutsche WARUM-Kommentare mit Beleg (`BEFUND 2026-10-14`, `Betreiber-Vorgabe 2026-10-14`), Logging-Prefix `[Curation]` (Module, Scripts, Cron), Commits `feat(curation): …`/`feat(ai): …`/`feat(admin): …` mit deutschem Betreff und Trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Scope-Grenze zu Phase 2:** kein Commit in die Queue, kein Draft, kein Panel-Schreiben, kein Bündeltyp `story`, keine Run-Phase `techmeme`, keine Kickoff-Deadline, kein `POST /api/admin/curation`, keine Änderung an `selectItemsForArticle`, `queue-article.ts`, `ghostwriter-pipeline.ts`, `lib/techmeme/*`, `semantic-dedup.ts` (die Coverage-as-of-Funktion entsteht in `lib/curation/archive.ts`, nicht dort — Surgical Changes).

## Review Focus

1. **Pool unter 40 Items oder leer** (Analyse nicht gelaufen, Feiertag, Kickoff vor der Synthese): der Run endet mit `status='error'`, `error_message='pool_small:<n>'`, OHNE einen einzigen Modellaufruf und ohne Zeilen in `curation_units`; die Admin-Seite zeigt „Konferenz ausgefallen". → Test in Task 9 (`advanceRun` mit 12 Items: keine `callTool`-Aufrufe, `finishRun(…,'error','pool_small:12')`).
2. **Chefredaktion liefert IDs außerhalb des Snapshots, doppelte Member, Einheiten mit > 5 Quellen, Rang-Lücken, zwei `cover_story`:** `validatePlan` entfernt unbekannte IDs, dedupliziert, kappt auf 5 (Hinweis in `fixes`), nummeriert Ränge je Tier neu, lässt eine Einheit ohne gültige Member wegfallen (die nächste Bank-Einheit rückt nach); der Kritiker meldet die zweite `cover_story` als Hard-Verstoß → genau eine Revision; nach zwei Versuchen Baseline-Plan mit `degraded: ['compose_fallback']`. → Tests in Task 7 (`validatePlan`) und Task 9 (zwei Versuche → Baseline-Plan, `callTool` genau zweimal für `curation_editor`).
3. **Hand-Story fehlt im Plan oder ein Hand-Item wurde einem Nicht-Hand-Tier `held` zugeordnet:** `checkHardRules` meldet `hand_missing:<story_key>` bzw. `held_not_hand:<unit_key>`; eine Hand-Story mit drei Quellen darf nicht auf drei Einheiten verteilt sein (`story_duplicate`). → Test in Task 8.
4. **Rekonziliation ohne Post:** kein manueller Job und kein Post innerhalb 24 h nach `asof` → `reconciled_at` gesetzt, `matched_post_id = null`, `metrics = { attribution: 'none' }`, KEINE Outcomes geschrieben, Tag zählt in keiner Aggregation als Recall 0. Post mit `published_at` weit nach `created_at` (Backfill-Näherung aus `updated_at`) wird über den Job des Tages gefunden, nicht über `published_at`. → Tests in Task 10 (`pickMatchingPost`: Job-Treffer, `published_at`-Treffer, `created_at`-Tag-Treffer, kein Treffer).
5. **Tick läuft ins Function-Timeout mitten in Compose:** der Run bleibt `processing` mit Lease; der nächste Tick nimmt ihn erst nach `LEASE_STALE_MS` (15 min) wieder auf, `attempts` steigt, `compose_attempts` wurde VOR dem Call persistiert, nach `MAX_ATTEMPTS = 10` endet der Run mit `error`; Compose startet nur bei ≥ 420 s Restbudget im Tick. → Tests in Task 9 (Restbudget 300 s → Phase bleibt `compose`, kein Call, `finished: false`) und Task 11 (Route: `attempts >= MAX_ATTEMPTS` → `finishRun(…,'error')` vor jeder Arbeit).
6. **Budget reißt mitten im Run:** Reservierung für den Kritiker überschreitet `budget_usd` → Kritiker übersprungen, `degraded: ['budget']`, nur deterministische Prüfung; Reservierung für Compose überschreitet → Baseline-Plan, kein Opus-Call. → Test in Task 9.
7. **`strict: true` oder `tool_choice`-Kombination wird vom Modell mit 400 abgelehnt** (z. B. Betreiber stellt `curation_editor` auf Fable 5.1): `callTool` wiederholt einmal ohne `strict`, loggt `[Curation] strict abgelehnt`, und nutzt für Modelle ohne `supportsForcedToolChoice` nie `tool_choice: tool`. → Test in Task 2 (Fake-Client wirft `BadRequestError` mit „strict" → zweiter Aufruf ohne `strict`).

---
## Dateistruktur (neu = N, geändert = M)

| Datei | Verantwortung |
|---|---|
| N `supabase/migrations/20261014090000_curation_phase1.sql` | `curation_runs`, `curation_units`, `curation_item_embeddings`, `curation_cards`; RPCs `get_precedent_units`, `get_pool_excerpts`; RLS + REVOKE/GRANT; Verifikations-SELECT |
| N `lib/curation/types.ts` | Alle Typen der Phase 1 (Run, Unit, Snapshot, Card, Plan, Kritik, Metriken, Settings) — keine Logik |
| N `lib/ai/call.ts`, M `lib/ai/usage-log.ts` (`flushUsageLog`), M `lib/ai/use-cases.ts` (drei Use Cases), M `app/admin/settings/page.tsx:101-126` (Gruppe „Kuration"), M `tests/lib/use-cases.test.ts:7-44` | Modellaufrufe mit Streaming, Tool-Wahl je Fähigkeit, `strict`, Refusal, Kosten; Use-Case-Registrierung |
| N `lib/curation/service.ts` | DB-Helfer für Runs/Units/Settings (Client als erster Parameter), Lease, Protokoll, `kickoffAsOf` |
| N `lib/curation/pool.ts` | Pool as-of (Zeilen, Status, Junk, Länge, Excerpts per RPC, Hand-Begriff, Techmeme-Stories), Embeddings mit Cache |
| N `lib/curation/cluster.ts` | Story-Schlüssel je Item (Hand → Techmeme → Rest), `related`-Paare, Hand-Stories |
| N `lib/curation/scout.ts` | Scout-Tool, Batches, Validierung, Card-Cache, Fallback-Card |
| N `lib/curation/archive.ts` | Archivbrief: Betreiber-Regeln, Rollen-Soft-Range, Coverage as-of, Präzedenz-RPC, Negativ-Block (Task 12 aus Phase 0), Korrektur-Paare, Panel, Techmeme-Quote; Formatierung |
| N `lib/curation/compose.ts` | `compose_day`-Tool, Prompt-Bau (Cards gemischt, Brief gecacht), Zod-Parse, `validatePlan`, `baselinePlan`, `unitKeyFor` |
| N `lib/curation/critic.ts` | Hard-/Soft-Regeln deterministisch, Kritiker-Tool (Sonnet), Revisionshinweise |
| N `lib/curation/run.ts` | Phasenmaschine `advanceRun` (Tick) und `runDayInline` (Script), Budget-Reservierung, Baseline-Plan-Fallback, Einheiten aus Plan |
| N `lib/curation/reconcile.ts` | Attribution (Job → `published_at` → `created_at`-Tag), `published_units` nachpflegen (`processPost`), Outcomes, Metriken, Aggregation + Gate-Prüfung |
| N `app/api/cron/curation-jobs/route.ts`, M `vercel.json` (Cron `*/1 * * * *`) | Tick: Kickoff, Rekonziliation, Advance |
| N `app/api/admin/curation/runs/route.ts`, N `app/admin/curation/page.tsx`, M `components/admin/admin-nav.tsx:147-170` | Read-only-Ansicht: Runs, drei Tiers, Metriken, Protokoll |
| N `scripts/backtest-curation.ts`, N `scripts/shadow-once-curation.ts`, N `scripts/reconcile-curation.ts`, M `package.json` (`curation:backtest`, `curation:shadow-once`, `curation:reconcile`) | Offline-Backtest mit Ablationen und Report; lokaler Einzellauf; Nach-Rekonziliation |
| M `CLAUDE.md`, M `docs/superpowers/specs/2026-10-05-news-curation-team-design.md` (Änderungsprotokoll v4 → v4.1) | Doku, Runbook Shadow-Start, Betreiber-Entscheidungen |
| N Tests `tests/lib/curation-{types,call,service,pool,cluster,scout,archive,compose,critic,run,reconcile}.test.ts`, `tests/api/curation-jobs-route.test.ts`, `tests/api/curation-runs-route.test.ts` | je Task |

---

## Anhang A: Schnittstellen-Vertrag und Task-Schnitt

Spec: `docs/superpowers/specs/2026-10-05-news-curation-team-design.md`. Maßgeblich ist das Repo (HEAD `a21ecaf3`, 2026-10-14); Zeilenangaben können sich verschieben — im Zweifel per Funktionsname suchen. Jede begründete Abweichung eines Tasks wird in Abschnitt 6 „Nachträge" festgehalten.

### 0. Globale Konventionen (gelten für jeden Task)

- Alle Phase-0-Konventionen (`docs/superpowers/plans/2026-10-06-curation-phase0.md:15881-15893`) gelten weiter: Client als erster Parameter `supabase: SupabaseAdmin` (`import type { SupabaseAdmin } from '@/lib/news-queue/events'`), Scripts als dünne Schleifen, `.in()` à 200, Seiten à 1000/200, `parseEmbedding`, `prepareTextForEmbedding` ohne Quelle, dotenv-Kopf vor `@/`-Imports, `main().then(() => process.exit(0)).catch(...)` — in Phase 1 davor `await flushUsageLog()`.
- Phase-0-Module werden NICHT geändert (außer wo Dateistruktur es nennt). Wiederverwendet werden: `poolWindow`, `berlinDay`, `isoDayShift`, `loadRepoEmbeddings`, `totalScoreListsByK`, `unitKeyOf`, `unitListsByK`, `unitCappedMetricsOf` (`lib/curation/baseline-day.ts`); `poolExclusionAsOf`, `loadPostPublishTimes`, `eventsAsOf`, `precedentSelectedItems` (`lib/curation/precedents.ts`); `assignStoryKeys`, `unitRecallAtK`, `precisionAtK`, `unitDuplicateRate`, `pairedBootstrap`, `mdeAtN`, `mulberry32` (`lib/curation/baseline-metrics.ts`); `isHandItem` (`lib/curation/origin.ts`); `loadEventsForItems` (`lib/news-queue/events.ts`); `loadNegativeBlock` (`lib/curation/negatives.ts`); `clusterByEmbedding`, `parseEmbedding`, `DEFAULT_DEDUP_THRESHOLD` (`lib/news-queue/semantic-dedup.ts`); `isJunkTitle` (`lib/news-queue/service.ts:136`); `capByUnits` (`lib/claude/queue-article.ts:125`); `generateEmbeddings`, `prepareTextForEmbedding`, `cosineSimilarity` (`lib/embeddings/generator.ts`); `extractPublishedUnits` (`scripts/lib/taste-ground-truth.ts:190`), `processPost`, `createEmbedFailGuard`, `EmbedTexts`, `PostRow` (`scripts/lib/published-units-backfill.ts`); `createToolCall` (`lib/claude/tool-call.ts:73`); `getModelCapabilities` (`lib/claude/model-capabilities.ts:129`); `withUsageLogging` (`lib/ai/usage-log.ts:84`); `extractUsage`, `computeCostUsd`, `UsageTokens` (`lib/ai/usage-cost.ts`); `MODEL_PRICING` (`lib/ai/model-pricing.ts:31`); `getModelForUseCase` (`lib/ai/model-config.ts:55`); `verifyCronAuth` (`lib/security/cron-auth.ts:54`); `requireAdmin` (`lib/auth/session.ts:110`); `createAdminClient` (`lib/supabase/admin.ts`); `CurationTier` (`lib/utils/markdown-to-tiptap.ts:10`).
- `lib/curation/*.ts` importiert nichts aus `scripts/` außer `scripts/lib/published-units-backfill.ts` und `scripts/lib/taste-ground-truth.ts` (beide reine Module, wie Phase 0 Task 10/11).
- Modellaufrufe nur über `CallToolFn` (Parameter), Embeddings nur über `EmbedTexts` (Parameter). Produktion verdrahtet beides in Cron-Route und Scripts: `createCaller({ runId, mode }).callTool` und `(texts) => generateEmbeddings(texts, { batchSize: 16 })`.
- JSON-Spalten werden als Objekte gelesen/geschrieben (supabase-js serialisiert); `member_ids`/`precedent_ids` sind `uuid[]` (Array von Strings).
- Zeitstempel ISO-8601 UTC (`new Date().toISOString()`); Tag = Berlin-Datum über `berlinDay`. `asof` eines Shadow-Runs ist exakt `kickoffAsOf(now, settings.kickoff_utc)`.
- Logging: jede Phase schreibt eine Zeile `appendRunLog(supabase, run, [{ at: stamp(), text, ok }])`, Prefix in `console.log` ist `[Curation]`.

### 1. Schema (Task 1) — `supabase/migrations/20261014090000_curation_phase1.sql`

```sql
-- Phase 1 „Shadow" der Morgenkonferenz (Spec 2026-10-05, Plan 2026-10-14).
-- Einspielen NUR per: cd /Users/mattes/dev/synthszr && npx -y supabase@2.84.1 db query --linked --file <absoluter Pfad>
-- Niemals `supabase db push` (Remote-Registry und Ordner laufen auseinander).

create table if not exists public.curation_runs (
  id uuid primary key default gen_random_uuid(),
  day date not null,                                   -- Berlin-Datum von asof
  mode text not null check (mode in ('shadow','backtest')),
  asof timestamptz not null,                           -- Pool-Stichtag: queued_at < asof
  status text not null default 'pending'
    check (status in ('pending','processing','done','error','cancelled')),
  phase text not null default 'pool'
    check (phase in ('pool','scout','cluster','archive','compose','units','finished')),
  brief_mode text not null default 'full' check (brief_mode in ('none','precedents-only','full')),
  attempts int not null default 0,                     -- Ticks ohne Fortschritt (wie glossary_jobs)
  last_advanced_at timestamptz,                        -- Lease gegen ueberlappende Ticks
  cancel_requested boolean not null default false,
  log jsonb not null default '[]'::jsonb,              -- [{at,text,ok}]
  degraded jsonb not null default '[]'::jsonb,         -- ['pool_embeddings','scout_partial','archive','critic','compose_fallback','budget']
  budget_usd numeric(8,4) not null default 4,
  spend_usd numeric(8,4) not null default 0,
  compose_attempts int not null default 0,
  pool jsonb,                                          -- PoolSnapshot
  cards jsonb,                                         -- ScoutCard[]
  story_keys jsonb,                                    -- ClusterResult
  brief jsonb,                                         -- ArchiveBrief
  baseline jsonb,                                      -- BaselineLists (total_score-Top-K als IDs)
  plan jsonb,                                          -- ComposePlan (validiert)
  critique jsonb,                                      -- Critique
  reconciled_at timestamptz,
  matched_post_id uuid,
  matched_job_id uuid,
  metrics jsonb,                                       -- RunMetrics
  model_scout text, model_editor text, model_critic text,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
-- Hoechstens EIN offener Run je Tag und Modus (Doppelstart auf DB-Ebene verhindert).
create unique index if not exists curation_runs_one_open_per_day
  on public.curation_runs (day, mode) where status in ('pending','processing');
create index if not exists idx_curation_runs_day on public.curation_runs (day desc, created_at desc);
create index if not exists idx_curation_runs_open on public.curation_runs (created_at)
  where status in ('pending','processing');
create index if not exists idx_curation_runs_unreconciled on public.curation_runs (asof)
  where status = 'done' and reconciled_at is null;

create table if not exists public.curation_units (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.curation_runs(id) on delete cascade,
  unit_key text not null,
  member_ids uuid[] not null default '{}',             -- news_queue-IDs, kein FK (Items werden nach Ablauf geloescht)
  story_key text,
  role text check (role is null or role in ('topic','recap','deep_dive','cover_story')),
  rank int,                                            -- null nur bei outcome='added'
  tier text check (tier is null or tier in ('recommended','bench','held')),  -- null nur bei outcome='added'
  reason text,
  alternative text,
  precedent_ids uuid[] not null default '{}',          -- published_units.id
  is_hand boolean not null default false,
  panel_action text check (panel_action is null or panel_action in ('keep','drop','relabel','take_alt','promote')),
  panel_at timestamptz,
  outcome text check (outcome is null or outcome in
    ('kept','relabeled','merged','dropped_after_selection','dropped_never_selected','added')),
  final_role text,
  final_rank int,
  matched_post_id uuid,
  matched_heading text,
  similarity real,
  created_at timestamptz not null default now(),
  unique (run_id, unit_key),
  check ((outcome = 'added') = (tier is null))
);
create index if not exists idx_curation_units_run on public.curation_units (run_id);

-- Caches: Embeddings fuer Items ohne daily_repo-Embedding (Techmeme, manuell) und Scout-Cards je Item.
create table if not exists public.curation_item_embeddings (
  item_id uuid primary key,
  embedding vector(768) not null,
  created_at timestamptz not null default now()
);
create table if not exists public.curation_cards (
  item_id uuid not null,
  model text not null,
  core text not null,
  created_at timestamptz not null default now(),
  primary key (item_id, model)
);

-- RPC 1: Praezedenz-Einheiten je Rolle fuer einen Satz Kandidaten-Embeddings (ein Round-Trip).
create or replace function public.get_precedent_units(
  candidate_embeddings vector(768)[], before timestamptz, per_role int default 8)
returns table (unit_id uuid, post_id uuid, heading text, bundle_type text,
               published_at timestamptz, similarity real, candidate_index int)
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  with cand as (
    select (ord - 1)::int as idx, e from unnest(candidate_embeddings) with ordinality as t(e, ord)
  ),
  scored as (
    select u.id, u.post_id, u.heading, coalesce(u.bundle_type, '') as role, u.published_at,
           max(1 - (u.embedding <=> c.e))::real as sim,
           (array_agg(c.idx order by (u.embedding <=> c.e)))[1] as cidx
    from public.published_units u
    cross join cand c
    where u.embedding is not null and u.published_at < before
    group by u.id, u.post_id, u.heading, u.bundle_type, u.published_at
  ),
  ranked as (
    select *, row_number() over (partition by role order by sim desc) as rn from scored
  )
  select id, post_id, heading, nullif(role, ''), published_at, sim, cidx
  from ranked where rn <= per_role
  order by role, sim desc;
$$;

-- RPC 2: Excerpt je Item, gekappt — spart den Volltext-Egress (BEFUND 2026-10-14: excerpt ist bei ~77 % des Pools NULL).
create or replace function public.get_pool_excerpts(ids uuid[], max_chars int default 1500)
returns table (id uuid, excerpt text)
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select q.id,
         coalesce(nullif(btrim(q.excerpt), ''), left(regexp_replace(coalesce(q.content, ''), '\s+', ' ', 'g'), max_chars))
  from public.news_queue q where q.id = any(ids);
$$;

alter table public.curation_runs enable row level security;
alter table public.curation_units enable row level security;
alter table public.curation_item_embeddings enable row level security;
alter table public.curation_cards enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['curation_runs','curation_units','curation_item_embeddings','curation_cards'])
  loop
    execute format('revoke all on table public.%I from public', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

revoke all on function public.get_precedent_units(vector(768)[], timestamptz, int) from public, anon, authenticated;
grant execute on function public.get_precedent_units(vector(768)[], timestamptz, int) to service_role;
revoke all on function public.get_pool_excerpts(uuid[], int) from public, anon, authenticated;
grant execute on function public.get_pool_excerpts(uuid[], int) to service_role;

-- Verifikation (nur aussagekraeftig, wenn die ganze Datei lief):
select
  (select count(*) from information_schema.tables where table_schema='public'
     and table_name in ('curation_runs','curation_units','curation_item_embeddings','curation_cards')) as neue_tabellen,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
     and c.relname in ('curation_runs','curation_units','curation_item_embeddings','curation_cards') and c.relrowsecurity) as rls_aktiv,
  not exists (select 1 from pg_policies where schemaname='public'
     and tablename in ('curation_runs','curation_units','curation_item_embeddings','curation_cards')) as keine_policy,
  not exists (select 1 from information_schema.role_table_grants where table_schema='public'
     and table_name in ('curation_runs','curation_units','curation_item_embeddings','curation_cards')
     and grantee in ('anon','authenticated','PUBLIC')) as anon_hat_keinen_zugriff,
  (select count(*) from pg_indexes where schemaname='public' and indexname in
     ('curation_runs_one_open_per_day','idx_curation_runs_day','idx_curation_runs_open','idx_curation_runs_unreconciled','idx_curation_units_run')) as neue_indizes,
  not exists (select 1 from information_schema.routine_privileges where routine_schema='public'
     and routine_name in ('get_precedent_units','get_pool_excerpts') and grantee in ('anon','authenticated','PUBLIC')) as anon_keine_rpc,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
     and p.proname in ('get_precedent_units','get_pool_excerpts')) as rpcs;
```
Erwartet: `neue_tabellen = 4`, `rls_aktiv = 4`, `keine_policy = true`, `anon_hat_keinen_zugriff = true`, `neue_indizes = 5`, `anon_keine_rpc = true`, `rpcs = 2`.

Settings-Schlüssel (kein Schema, `settings(key, value jsonb)`): `curation` = `CurationSettings` (Default im Code, Task 4), `curation_operator_rules` = `{ "text": "<Betreiber-Regeln, Markdown>" }` (fehlt → leer). Beide werden mit `.select('value').eq('key', K).maybeSingle()` gelesen; geschrieben werden sie in Phase 1 nur vom Betreiber (SQL/Studio) — **[FREIGABE]**.

### 2. Typen (Task 1) — `lib/curation/types.ts` (vollständig)

```ts
import type { CurationTier } from '@/lib/utils/markdown-to-tiptap'
export type { CurationTier }

export type CurationRole = 'topic' | 'recap' | 'deep_dive' | 'cover_story'
export const CURATION_ROLES: readonly CurationRole[] = ['topic', 'recap', 'deep_dive', 'cover_story']
export type RunMode = 'shadow' | 'backtest'
export type RunStatus = 'pending' | 'processing' | 'done' | 'error' | 'cancelled'
export type RunPhase = 'pool' | 'scout' | 'cluster' | 'archive' | 'compose' | 'units' | 'finished'
export type BriefMode = 'none' | 'precedents-only' | 'full'
export type Degradation = 'pool_embeddings' | 'scout_partial' | 'archive' | 'critic' | 'compose_fallback' | 'budget'

/** Ein Item des Tages-Pools, as-of eingefroren (Snapshot auf dem Run). */
export interface PoolSnapshotItem {
  id: string
  title: string
  source_identifier: string
  source_display_name: string | null
  total_score: number
  bundle_type: string | null
  metadata: Record<string, unknown> | null
  content_length: number | null
  daily_repo_id: string | null
  queued_at: string
  source_pub_rate: number
  excerpt: string                     // aus get_pool_excerpts, max 1500 Zeichen
  hand: boolean                       // isHandItem as-of
  techmeme_story: string | null
  techmeme_story_index: number | null
}
export interface PoolSnapshot {
  asOf: string
  windowFrom: string
  items: PoolSnapshotItem[]
  truncated: boolean
  excluded: { used_earlier: number; expired: number; skipped: number; junk: number; short: number }
  handIds: string[]
  techmemeStories: Array<{ story: string; index: number; member_ids: string[] }>
}

export interface ScoutCard { id: string; core: string }

export interface ClusterResult {
  storyKeyOf: Record<string, string>                 // item_id → story_key (Anfuehrer-ID oder 'tm:<story>')
  clusters: Record<string, string[]>                 // story_key → member ids (Reihenfolge = Rang im Cluster)
  related: Array<[string, string, number]>           // [story_key_a, story_key_b, sim] mit 0.65 <= sim < 0.8
}

export interface ArchiveMeta {
  coverage_hits: number; followups: number; precedents: number; negatives: number
  pairs: number; panel_accept: number; panel_reject: number; approx_tokens: number; missing: string[]
}
export interface ArchiveBrief {
  systemPrefix: string                               // Betreiber-Regeln, Rollen-Soft-Range, Techmeme-Quote (gecacht)
  dayBlock: string                                   // Coverage, Praezedenzen, Negativ-Block, Paare, Panel
  precedentIds: Record<string, string>               // 'P3' → published_units.id
  meta: ArchiveMeta
}

export interface ComposeUnit {
  unit_key: string
  member_ids: string[]
  story_key: string
  role: CurationRole | null
  rank: number                                       // 1..n je Tier
  tier: CurationTier
  reason: string                                     // <= 160 Zeichen
  alternative: string | null
  precedent_ids: string[]                            // published_units.id
  is_hand: boolean
}
export interface TechmemeDecision { story: string; decision: 'keep_topic' | 'promote_cover' | 'reduce_to_best_source' | 'drop' }
export interface HandStoryDecision { story_key: string; decision: 'inherit_label' | 'story'; label: CurationRole | null }
export interface ComposePlan {
  thesis: string
  units: ComposeUnit[]
  techmeme_decisions: TechmemeDecision[]
  hand_story_decisions: HandStoryDecision[]
  fixes: string[]                                    // was validatePlan korrigiert hat
  source: 'model' | 'baseline'
}

export interface Critique { hard: string[]; soft: string[]; model_hard: string[]; model_soft: string[] }

export interface BaselineLists { total_score: Record<string, string[]> }   // '10' | '20' → IDs (capByUnits je K)

export interface RunLogEntry { at: string; text: string; ok: boolean }

export type UnitOutcome = 'kept' | 'relabeled' | 'merged' | 'dropped_after_selection' | 'dropped_never_selected' | 'added'

export interface RunMetrics {
  attribution: 'job' | 'published_at' | 'created_at_day' | 'none'
  published_units: number
  published_attributable: number                     // mit member_ids oder Embedding
  plan: { recommended: number; bench: number; held: number }
  unit_recall_20: number                             // (recommended ∪ bench) ∩ published / published, Story-Ebene
  unit_recall_id_20: number                          // strenge ID-Variante
  setzlisten_recall_10: number
  setzlisten_precision_10: number
  duplicate_rate_recommended: number
  cut_rate: number                                   // Setzlisten-Einheiten mit outcome dropped_after_selection / Setzliste
  additions: number
  additions_rate: number                             // added / published
  hand_stories: number
  held_rate: number                                  // held / hand_stories
  baseline_total_score_unit_recall_20: number | null
  baseline_total_score_recall_10: number | null
  diff_vs_total_score_20: number | null
  outcomes: Record<UnitOutcome, number>
}

export interface RunRow {
  id: string; day: string; mode: RunMode; asof: string; status: RunStatus; phase: RunPhase
  brief_mode: BriefMode; attempts: number; last_advanced_at: string | null; cancel_requested: boolean
  log: RunLogEntry[]; degraded: Degradation[]; budget_usd: number; spend_usd: number; compose_attempts: number
  pool: PoolSnapshot | null; cards: ScoutCard[] | null; story_keys: ClusterResult | null
  brief: ArchiveBrief | null; baseline: BaselineLists | null; plan: ComposePlan | null; critique: Critique | null
  reconciled_at: string | null; matched_post_id: string | null; matched_job_id: string | null; metrics: RunMetrics | null
  model_scout: string | null; model_editor: string | null; model_critic: string | null
  error_message: string | null; created_at: string; finished_at: string | null
}
/** Leichte Listenansicht ohne die schweren JSON-Spalten. */
export type RunSummary = Omit<RunRow, 'pool' | 'cards' | 'story_keys' | 'brief' | 'plan' | 'critique' | 'log'>
export const RUN_SUMMARY_COLUMNS =
  'id, day, mode, asof, status, phase, brief_mode, attempts, last_advanced_at, cancel_requested, degraded, budget_usd, spend_usd, compose_attempts, baseline, reconciled_at, matched_post_id, matched_job_id, metrics, model_scout, model_editor, model_critic, error_message, created_at, finished_at'

export interface UnitRow {
  id: string; run_id: string; unit_key: string; member_ids: string[]; story_key: string | null
  role: string | null; rank: number | null; tier: CurationTier | null; reason: string | null; alternative: string | null
  precedent_ids: string[]; is_hand: boolean; panel_action: string | null; panel_at: string | null
  outcome: UnitOutcome | null; final_role: string | null; final_rank: number | null
  matched_post_id: string | null; matched_heading: string | null; similarity: number | null; created_at: string
}
export type UnitInsert = Omit<UnitRow, 'id' | 'run_id' | 'created_at'>

export interface CurationSettings {
  shadow_enabled: boolean          // Default false — [FREIGABE] schaltet scharf
  kickoff_utc: string              // 'HH:MM', Default '04:25'
  budget_usd: number               // je Run, Default 4
  daily_budget_usd: number         // alle Runs eines Tages, Default 12
  min_content_length: number       // Default 500 (ranking-service.ts:25); UI-Slider 1000 ist nicht persistiert
  pool_window_hours: number        // Default 48
  scout_batch_size: number         // Default 25
  critic_enabled: boolean          // Default true (Sonnet-Kritiker zusaetzlich zur deterministischen Pruefung)
}
export const DEFAULT_CURATION_SETTINGS: CurationSettings = {
  shadow_enabled: false, kickoff_utc: '04:25', budget_usd: 4, daily_budget_usd: 12,
  min_content_length: 500, pool_window_hours: 48, scout_batch_size: 25, critic_enabled: true,
}
```

### 3. Verbindliche Signaturen (wörtlich so benennen)

#### 3.1 `lib/ai/call.ts` (Task 2) + `lib/ai/usage-log.ts`
```ts
import type Anthropic from '@anthropic-ai/sdk'
import type { UseCase } from '@/lib/ai/use-cases'
import type { UsageTokens } from '@/lib/ai/usage-cost'
import type { RunMode } from '@/lib/curation/types'

export interface CallToolInput<T> {
  useCase: UseCase
  system: string                 // volatiler System-Teil (Tagesblock) — NICHT gecacht
  cachedPrefix?: string          // stabiler System-Teil (Rollen, Regeln, Brief-Prefix) — cache_control ephemeral
  user: string
  tool: Anthropic.Tool           // mit input_schema; strict wird von callTool gesetzt
  maxTokens: number
  effort?: 'low' | 'medium' | 'high'
  thinking?: boolean             // Default: true, wenn das Modell adaptiveThinking kann; Haiku: false
  validate: (input: unknown) => T | null
}
export interface CallToolResult<T> { result: T; model: string; tokens: UsageTokens; costUsd: number; retried: boolean; strictDropped: boolean }
export type CallToolFn = <T>(input: CallToolInput<T>) => Promise<CallToolResult<T>>

export class CallRefusedError extends Error { constructor(useCase: string, public readonly category: string | null) }
export class CallInvalidError extends Error { }          // nach Retry kein tool_use oder validate() === null

/** Schaetzung fuer die Reservierung: Zeichen/3.5 als Input-Tokens, maxTokens als Output. Unbekanntes Modell → {input:5, output:25}. */
export function estimateUsd(model: string, inputChars: number, maxTokens: number): number

export interface AnthropicLike {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>
    stream(params: Anthropic.MessageCreateParamsNonStreaming): { finalMessage(): Promise<Anthropic.Message> }
  }
}
export interface CallerOptions {
  runId: string
  mode: RunMode
  clientFactory?: (useCase: UseCase) => AnthropicLike      // Default: withUsageLogging(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), useCase, { runId, mode })
  modelFor?: (useCase: UseCase) => Promise<string>         // Default: getModelForUseCase
  onCost?: (useCase: UseCase, costUsd: number) => void
}
export function createCaller(opts: CallerOptions): { callTool: CallToolFn; modelFor: (useCase: UseCase) => Promise<string> }
```
Verhalten von `callTool` (verbindlich): (1) `model = await modelFor(useCase)`, `caps = getModelCapabilities(model)`; (2) `thinking = input.thinking ?? caps.adaptiveThinking`; (3) Params: `system` als Block-Array `[ {text: cachedPrefix, cache_control:{type:'ephemeral'}} (falls gesetzt), {text: system} ]`, `messages: [{role:'user', content: user}]`, `tools: [{...tool, strict: true}]`, `max_tokens`; `thinking: {type:'adaptive'}` + `output_config: {effort}` nur wenn `thinking && caps.adaptiveThinking` (effort nur wenn `caps.supportsEffort`); `tool_choice: {type:'tool', name}` nur wenn `caps.supportsForcedToolChoice && !thinking`, sonst `{type:'auto'}` und ein dritter System-Block `Antworte ausschließlich über das Tool „<name>". Kein Fließtext.`; (4) `maxTokens > 16384` → `client.messages.stream(params).finalMessage()`, sonst `create`; (5) `stop_reason === 'refusal'` → `CallRefusedError`; (6) `tool_use`-Block mit `name === tool.name` suchen → `validate(block.input)`; kein Block oder `null` → genau EIN identischer Retry (`retried: true`); danach `CallInvalidError`; (7) `Anthropic.BadRequestError` mit `/strict/i` in der Message → ein Retry ohne `strict` (`strictDropped: true`); (8) Kosten `computeCostUsd(model, extractUsage(message.usage)) ?? estimateUsd(...)`, `onCost` aufrufen. Keine eigene 5xx-Retry-Schleife (SDK: 2 Retries).

`lib/ai/usage-log.ts` ergänzt (surgical): ein modulweites `const pending = new Set<Promise<void>>()`; der Fallback `void logLlmUsage(...)` (:61-67) wird zu `const p = logLlmUsage(...).finally(() => pending.delete(p)); pending.add(p)`; neu `export async function flushUsageLog(): Promise<void> { await Promise.allSettled([...pending]) }`.

#### 3.2 `lib/curation/service.ts` (Task 3)
```ts
export const LEASE_STALE_MS = 900_000                // > maxDuration 800 s
export const MAX_ATTEMPTS = 10
export function stamp(): string                      // 'DD.MM. HH:MM:SS' Europe/Berlin (wie lib/glossary/jobs/advance.ts:42)
export async function createRun(supabase: SupabaseAdmin, input: {
  day: string; mode: RunMode; asof: string; brief_mode: BriefMode; budget_usd: number
  models: { scout: string; editor: string; critic: string }
}): Promise<RunRow>                                   // 23505 (offener Run existiert) → diesen liefern
export async function getRun(supabase: SupabaseAdmin, id: string): Promise<RunRow | null>
export async function getNextOpenRun(supabase: SupabaseAdmin, now: number = Date.now()): Promise<RunRow | null>
  // status in (pending, processing), (last_advanced_at is null or < now − LEASE_STALE_MS), order created_at asc, limit 1, mode = 'shadow'
export async function claimRun(supabase: SupabaseAdmin, id: string, attempts: number): Promise<void>
  // update { status:'processing', last_advanced_at: now, attempts }
export async function releaseLease(supabase: SupabaseAdmin, id: string): Promise<void>   // last_advanced_at: null
export async function saveRunState(supabase: SupabaseAdmin, id: string, patch: Partial<RunRow>): Promise<void>
  // update patch + last_advanced_at: now; wirft Error('curation_runs: …')
export async function appendRunLog(supabase: SupabaseAdmin, run: RunRow, entries: RunLogEntry[]): Promise<void>
  // run.log = [...run.log, ...entries]; update { log, last_advanced_at }; mutiert run.log
export async function finishRun(supabase: SupabaseAdmin, id: string, status: 'done' | 'error' | 'cancelled', errorMessage?: string): Promise<void>
  // update { status, finished_at: now, phase: status==='done' ? 'finished' : undefined, error_message, last_advanced_at: null }
export async function insertUnits(supabase: SupabaseAdmin, runId: string, units: UnitInsert[]): Promise<void>
  // delete().eq('run_id') dann insert in Scheiben à 200 (idempotent je Run)
export async function listRuns(supabase: SupabaseAdmin, opts: { limit: number; mode?: RunMode }): Promise<RunSummary[]>
  // select(RUN_SUMMARY_COLUMNS).order('day', desc).order('created_at', desc).limit
export async function getRunUnits(supabase: SupabaseAdmin, runId: string): Promise<UnitRow[]>   // order tier, rank
export async function getRunsToReconcile(supabase: SupabaseAdmin, nowIso: string, limit = 1): Promise<RunRow[]>
  // mode shadow, status done, reconciled_at null, asof <= now − 10 min, order asof asc
export async function markReconciled(supabase: SupabaseAdmin, id: string,
  patch: { matched_post_id: string | null; matched_job_id: string | null; metrics: RunMetrics }): Promise<void>  // + reconciled_at: now
export async function updateUnitOutcomes(supabase: SupabaseAdmin, runId: string,
  outcomes: Array<Pick<UnitRow, 'unit_key' | 'outcome' | 'final_role' | 'final_rank' | 'matched_post_id' | 'matched_heading' | 'similarity'>>,
  added: UnitInsert[]): Promise<void>                 // je outcome ein update .eq('run_id').eq('unit_key'); added per insert
export async function spentTodayUsd(supabase: SupabaseAdmin, day: string): Promise<number>   // sum(spend_usd) where day, mode shadow
export async function loadCurationSettings(supabase: SupabaseAdmin): Promise<CurationSettings>  // {...DEFAULT, ...value}, Fehler → Default
export function kickoffAsOf(nowIso: string, kickoffUtc: string): string | null
  // ISO `${nowIso.slice(0,10)}T${HH}:${MM}:00.000Z`; null wenn now < kickoff oder kickoffUtc ungueltig
export function parseRunRow(raw: Record<string, unknown>): RunRow   // numeric-Strings → Number (budget_usd, spend_usd), json-Spalten durchreichen
```

#### 3.3 `lib/curation/pool.ts` (Task 4)
```ts
export interface PoolOptions { asOf: string; minContentLength: number; windowHours: number }
export interface PoolRawRow {
  id: string; title: string; source_identifier: string; source_display_name: string | null
  total_score: number | string | null; bundle_type: string | null; metadata: Record<string, unknown> | null
  content_length: number | null; daily_repo_id: string | null; queued_at: string; expires_at: string | null
  used_in_post_id: string | null; status: string; selected_at: string | null; source_pub_rate: number | string | null
}
export const POOL_SELECT = 'id, title, source_identifier, source_display_name, total_score, bundle_type, metadata, content_length, daily_repo_id, queued_at, expires_at, used_in_post_id, status, selected_at, source_pub_rate'
export function isLiveAsOf(asOf: string, now: number = Date.now()): boolean    // |now − asOf| < 15 min
/** Reine as-of-Filterung: used_earlier/expired ueber poolExclusionAsOf; skipped nur live; Techmeme-Items und Hand-Kandidaten (selected_at <= asOf) ueberstehen Junk- und Laengenfilter. */
export function filterPoolAsOf(rows: PoolRawRow[], asOf: string, postTimeById: Map<string, string>,
  opts: { minContentLength: number; live: boolean }): { kept: PoolRawRow[]; excluded: PoolSnapshot['excluded'] }
export function techmemeStoriesOf(items: PoolSnapshotItem[]): PoolSnapshot['techmemeStories']   // gruppiert nach techmeme_story, index = min story_index, member_ids nach total_score desc
export function toSnapshotItem(row: PoolRawRow, excerpt: string, hand: boolean): PoolSnapshotItem
export async function loadPoolAsOf(supabase: SupabaseAdmin, opts: PoolOptions): Promise<PoolSnapshot>
  // 1 Zeilen: poolWindow-Fenster, .order('id').range() à 1000 bis 2000 (truncated = raw.length >= 2000)
  // 2 loadPostPublishTimes fuer used_in_post_id; filterPoolAsOf
  // 3 Excerpts: supabase.rpc('get_pool_excerpts', { ids: chunk, max_chars: 1500 }) à 200
  // 4 Hand: Kandidaten = kept mit selected_at && selected_at <= asOf (live zusaetzlich status==='selected'); loadEventsForItems; isHandItem(item, eventsAsOf(events, asOf))
  // 5 handIds, techmemeStoriesOf, excluded
export async function loadPoolEmbeddings(supabase: SupabaseAdmin, items: PoolSnapshotItem[], embed: EmbedTexts):
  Promise<{ embeddings: Map<string, number[]>; generated: number; failed: number }>
  // (a) loadRepoEmbeddings fuer daily_repo_id; (b) curation_item_embeddings fuer den Rest (.in à 200); (c) on-the-fly fuer den Rest:
  //     prepareTextForEmbedding(title, excerpt) in Batches à 16 ueber embed; Guard createEmbedFailGuard (3 in Folge → throw Error('embeddings: …'));
  //     upsert in curation_item_embeddings (onConflict item_id) als pgvector-String `[${v.join(',')}]`
```

#### 3.4 `lib/curation/cluster.ts` (Task 5)
```ts
export function clusterPool(snapshot: PoolSnapshot, embeddings: Map<string, number[]>, threshold: number = DEFAULT_DEDUP_THRESHOLD): ClusterResult
  // Reihenfolge der Anfuehrer-Kandidaten: Hand-Items (total_score desc) → Techmeme-Story-Anfuehrer (je Story das Item mit hoechstem total_score; Key 'tm:<story>') → Rest (total_score desc).
  // clusterByEmbedding(items, embeddings, threshold) ueber diese Liste; Items ohne Embedding = eigener Cluster (Key = eigene ID).
  // story_key = ID des Anfuehrers, fuer Techmeme-Stories 'tm:<story>'; alle Mitglieder einer Techmeme-Story bekommen den Key des Anfuehrers OHNE Embedding-Vergleich.
  // related: Paare von Anfuehrern mit 0.65 <= sim < threshold, absteigend, max 40.
export function handStoriesOf(snapshot: PoolSnapshot, cluster: ClusterResult): Record<string, string[]>   // story_key → alle Member (Stories mit >= 1 Hand-Item)
export function leaderOf(cluster: ClusterResult, storyKey: string): string                                 // clusters[key][0]
```

#### 3.5 `lib/curation/scout.ts` (Task 6)
```ts
export const SCOUT_TOOL: Anthropic.Tool    // name 'report_cards', input {cards: [{id, core}]}, strict-faehig (additionalProperties:false, required)
export const SCOUT_SYSTEM: string          // Rolle, Kernsatz <= 25 Woerter, deutsch, keine Bewertung, IDs unveraendert
export function buildScoutUser(items: PoolSnapshotItem[]): string   // je Item: `[<id>] <title> — <source> — <excerpt>`
export function parseScoutOutput(raw: unknown, batchIds: Set<string>): Map<string, string> | null   // Zod; IDs ausserhalb des Batches ignorieren; < 50 % der Batch-IDs → null
export function fallbackCard(item: PoolSnapshotItem): ScoutCard   // core = title
export async function scoutBatch(callTool: CallToolFn, items: PoolSnapshotItem[]): Promise<{ cards: ScoutCard[]; missing: string[]; costUsd: number }>
  // callTool({ useCase:'curation_scout', system: SCOUT_SYSTEM, user, tool: SCOUT_TOOL, maxTokens: 4096, thinking: false, validate: raw => parseScoutOutput(raw, ids) })
  // CallInvalidError → alle Items missing (kein zweiter eigener Retry: callTool hat schon einmal wiederholt)
export async function loadCachedCards(supabase: SupabaseAdmin, ids: string[], model: string): Promise<Map<string, string>>   // curation_cards .in à 200
export async function saveCards(supabase: SupabaseAdmin, cards: ScoutCard[], model: string): Promise<void>              // upsert onConflict 'item_id,model'
export function batchesOf<T>(items: T[], size: number): T[][]
```

#### 3.6 `lib/curation/archive.ts` (Task 7)
```ts
export interface ArchiveCandidate { id: string; title: string; embedding: number[] }
export interface ArchiveInput { asOf: string; candidates: ArchiveCandidate[]; briefMode: BriefMode; mode: RunMode }
export interface CoverageUnit { id: string; post_id: string; heading: string; published_at: string; embedding: number[] }
export interface PrecedentHit { unit_id: string; post_id: string; heading: string; bundle_type: string | null; published_at: string; similarity: number; candidate_index: number }
export interface CorrectionPair { outcome: UnitOutcome; title: string; role: string | null; final_role: string | null; day: string; heading: string | null }
export interface PanelItem { id: string; title: string; role: string | null; at: string }

export function roleSoftRange(rolesByPost: Array<Array<string | null>>): Record<string, { min: number; median: number; max: number }>
export function coverageHits(candidates: ArchiveCandidate[], coverage: CoverageUnit[]):
  { ran: Array<{ candidate_id: string; heading: string; published_at: string; sim: number }>; followups: Array<{ candidate_id: string; heading: string; published_at: string; sim: number }> }
  // ran: sim >= 0.8; followups: 0.6 <= sim < 0.8; je Kandidat nur der beste Treffer
export function techmemeAdoptionOf(rows: Array<{ story_index: number; status: string }>): Array<{ index: number; stories: number; used: number; rate: number }>
export function formatBrief(parts: {
  rules: string; softRange: Record<string, { min: number; median: number; max: number }>; adoption: ReturnType<typeof techmemeAdoptionOf>
  coverage: ReturnType<typeof coverageHits>; precedents: PrecedentHit[]; negativeText: string; pairs: CorrectionPair[]
  panel: { accepted: PanelItem[]; rejected: PanelItem[] }; candidateTitles: Map<string, string>
}): { systemPrefix: string; dayBlock: string; precedentIds: Record<string, string> }
  // Praezedenzen als `[P<n>] <heading> (<rolle>, <datum>) ~ <kandidat-titel>`; Paare gekappt: alle added + alle relabeled + <= 10 dropped_after_selection + <= 20 dropped_never_selected, Hartgrenze 60; Panel <= 5 je Rolle und Seite
export async function loadCoverageAsOf(supabase: SupabaseAdmin, from: string, to: string): Promise<CoverageUnit[]>   // published_units published_at in [from, to), embedding not null, Seiten à 200
export async function loadPrecedentUnits(supabase: SupabaseAdmin, candidateEmbeddings: number[][], before: string, perRole = 8): Promise<PrecedentHit[]>   // rpc get_precedent_units, Embeddings als pgvector-Strings
export async function loadRoleSoftRange(supabase: SupabaseAdmin, asOf: string, days = 30): Promise<ReturnType<typeof roleSoftRange>>   // published_units.bundle_type je post_id
export async function loadCorrectionPairs(supabase: SupabaseAdmin, asOf: string, mode: RunMode, days = 14): Promise<CorrectionPair[]>
  // curation_runs (mode, reconciled_at not null, asof in [asOf − days, asOf)) → curation_units mit outcome not null; Titel = erster Member-Titel aus run.pool
export async function loadPanelFeedback(supabase: SupabaseAdmin, asOf: string, days = 30): Promise<{ accepted: PanelItem[]; rejected: PanelItem[] }>
  // queue_item_events event in ('panel_accept','panel_reject'), at in [asOf − days, asOf); Titel/Rolle aus news_queue (geloeschte ueberspringen)
export async function loadOperatorRules(supabase: SupabaseAdmin): Promise<string>   // settings.curation_operator_rules.value.text ?? ''
export async function loadTechmemeAdoption(supabase: SupabaseAdmin, asOf: string, days = 30): Promise<ReturnType<typeof techmemeAdoptionOf>>
  // news_queue queued_at in Fenster, metadata->>techmeme = 'true', select status, metadata; story_index aus metadata
export async function buildArchiveBrief(supabase: SupabaseAdmin, input: ArchiveInput): Promise<ArchiveBrief>
  // briefMode 'none' → leerer Brief (nur Regeln + Soft-Range im Prefix); 'precedents-only' → ohne Korrektur-Paare und ohne Panel; 'full' → alles.
  // Jede Quelle einzeln try/catch: Fehler → meta.missing.push('<quelle>'), Rest laeuft weiter (Spec Fehlerpfad „Archivar: RPC fehlt/wirft → Compose ohne Archivbrief, degraded").
```

#### 3.7 `lib/curation/compose.ts` (Task 8)
```ts
export const COMPOSE_TOOL: Anthropic.Tool          // name 'compose_day' — Schema in 4.2
export const COMPOSE_SYSTEM: string                // Rollen-Definition, harte und weiche Regeln, Tiers, Output-Vorschrift (4.3)
export interface ComposeInput {
  cards: ScoutCard[]; snapshot: PoolSnapshot; cluster: ClusterResult; brief: ArchiveBrief | null
  seed: number; revisionHints?: string[]; previousPlan?: ComposePlan
}
export function buildComposeMessages(input: ComposeInput): { cachedPrefix: string; system: string; user: string }
  // cachedPrefix = COMPOSE_SYSTEM + brief.systemPrefix; system = brief.dayBlock (oder Hinweis „kein Archivbrief"); user = Hand-Stories, Techmeme-Stories, related-Paare, dann Cards in seededShuffle-Reihenfolge (mulberry32(seed)), je Card `[<id>] s=<story_key> q=<source> t=<total_score> <hand?> — <title> — <core>`; bei Revision: previousPlan als JSON + Hinweise.
export interface RawComposePlan { thesis: string; units: Array<{ member_ids: string[]; role: string; rank: number; tier: string; reason: string; alternative: string; precedent_ids: string[] }>; techmeme_decisions: Array<{ story: string; decision: string }>; hand_story_decisions: Array<{ story_key: string; decision: string; label: string }> }
export function parseComposeOutput(raw: unknown): RawComposePlan | null     // Zod safeParse
export function unitKeyFor(role: CurationRole | null, storyKey: string): string   // `${role ?? 'single'}::${storyKey}`
export function validatePlan(raw: RawComposePlan, snapshot: PoolSnapshot, cluster: ClusterResult, precedentIds: Record<string, string>): ComposePlan
  // unbekannte IDs raus, dedupe, Einheit ohne Member faellt weg (fixes), > 5 Member → auf die 5 mit hoechstem total_score kappen (fixes),
  // role 'none' → null, tier ungueltig → 'bench' (fixes), story_key = storyKeyOf[erster Member], unit_key = unitKeyFor; doppelter unit_key → zweite Einheit wird 'bench' mit Suffix '#2' (Kritiker meldet story_duplicate),
  // is_hand = ein Member in snapshot.handIds, precedent_ids 'P<n>' → uuid (unbekannte raus), rank je Tier neu 1..n in gegebener Reihenfolge, reason auf 160 Zeichen kappen, alternative '' → null, label 'none' → null
export function baselinePlan(snapshot: PoolSnapshot, cluster: ClusterResult, baseline: BaselineLists): ComposePlan
  // aus baseline.total_score['20']: Einheiten per unitKeyOf-Gruppierung in Listenreihenfolge; Rang 1–10 recommended, 11–20 bench; Hand-Stories ohne Platz → held; source 'baseline', thesis ''
export async function composeDay(callTool: CallToolFn, input: ComposeInput, precedentIds: Record<string, string>): Promise<{ plan: ComposePlan; costUsd: number; model: string }>
  // callTool({ useCase:'curation_editor', cachedPrefix, system, user, tool: COMPOSE_TOOL, maxTokens: 24000, effort: 'medium', validate: parseComposeOutput }) → validatePlan
```

#### 3.8 `lib/curation/critic.ts` (Task 9)
```ts
export const HARD = { setzliste_min: 9, setzliste_max: 11, total_max: 20, sources_max: 5, source_share_max: 0.3, cover_max: 1, held_soft_max: 5, techmeme_topics_soft_max: 2 } as const
export function checkHardRules(plan: ComposePlan, snapshot: PoolSnapshot, cluster: ClusterResult, embeddings: Map<string, number[]>): string[]
  // Codes: 'setzliste_size:<n>', 'total_size:<n>', 'cover_count:<n>', 'sources_max:<unit_key>', 'source_share:<source>:<share>',
  //        'story_duplicate:<a>|<b>' (gleicher story_key ODER cosine(leader_a, leader_b) >= 0.8), 'unknown_id:<id>', 'hand_missing:<story_key>', 'hand_split:<story_key>' (Hand-Story auf > 1 Einheit), 'held_not_hand:<unit_key>'
export function checkSoftRules(plan: ComposePlan, snapshot: PoolSnapshot, cluster: ClusterResult): string[]
  // 'held_many:<n>' (> 5), 'label_conflict:<story_key>', 'techmeme_topics:<n>' (> 2 Techmeme-Stories als topic/cover_story)
export const CRITIC_TOOL: Anthropic.Tool   // name 'report_critique', input {hard: string[], soft: string[]}
export async function critiqueWithModel(callTool: CallToolFn, plan: ComposePlan, snapshot: PoolSnapshot, cluster: ClusterResult, brief: ArchiveBrief | null): Promise<{ hard: string[]; soft: string[]; costUsd: number }>
  // useCase 'curation_critic', maxTokens 4096, effort 'low'; Eingabe: Plan als JSON + ID+Titel-Liste des Snapshots + Hard-Regel-Text; Fehler → throw (Aufrufer degradiert)
export function revisionHints(hard: string[]): string[]   // menschenlesbare Anweisungen je Code, deutsch
```

#### 3.9 `lib/curation/run.ts` (Task 10)
```ts
export interface RunDeps {
  supabase: SupabaseAdmin; callTool: CallToolFn; embed: EmbedTexts; settings: CurationSettings
  models: { scout: string; editor: string; critic: string }
  now?: () => number; budgetMs?: number; log?: (text: string) => void
}
export const TICK_BUDGET_MS = 600_000
export const COMPOSE_MIN_REMAINING_MS = 420_000
export const POOL_MIN_ITEMS = 40
export function reserveBudget(run: RunRow, usd: number): boolean          // run.spend_usd + usd <= run.budget_usd
export function unitsFromPlan(plan: ComposePlan): UnitInsert[]
export async function phasePool(deps: RunDeps, run: RunRow): Promise<Partial<RunRow>>      // → { pool, baseline, phase:'scout' } | wirft Error('pool_small:<n>')
export async function phaseScout(deps: RunDeps, run: RunRow): Promise<Partial<RunRow>>     // Cache → Batches (parallel 4) → saveCards; missing → fallbackCard + degraded 'scout_partial' wenn > 10 %; → { cards, spend_usd, phase:'cluster' }
export async function phaseCluster(deps: RunDeps, run: RunRow): Promise<Partial<RunRow>>   // loadPoolEmbeddings + clusterPool; failed > 0 → degraded 'pool_embeddings'; → { story_keys, phase:'archive' }
export async function phaseArchive(deps: RunDeps, run: RunRow): Promise<Partial<RunRow>>   // buildArchiveBrief mit Kandidaten = Anfuehrer der Top-80 (total_score) ∪ Hand ∪ Techmeme-Anfuehrer; meta.missing.length > 0 → degraded 'archive'; → { brief, phase:'compose' }
export async function phaseCompose(deps: RunDeps, run: RunRow): Promise<Partial<RunRow>>
  // Schleife: compose_attempts < 2: reserveBudget(estimate) sonst Baseline-Plan + 'budget'; composeDay; checkHardRules + checkSoftRules; critic (settings.critic_enabled && reserveBudget) sonst 'critic';
  // hard leer → fertig; sonst revisionHints → naechster Versuch (compose_attempts VOR dem Call persistieren); nach 2 Versuchen mit hard → baselinePlan + 'compose_fallback'
  // → { plan, critique, spend_usd, compose_attempts, degraded, phase:'units' }
export async function phaseUnits(deps: RunDeps, run: RunRow): Promise<Partial<RunRow>>     // insertUnits(unitsFromPlan) → { phase:'finished' }
export async function advanceRun(deps: RunDeps, run: RunRow): Promise<{ phase: RunPhase; finished: boolean; note: string }>
  // arbeitet Phasen ab, bis budgetMs erschoepft; vor 'compose' pruefen: verbleibend >= COMPOSE_MIN_REMAINING_MS, sonst Tick beenden (finished:false);
  // nach jeder Phase saveRunState(patch) + appendRunLog; phase 'finished' → finishRun('done'), finished:true; Error → finishRun('error', message) wenn message mit 'pool_small' beginnt, sonst werfen (Route zaehlt attempts)
export async function runDayInline(deps: RunDeps, run: RunRow): Promise<RunRow>   // advanceRun in Schleife mit budgetMs = Infinity bis finished; liefert getRun
```

#### 3.10 `lib/curation/reconcile.ts` (Task 11)
```ts
export interface MatchJob { id: string; created_at: string; generated_post_id: string | null; selected_items: unknown; source: string }
export interface MatchPost { id: string; status: string; created_at: string; published_at: string | null }
export interface MatchCandidates { jobs: MatchJob[]; posts: MatchPost[] }
export interface MatchResult { post_id: string; job_id: string | null; attribution: 'job' | 'published_at' | 'created_at_day' }
export function pickMatchingPost(asOf: string, c: MatchCandidates): MatchResult | null
  // (1) juengster Job source='manual' mit created_at in [asOf − 2 h, asOf + 24 h] und Post status published → 'job'
  // (2) fruehester Post published mit published_at in (asOf, asOf + 24 h] → 'published_at'
  // (3) Post published mit berlinDay(created_at) === berlinDay(asOf) → 'created_at_day'; sonst null
export async function loadMatchCandidates(supabase: SupabaseAdmin, asOf: string): Promise<MatchCandidates>
  // article_jobs: created_at in [asOf − 2 h, asOf + 24 h], select id, created_at, generated_post_id, source (selected_items separat fuer den Treffer); generated_posts: status published, created_at in [asOf − 36 h, asOf + 36 h] OR published_at in (asOf, asOf + 24 h]
export interface PublishedUnitRow { id: string; position: number; heading: string; bundle_type: string | null; member_ids: string[]; embedding: number[] | null }
export interface OutcomePatch { unit_key: string; outcome: UnitOutcome; final_role: string | null; final_rank: number | null; matched_post_id: string | null; matched_heading: string | null; similarity: number | null }
export function reconcileOutcomes(units: UnitRow[], published: PublishedUnitRow[], itemEmbeddings: Map<string, number[]>, selectedIds: Set<string>, postId: string, threshold = 0.8):
  { outcomes: OutcomePatch[]; added: PublishedUnitRow[]; matched: Map<string, string> }   // matched: unit_key → published unit id
  // Greedy: erst ID-Treffer (member ∩ member_ids) in Rangfolge recommended → bench → held, dann Similarity max over members (cosineSimilarity(itemEmb, unit.embedding)) >= threshold;
  // kept (Treffer, role === bundle_type), relabeled (Treffer, Rolle anders), merged (nur Similarity-Treffer ohne ID-Treffer), dropped_after_selection (kein Treffer, ein Member in selectedIds), dropped_never_selected (sonst); final_rank = position + 1; added = published ohne Treffer
export function metricsOf(input: { units: UnitRow[]; outcomes: OutcomePatch[]; published: PublishedUnitRow[]; added: PublishedUnitRow[]; baseline: BaselineLists | null; snapshot: PoolSnapshot; cluster: ClusterResult; itemEmbeddings: Map<string, number[]>; attribution: RunMetrics['attribution'] }): RunMetrics
  // Story-Ebene: storyOf = assignStoryKeys(alle IDs aus Plan ∪ published ∪ baseline, itemEmbeddings, 0.8); unitRecallAtK ueber unitListsByK(ids, unitOf, [10,20]) der Plan-Listen (recommended-Reihenfolge, dann bench); precisionAtK fuer Setzliste; unitDuplicateRate; cut_rate; additions; held_rate; Baseline aus baseline.total_score ueber unitCappedMetricsOf
export async function reconcileRun(supabase: SupabaseAdmin, run: RunRow, embed: EmbedTexts): Promise<{ matched: MatchResult | null; metrics: RunMetrics }>
  // loadMatchCandidates → pickMatchingPost; null → metrics { attribution:'none', … Nullwerte }, markReconciled(matched_post_id null) — KEINE Outcomes
  // sonst: post laden (id, content, published_at) → processPost(supabase, embed, post, false) → published_units des Posts mit Embedding lesen → selected_items des Jobs (precedentSelectedItems) → Item-Embeddings (loadPoolEmbeddings ueber snapshot.items ∪ published member) → reconcileOutcomes → updateUnitOutcomes → metricsOf → markReconciled
export interface AggregateReport {
  n: number; mean: Record<'unit_recall_20' | 'setzlisten_recall_10' | 'setzlisten_precision_10' | 'duplicate_rate_recommended' | 'cut_rate' | 'additions_rate' | 'held_rate' | 'baseline_total_score_unit_recall_20', number>
  diff_vs_total_score_20: { n: number; mean: number; bootstrap_90: { mean: number; lo90: number; hi90: number } }
  gate: { recall_gain: boolean | null; floor: boolean; duplicates_zero: boolean; precision_vs_hand: boolean | null }
}
export function aggregateRuns(metricsList: RunMetrics[], handPrecisionRef: number | null): AggregateReport
  // nur attribution !== 'none'; recall_gain = mean diff >= 0.10 && lo90 > 0 (null bei n < 5); floor = unit_recall_20 >= 0.5 && setzlisten_recall_10 >= 0.35; precision_vs_hand null ohne Referenz
```

### 4. Tool-Schemas und Prompts (verbindlich)

#### 4.1 Scout — `SCOUT_TOOL`
```ts
export const SCOUT_TOOL: Anthropic.Tool = {
  name: 'report_cards',
  description: 'Liefert je Meldung einen Kernsatz (max. 25 Woerter) fuer die Redaktionskonferenz.',
  input_schema: {
    type: 'object' as const, additionalProperties: false, required: ['cards'],
    properties: { cards: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'core'],
      properties: { id: { type: 'string' }, core: { type: 'string' } } } } },
  },
}
export const SCOUT_SYSTEM = `Du bist der Scout einer deutschen Tech-Redaktion (Newsletter ueber KI, Agenten, Software). Du bekommst Meldungen mit ID, Titel, Quelle und Auszug. Schreibe je Meldung EINEN Kernsatz auf Deutsch mit hoechstens 25 Woertern: Was ist passiert, wer, welche Zahl oder welches Produkt. Keine Bewertung, keine Empfehlung, keine Wiederholung des Titels. Gib die IDs unveraendert zurueck. Antworte ausschliesslich ueber das Tool report_cards.`
```

#### 4.2 Chefredaktion — `COMPOSE_TOOL`
```ts
const ROLE_ENUM = ['topic', 'recap', 'deep_dive', 'cover_story', 'none']
export const COMPOSE_TOOL: Anthropic.Tool = {
  name: 'compose_day',
  description: 'Setzliste (recommended), Bank (bench) und Zurueckgestelltes (held) des Tages mit Rang, Rolle und Begruendung.',
  input_schema: {
    type: 'object' as const, additionalProperties: false,
    required: ['thesis', 'units', 'techmeme_decisions', 'hand_story_decisions'],
    properties: {
      thesis: { type: 'string', description: 'Tages-These in einem Satz' },
      units: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['member_ids', 'role', 'rank', 'tier', 'reason', 'alternative', 'precedent_ids'],
        properties: {
          member_ids: { type: 'array', items: { type: 'string' }, description: 'IDs der Quellen (1 bis 5), beste zuerst' },
          role: { type: 'string', enum: ROLE_ENUM },
          rank: { type: 'integer' },
          tier: { type: 'string', enum: ['recommended', 'bench', 'held'] },
          reason: { type: 'string', description: 'max. 160 Zeichen' },
          alternative: { type: 'string', description: 'andere Rolle oder andere Quelle; leer wenn keine' },
          precedent_ids: { type: 'array', items: { type: 'string' }, description: 'P-Nummern aus dem Archivbrief' },
        } } },
      techmeme_decisions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['story', 'decision'],
        properties: { story: { type: 'string' }, decision: { type: 'string', enum: ['keep_topic', 'promote_cover', 'reduce_to_best_source', 'drop'] } } } },
      hand_story_decisions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['story_key', 'decision', 'label'],
        properties: { story_key: { type: 'string' }, decision: { type: 'string', enum: ['inherit_label', 'story'] }, label: { type: 'string', enum: ROLE_ENUM } } } },
    },
  },
}
```

#### 4.3 `COMPOSE_SYSTEM` (wörtlich; Anhang des Betreiber-Prefix folgt dahinter)
```
Du bist die Chefredaktion der Morgenkonferenz eines deutschen Tech-Newsletters (KI, Agenten, Software, Maerkte). Du bekommst die Story-Cards des Tages in zufaelliger Reihenfolge, die Handauswahl des Betreibers, die Techmeme-Stories, aehnliche Story-Paare und einen Archivbrief.

Aufgabe: Stelle den Tagespost zusammen.
- recommended (Setzliste): 9 bis 11 Einheiten in Rangfolge — das, was oben steht, soll den Final Cut ueberleben.
- bench (Bank): Ersatzkandidaten, zusammen mit der Setzliste hoechstens 20 Einheiten.
- held: NUR Hand-Einheiten, fuer die in Setzliste und Bank kein Platz ist.
Eine Einheit ist eine Story mit 1 bis 5 Quellen (member_ids, beste Quelle zuerst) und einer Rolle: topic (Leitmeldung des Tages), cover_story (hoechstens eine; die eine grosse Geschichte), deep_dive (Hintergrund), recap (Nachlese zu etwas, das schon lief), none (normale Meldung).

Harte Regeln (werden maschinell geprueft, Verstoss = Revision):
1. Setzliste 9 bis 11 Einheiten; Setzliste + Bank hoechstens 20.
2. Hoechstens eine cover_story.
3. Hoechstens 5 Quellen je Einheit; hoechstens 30 % der Setzliste aus derselben Quelle.
4. Keine zwei Einheiten zur selben Story (gleicher s=Schluessel oder inhaltlich gleich).
5. Nur IDs aus den Cards.
6. Jede Hand-Story (Cards mit HAND) ist genau EINER Einheit zugeordnet (recommended, bench oder held) — nie weggelassen, nie auf mehrere Einheiten verteilt. Mehrere Hand-Quellen derselben Story bilden eine Einheit.
7. held enthaelt nur Hand-Einheiten.

Weiche Regeln: Rollen in den Spannen des Archivbriefs; nicht mehr als zwei Techmeme-Stories als topic oder cover_story behalten (Uebernahmequote im Brief); held ueber 5 heisst „der Betreiber hat mehr gewaehlt, als der Post traegt" — dann trotzdem einhalten und in reason begruenden.

Archivbrief: „schon gelaufen" (>= 0,8) nicht wiederholen, ausser als recap mit neuem Anlass; Nachlese-Kandidaten (0,6–0,8) sind recap-Material; Praezedenz-Einheiten [P<n>] zeigen, was der Betreiber in dieser Rolle veroeffentlicht hat — nenne passende P-Nummern in precedent_ids; „Gewaehlt, aber gestrichen" hat der Betreiber selbst gewaehlt und dann verworfen — sie zeigen die Grenze seines Interesses genauer als nie Gewaehltes; Zugaben des Betreibers (added) sind die wichtigsten Beispiele, pruefe jede Card gegen sie.

Techmeme-Stories: je Story eine Entscheidung (keep_topic, promote_cover, reduce_to_best_source, drop). Hand-Stories mit mehreren Quellen: inherit_label (ein Label fuer alle) oder story (ein Abschnitt aus allen Quellen ohne Label).

reason: hoechstens 160 Zeichen, konkret (warum diese Story, warum dieser Rang). thesis: ein Satz, was der Tag erzaehlt. Antworte ausschliesslich ueber das Tool compose_day.
```

#### 4.4 Kritiker — `CRITIC_TOOL`
```ts
export const CRITIC_TOOL: Anthropic.Tool = {
  name: 'report_critique',
  description: 'Harte Verstoesse (muessen behoben werden) und weiche Hinweise zum Tagesplan.',
  input_schema: { type: 'object' as const, additionalProperties: false, required: ['hard', 'soft'],
    properties: { hard: { type: 'array', items: { type: 'string' } }, soft: { type: 'array', items: { type: 'string' } } } },
}
```
System: „Du bist der Kritiker der Morgenkonferenz. Pruefe den Plan gegen die harten Regeln (Liste folgt) und gegen den Snapshot (ID → Titel). Melde als hard nur klare Verstoesse mit Einheit und Grund; als soft Dubletten-Verdacht, falsche Rollen, Quellenhaeufung, zu alte Meldungen. Antworte ausschliesslich ueber das Tool report_critique." Danach der Hard-Regel-Text aus 4.3 (Punkte 1–7).

### 5. Task-Reihenfolge und Abhängigkeiten

| Task | Braucht | Liefert |
|---|---|---|
| 1 Migration + types.ts | — | Schema, Typen (alle Tasks importieren `@/lib/curation/types`) |
| 2 call.ts + Use Cases | 1 (RunMode) | `CallToolFn`, `createCaller`, `flushUsageLog` |
| 3 service.ts | 1 | Run-/Unit-Helfer, Settings, `kickoffAsOf` |
| 4 pool.ts | 1 | `loadPoolAsOf`, `loadPoolEmbeddings` |
| 5 cluster.ts | 1, 4 (Typen) | `clusterPool`, `handStoriesOf` |
| 6 scout.ts | 1, 2 | `scoutBatch`, Card-Cache |
| 7 archive.ts | 1 | `buildArchiveBrief` |
| 8 compose.ts | 1, 2, 5 | `composeDay`, `validatePlan`, `baselinePlan` |
| 9 critic.ts | 1, 2, 8 | `checkHardRules`, `checkSoftRules`, `critiqueWithModel` |
| 10 run.ts | 3–9 | `advanceRun`, `runDayInline` |
| 11 reconcile.ts | 3, 4, 5 | `reconcileRun`, `aggregateRuns` |
| 12 Cron-Route + vercel.json | 2, 3, 10, 11 | Shadow-Betrieb |
| 13 Admin-API + Seite + Nav | 3 | Sichtbarkeit |
| 14 Scripts + package.json | 2, 3, 10, 11 | Backtest, Einzellauf, Nach-Rekonziliation |
| 15 Doku + Spec-Änderungsprotokoll + Runbook | alle | CLAUDE.md, Spec v4.1, [FREIGABE]-Liste |

Tasks 4, 5, 6, 7 sind untereinander unabhängig (nach 1–3); 8 und 9 nach 5; 10 nach 9; 11 parallel zu 10; 12–14 nach 10/11.

### 6. Nachträge aus den Tasks

(leer — wird während der Umsetzung gefüllt)

---

### Task 1: Migration Phase 1 + `lib/curation/types.ts`

**Files:**
- Create: `supabase/migrations/20261014090000_curation_phase1.sql` (Inhalt: Anhang A §1, wörtlich)
- Create: `lib/curation/types.ts` (Inhalt: Anhang A §2, wörtlich)
- Test: `tests/lib/curation-types.test.ts`

**Interfaces:**
- Consumes: `CurationTier` aus `lib/utils/markdown-to-tiptap.ts:10`.
- Produces: alle Typen aus §2; Tabellen und RPCs aus §1. Jeder spätere Task importiert `@/lib/curation/types`.

- [ ] **Step 1: Migrationsdatei anlegen** — `supabase/migrations/20261014090000_curation_phase1.sql` mit dem vollständigen SQL aus Anhang A §1.

- [ ] **Step 2: Idempotenz statisch prüfen**

```bash
cd /Users/mattes/dev/synthszr && F=supabase/migrations/20261014090000_curation_phase1.sql && grep -cE "create table if not exists|create (unique )?index if not exists|create or replace function" $F && grep -cE "^create table |^create index |^create unique index " $F
```
Erwartet: `11` (4 Tabellen + 5 Indizes + 2 Funktionen), dann `0`.

- [ ] **Step 3: `lib/curation/types.ts` anlegen** — wörtlich aus Anhang A §2.

- [ ] **Step 4: Failing Test schreiben** — `tests/lib/curation-types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CURATION_ROLES, DEFAULT_CURATION_SETTINGS, RUN_SUMMARY_COLUMNS } from '@/lib/curation/types'

describe('curation types', () => {
  it('kennt genau die vier redaktionellen Rollen (story kommt erst in Phase 2)', () => {
    expect([...CURATION_ROLES]).toEqual(['topic', 'recap', 'deep_dive', 'cover_story'])
  })
  it('Shadow ist per Default AUS — scharf schaltet nur der Betreiber', () => {
    expect(DEFAULT_CURATION_SETTINGS.shadow_enabled).toBe(false)
    expect(DEFAULT_CURATION_SETTINGS.kickoff_utc).toBe('04:25')
    expect(DEFAULT_CURATION_SETTINGS.budget_usd).toBe(4)
    expect(DEFAULT_CURATION_SETTINGS.daily_budget_usd).toBe(12)
  })
  it('die Listenansicht laedt keine schweren JSON-Spalten', () => {
    const cols = RUN_SUMMARY_COLUMNS.split(',').map(s => s.trim())
    for (const heavy of ['pool', 'cards', 'story_keys', 'brief', 'plan', 'critique', 'log']) expect(cols).not.toContain(heavy)
    expect(cols).toContain('metrics')
  })
})
```

- [ ] **Step 5: Test + Typecheck**

```bash
cd /Users/mattes/dev/synthszr && SUPABASE_SERVICE_ROLE_KEY= pnpm vitest run tests/lib/curation-types.test.ts && pnpm typecheck
```
Erwartet: 3 passed, keine `error TS`.

- [ ] **Step 6: Commit**

```bash
cd /Users/mattes/dev/synthszr && git add supabase/migrations/20261014090000_curation_phase1.sql lib/curation/types.ts tests/lib/curation-types.test.ts && git commit -m "$(cat <<'EOF'
feat(curation): Migration Phase 1 — curation_runs, curation_units, Caches, RPCs — und Typen

Shadow-Betrieb der Morgenkonferenz (Spec 2026-10-05, Plan 2026-10-14). Die
Engine haelt Zwischenergebnisse je Phase auf dem Run, damit jede Phase in
einem eigenen Cron-Tick laufen kann (Betreiber 2026-10-14: Vercel statt
launchd).

- curation_runs: Phasen, Lease, Protokoll, Budget, Snapshot/Cards/Brief/Plan
  als jsonb, Rekonziliations-Felder; ein offener Run je Tag und Modus
- curation_units: Einheiten mit Tier, Rang, Rolle, Outcome; added-Zeilen
  ohne Tier (CHECK)
- curation_item_embeddings / curation_cards: Caches
- get_precedent_units(vector[], before, per_role): Praezedenzen je Rolle in
  einem Round-Trip; get_pool_excerpts(ids, max_chars): gekappte Excerpts
  statt Volltext-Egress (77 % der Pool-Zeilen haben kein excerpt)
- RLS ohne Policy + REVOKE/GRANT service_role auf Tabellen und Funktionen
- lib/curation/types.ts: alle Typen der Phase 1

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Lese-Check gegen Prod VOR dem Anwenden (nur SELECT)**

```bash
cd /Users/mattes/dev/synthszr && npx -y supabase@2.84.1 db query --linked "select (select count(*) from information_schema.tables where table_schema='public' and table_name in ('curation_runs','curation_units','curation_item_embeddings','curation_cards')) as neue_tabellen, (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_precedent_units','get_pool_excerpts')) as rpcs, (select count(*) from information_schema.tables where table_schema='public' and table_name='published_units') as phase0_da"
```
Erwartet: `neue_tabellen = 0`, `rpcs = 0`, `phase0_da = 1`. Bei `phase0_da = 0`: STOPP — Phase-0-Migration zuerst (Plan 2026-10-06 Task 1 Steps 3–8); `get_precedent_units` referenziert `published_units.embedding`.

- [ ] **Step 8: [FREIGABE] Migration anwenden**

```bash
cd /Users/mattes/dev/synthszr && npx -y supabase@2.84.1 db query --linked --file /Users/mattes/dev/synthszr/supabase/migrations/20261014090000_curation_phase1.sql
```
Erwartet: kein `ERROR`; Verifikationszeile `neue_tabellen = 4, rls_aktiv = 4, keine_policy = true, anon_hat_keinen_zugriff = true, neue_indizes = 5, anon_keine_rpc = true, rpcs = 2`. Zeigt die CLI bei Mehrfach-Statements nur den Status, den Verifikations-SELECT separat ausführen.

- [ ] **Step 9: anon-Sperre prüfen (lesend)**

```bash
cd /Users/mattes/dev/synthszr && npx -y supabase@2.84.1 db query --linked "set role anon; select count(*) from public.curation_runs; reset role;"
cd /Users/mattes/dev/synthszr && npx -y supabase@2.84.1 db query --linked "set role anon; select * from public.get_pool_excerpts(array[]::uuid[], 10); reset role;"
```
Erwartet: beide liefern den CLI-JSON-Fehler mit `42501: permission denied for …`. Sonst STOPP, Betreiber fragen.

---

### Task 2: `lib/ai/call.ts`, `flushUsageLog`, drei Use Cases

**Files:**
- Create: `lib/ai/call.ts`
- Modify: `lib/ai/usage-log.ts:61-67` (Fallback) + Export `flushUsageLog`
- Modify: `lib/ai/use-cases.ts:12-48` (Union), `:57` (Definitionen)
- Modify: `app/admin/settings/page.tsx:101-126` (`USE_CASE_GROUPS`)
- Modify: `tests/lib/use-cases.test.ts:7-44` (`EXPECTED_USE_CASES`)
- Test: `tests/lib/curation-call.test.ts`

**Interfaces:**
- Consumes: `getModelCapabilities` (`lib/claude/model-capabilities.ts:129`; Felder `adaptiveThinking`, `supportsEffort`, `supportsForcedToolChoice`); `withUsageLogging` (`usage-log.ts:84`); `extractUsage`, `computeCostUsd`, `UsageTokens` (`usage-cost.ts:11,25,41`); `MODEL_PRICING` (`model-pricing.ts:31`, `pricing: { input, output }`); `getModelForUseCase` (`model-config.ts:55`). `createToolCall` wird NICHT genutzt (kennt nur `create`, stellt bei Thinking nicht auf `auto` um).
- Produces: Anhang A §3.1.

- [ ] **Step 1: Use Cases eintragen** — Union um `'curation_scout' | 'curation_editor' | 'curation_critic'` erweitern; in `USE_CASE_DEFINITIONS`:

```ts
  curation_scout: { label: 'Kuration: Scout', description: 'Kernsatz je Meldung fuer die Morgenkonferenz (Phase 1 Shadow)', defaultModel: 'claude-haiku-4-5-20251001', allowedProviders: ['anthropic'] },
  curation_editor: { label: 'Kuration: Chefredaktion', description: 'Setzliste, Bank und Zurueckgestelltes des Tages (compose_day)', defaultModel: 'claude-opus-5', allowedProviders: ['anthropic'] },
  curation_critic: { label: 'Kuration: Kritiker', description: 'Harte und weiche Verstoesse des Tagesplans', defaultModel: 'claude-sonnet-5', allowedProviders: ['anthropic'] },
```
`tests/lib/use-cases.test.ts`: die drei Keys an `EXPECTED_USE_CASES` anhängen. `app/admin/settings/page.tsx`: nach „Analyse & Verarbeitung" `{ title: 'Kuration (Morgenkonferenz)', useCases: ['curation_scout', 'curation_editor', 'curation_critic'] },`.

- [ ] **Step 2: Tests** — `SUPABASE_SERVICE_ROLE_KEY= pnpm vitest run tests/lib/use-cases.test.ts tests/lib/model-pricing.test.ts`. Erwartet: PASS (alle drei Default-Modelle stehen in `MODEL_PRICING`: :108, :66, :72).

- [ ] **Step 3: Failing Test für `callTool`** — `tests/lib/curation-call.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { createCaller, estimateUsd, CallInvalidError, type AnthropicLike } from '@/lib/ai/call'

function message(content: unknown[], stop = 'tool_use'): Anthropic.Message {
  return { id: 'm', type: 'message', role: 'assistant', model: 'x', content, stop_reason: stop, stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as unknown as Anthropic.Message
}
function fakeClient(responses: Array<Anthropic.Message | Error>) {
  const calls: Array<{ via: 'create' | 'stream'; params: Record<string, unknown> }> = []
  const next = () => { const r = responses.shift(); if (r instanceof Error) throw r; return r as Anthropic.Message }
  const client: AnthropicLike = {
    messages: {
      create: async (params) => { calls.push({ via: 'create', params: params as unknown as Record<string, unknown> }); return next() },
      stream: (params) => { calls.push({ via: 'stream', params: params as unknown as Record<string, unknown> }); return { finalMessage: async () => next() } },
    },
  }
  return { client, calls }
}
const TOOL: Anthropic.Tool = { name: 'report', input_schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } } }
const validate = (raw: unknown) => (raw && typeof raw === 'object' && 'ok' in raw ? (raw as { ok: boolean }) : null)
const toolUse = { type: 'tool_use', id: 't', name: 'report', input: { ok: true } }

describe('callTool', () => {
  it('Haiku: erzwungenes tool_choice, kein thinking, create, strict', async () => {
    const { client, calls } = fakeClient([message([toolUse])])
    const { callTool } = createCaller({ runId: 'r', mode: 'shadow', clientFactory: () => client, modelFor: async () => 'claude-haiku-4-5-20251001' })
    const res = await callTool({ useCase: 'curation_scout', system: 'S', user: 'U', tool: TOOL, maxTokens: 4096, thinking: false, validate })
    expect(res.result).toEqual({ ok: true }); expect(calls[0].via).toBe('create')
    expect(calls[0].params.tool_choice).toEqual({ type: 'tool', name: 'report' }); expect(calls[0].params.thinking).toBeUndefined()
    expect((calls[0].params.tools as Array<{ strict?: boolean }>)[0].strict).toBe(true); expect(res.costUsd).toBeGreaterThan(0)
  })
  it('Opus 5: auto + Anweisungsblock + adaptive + effort + stream ab 24k + gecachter Prefix', async () => {
    const { client, calls } = fakeClient([message([toolUse])])
    const { callTool } = createCaller({ runId: 'r', mode: 'shadow', clientFactory: () => client, modelFor: async () => 'claude-opus-5' })
    await callTool({ useCase: 'curation_editor', cachedPrefix: 'P', system: 'S', user: 'U', tool: TOOL, maxTokens: 24000, effort: 'medium', validate })
    const p = calls[0].params
    expect(calls[0].via).toBe('stream'); expect(p.tool_choice).toEqual({ type: 'auto' })
    expect(p.thinking).toEqual({ type: 'adaptive' }); expect(p.output_config).toEqual({ effort: 'medium' })
    const system = p.system as Array<{ text: string; cache_control?: unknown }>
    expect(system[0]).toEqual({ type: 'text', text: 'P', cache_control: { type: 'ephemeral' } })
    expect(system[1].text).toBe('S'); expect(system[2].text).toContain('ausschließlich über das Tool „report"')
  })
  it('kein tool_use → genau ein Retry → CallInvalidError', async () => {
    const { client, calls } = fakeClient([message([{ type: 'text', text: 'nö' }], 'end_turn'), message([{ type: 'text', text: 'nö' }], 'end_turn')])
    const { callTool } = createCaller({ runId: 'r', mode: 'shadow', clientFactory: () => client, modelFor: async () => 'claude-haiku-4-5-20251001' })
    await expect(callTool({ useCase: 'curation_scout', system: 'S', user: 'U', tool: TOOL, maxTokens: 1000, thinking: false, validate })).rejects.toBeInstanceOf(CallInvalidError)
    expect(calls).toHaveLength(2)
  })
  it('refusal → CallRefusedError mit Kategorie', async () => {
    const m = message([], 'refusal'); (m as unknown as { stop_details: unknown }).stop_details = { type: 'refusal', category: 'cyber' }
    const { client } = fakeClient([m])
    const { callTool } = createCaller({ runId: 'r', mode: 'shadow', clientFactory: () => client, modelFor: async () => 'claude-opus-5' })
    await expect(callTool({ useCase: 'curation_editor', system: 'S', user: 'U', tool: TOOL, maxTokens: 1000, validate })).rejects.toMatchObject({ name: 'CallRefusedError', category: 'cyber' })
  })
  it('400 mit „strict" → Retry ohne strict', async () => {
    const err = new Anthropic.BadRequestError(400, { error: { message: 'tools.0.strict: not supported' } }, 'strict not supported', new Headers())
    const { client, calls } = fakeClient([err, message([toolUse])])
    const { callTool } = createCaller({ runId: 'r', mode: 'shadow', clientFactory: () => client, modelFor: async () => 'claude-haiku-4-5-20251001' })
    const res = await callTool({ useCase: 'curation_scout', system: 'S', user: 'U', tool: TOOL, maxTokens: 1000, thinking: false, validate })
    expect(res.strictDropped).toBe(true); expect((calls[1].params.tools as Array<{ strict?: boolean }>)[0].strict).toBeUndefined()
  })
  it('estimateUsd: Opus-5-Preise; unbekanntes Modell faellt nach oben', () => {
    expect(estimateUsd('claude-opus-5', 35_000, 24_000)).toBeCloseTo((35_000 / 3.5 / 1e6) * 5 + (24_000 / 1e6) * 25, 4)
    expect(estimateUsd('claude-unbekannt', 3_500, 1_000)).toBeCloseTo((1_000 / 1e6) * 5 + (1_000 / 1e6) * 25, 6)
  })
})
```

- [ ] **Step 4: Test laufen lassen — muss fehlschlagen** (Modul fehlt).

- [ ] **Step 5: `lib/ai/call.ts` implementieren** (vollständig; Feldnamen von `UsageTokens` aus `lib/ai/usage-cost.ts:11` übernehmen):

```ts
/**
 * Modellaufrufe der Morgenkonferenz (Phase 1). WARUM eigene Schicht statt
 * createToolCall (lib/claude/tool-call.ts): die Chefredaktion braucht 24k
 * Output-Tokens — ohne Streaming lehnt SDK 0.71 ab 21.333 Tokens ab (BEFUND
 * 2026-10-14, messages.js:20-24) —, und bei Modellen mit Thinking ist erzwungenes
 * tool_choice ein 400 (Opus 5.5, Sonnet 5.5, Fable 5.1; API-Referenz 2026-09-25).
 * Hier: Streaming ab 16k, tool_choice auto + Anweisung bei Thinking, strict auf
 * dem Tool, ein Retry ohne tool_use, Refusal als Fehler.
 */
import Anthropic from '@anthropic-ai/sdk'
import { getModelCapabilities } from '@/lib/claude/model-capabilities'
import { getModelForUseCase } from '@/lib/ai/model-config'
import { MODEL_PRICING } from '@/lib/ai/model-pricing'
import { computeCostUsd, extractUsage, type UsageTokens } from '@/lib/ai/usage-cost'
import { withUsageLogging } from '@/lib/ai/usage-log'
import type { UseCase } from '@/lib/ai/use-cases'
import type { RunMode } from '@/lib/curation/types'

export interface CallToolInput<T> {
  useCase: UseCase; system: string; cachedPrefix?: string; user: string; tool: Anthropic.Tool
  maxTokens: number; effort?: 'low' | 'medium' | 'high'; thinking?: boolean; validate: (input: unknown) => T | null
}
export interface CallToolResult<T> { result: T; model: string; tokens: UsageTokens; costUsd: number; retried: boolean; strictDropped: boolean }
export type CallToolFn = <T>(input: CallToolInput<T>) => Promise<CallToolResult<T>>
export class CallRefusedError extends Error {
  constructor(useCase: string, public readonly category: string | null) { super(`${useCase}: Modell hat abgelehnt (${category ?? 'ohne Kategorie'})`); this.name = 'CallRefusedError' }
}
export class CallInvalidError extends Error { constructor(useCase: string) { super(`${useCase}: keine gueltige Tool-Antwort nach Retry`); this.name = 'CallInvalidError' } }

const FALLBACK_PRICING = { input: 5, output: 25 }, STREAM_FROM_TOKENS = 16_384, CHARS_PER_TOKEN = 3.5
export function estimateUsd(model: string, inputChars: number, maxTokens: number): number {
  const p = MODEL_PRICING[model]?.pricing ?? FALLBACK_PRICING
  return (inputChars / CHARS_PER_TOKEN / 1e6) * p.input + (maxTokens / 1e6) * p.output
}
export interface AnthropicLike {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>
    stream(params: Anthropic.MessageCreateParamsNonStreaming): { finalMessage(): Promise<Anthropic.Message> }
  }
}
export interface CallerOptions {
  runId: string; mode: RunMode
  clientFactory?: (useCase: UseCase) => AnthropicLike
  modelFor?: (useCase: UseCase) => Promise<string>
  onCost?: (useCase: UseCase, costUsd: number) => void
}
export function createCaller(opts: CallerOptions): { callTool: CallToolFn; modelFor: (useCase: UseCase) => Promise<string> } {
  const modelFor = opts.modelFor ?? ((u: UseCase) => getModelForUseCase(u))
  const meta = { runId: opts.runId, mode: opts.mode }
  const clientFor = opts.clientFactory ?? ((u: UseCase) => withUsageLogging(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), u, meta) as unknown as AnthropicLike)

  const callTool: CallToolFn = async <T>(input: CallToolInput<T>): Promise<CallToolResult<T>> => {
    const model = await modelFor(input.useCase)
    const caps = getModelCapabilities(model)
    const thinking = input.thinking ?? caps.adaptiveThinking
    const forced = caps.supportsForcedToolChoice && !thinking
    const client = clientFor(input.useCase)
    const buildParams = (strict: boolean): Anthropic.MessageCreateParamsNonStreaming => {
      const system: Anthropic.TextBlockParam[] = []
      if (input.cachedPrefix) system.push({ type: 'text', text: input.cachedPrefix, cache_control: { type: 'ephemeral' } })
      system.push({ type: 'text', text: input.system })
      if (!forced) system.push({ type: 'text', text: `Antworte ausschließlich über das Tool „${input.tool.name}". Kein Fließtext.` })
      const params: Record<string, unknown> = {
        model, max_tokens: input.maxTokens, system, messages: [{ role: 'user', content: input.user }],
        tools: [strict ? { ...input.tool, strict: true } : input.tool],
        tool_choice: forced ? { type: 'tool', name: input.tool.name } : { type: 'auto' },
      }
      if (thinking && caps.adaptiveThinking) { params.thinking = { type: 'adaptive' }; if (input.effort && caps.supportsEffort) params.output_config = { effort: input.effort } }
      return params as unknown as Anthropic.MessageCreateParamsNonStreaming
    }
    const send = (p: Anthropic.MessageCreateParamsNonStreaming) => input.maxTokens > STREAM_FROM_TOKENS ? client.messages.stream(p).finalMessage() : client.messages.create(p)

    let strict = true, strictDropped = false, retried = false, attempt = 0
    let message: Anthropic.Message | undefined, result: T | undefined
    while (attempt < 2 && !message) {
      try {
        const m = await send(buildParams(strict))
        if (m.stop_reason === 'refusal') {
          const details = (m as unknown as { stop_details?: { category?: string | null } }).stop_details
          throw new CallRefusedError(input.useCase, details?.category ?? null)
        }
        const block = m.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === input.tool.name)
        const parsed = block ? input.validate(block.input) : null
        if (parsed !== null) { message = m; result = parsed; break }
        attempt++; retried = true
        if (attempt >= 2) throw new CallInvalidError(input.useCase)
      } catch (err) {
        if (err instanceof Anthropic.BadRequestError && strict && /strict/i.test(err.message)) {
          console.warn(`[Curation] ${model}: strict abgelehnt — Retry ohne strict`); strict = false; strictDropped = true; continue
        }
        throw err
      }
    }
    const tokens = extractUsage(message!.usage) ?? ({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 } as unknown as UsageTokens)
    const costUsd = computeCostUsd(model, tokens) ?? estimateUsd(model, input.user.length + input.system.length + (input.cachedPrefix?.length ?? 0), input.maxTokens)
    opts.onCost?.(input.useCase, costUsd)
    return { result: result as T, model, tokens, costUsd, retried, strictDropped }
  }
  return { callTool, modelFor }
}
```

- [ ] **Step 6: `flushUsageLog` in `lib/ai/usage-log.ts`** — über dem Fallback (:61-67) `const pending = new Set<Promise<void>>()`; den Fallback `void logLlmUsage(...)` ersetzen durch

```ts
      const p: Promise<void> = logLlmUsage(useCase, model, usage, meta).finally(() => { pending.delete(p) })
      pending.add(p)
```
und am Dateiende:
```ts
/** Scripts warten hiermit vor process.exit auf offene Kosten-Inserts (BEFUND 2026-10-14: fire-and-forget verliert sie sonst). */
export async function flushUsageLog(): Promise<void> { await Promise.allSettled([...pending]) }
```

- [ ] **Step 7: Tests + Typecheck** — `SUPABASE_SERVICE_ROLE_KEY= pnpm vitest run tests/lib/curation-call.test.ts tests/lib/use-cases.test.ts tests/lib/tool-call.test.ts && pnpm typecheck`. Erwartet: PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/mattes/dev/synthszr && git add lib/ai/call.ts lib/ai/usage-log.ts lib/ai/use-cases.ts app/admin/settings/page.tsx tests/lib/use-cases.test.ts tests/lib/curation-call.test.ts && git commit -m "$(cat <<'EOF'
feat(ai): call.ts — Tool-Aufrufe mit Streaming, auto+Anweisung bei Thinking, strict, Refusal, Kosten

Fuer die Morgenkonferenz (Phase 1): Chefredaktion braucht 24k Output ohne
SDK-Timeout, und Modelle mit Thinking lehnen erzwungenes tool_choice ab.

- createCaller(runId, mode): Modell aus Use Case, Faehigkeiten aus
  getModelCapabilities, Streaming ab 16k, cache_control auf dem Prefix,
  genau ein Retry ohne tool_use, Retry ohne strict bei 400, CallRefusedError
- estimateUsd fuer die Budget-Reservierung (fail-closed nach oben)
- flushUsageLog: Scripts warten vor exit auf offene llm_usage-Inserts
- Use Cases curation_scout/editor/critic + Settings-Gruppe „Kuration"

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `lib/curation/service.ts` — Runs, Units, Settings, Kickoff

**Files:**
- Create: `lib/curation/service.ts`
- Test: `tests/lib/curation-service.test.ts`

**Interfaces:**
- Consumes: Typen aus Task 1; `SupabaseAdmin` aus `@/lib/news-queue/events`.
- Produces: Anhang A §3.2.

- [ ] **Step 1: Failing Tests** — `tests/lib/curation-service.test.ts` (makeChain mit `select,eq,neq,in,is,or,not,lt,lte,gt,gte,order,limit,range,update,insert,upsert,delete` + `single`/`maybeSingle`/`then`; `client.rpc = vi.fn()`):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { claimRun, createRun, getNextOpenRun, insertUnits, kickoffAsOf, loadCurationSettings, parseRunRow, LEASE_STALE_MS } from '@/lib/curation/service'
import { DEFAULT_CURATION_SETTINGS } from '@/lib/curation/types'

const state = vi.hoisted(() => ({ queues: {} as Record<string, unknown[]>, fallback: { data: null as unknown, error: null as unknown }, chains: {} as Record<string, any[]> }))
function makeChain(table: string) {
  const chain: any = {}
  for (const m of ['select','eq','neq','in','is','or','not','lt','lte','gt','gte','order','limit','range','update','insert','upsert','delete']) chain[m] = vi.fn(() => chain)
  const queue = state.queues[table]; const own = queue && queue.length ? queue.shift() : undefined
  const resolved = () => own ?? state.fallback
  chain.single = vi.fn(async () => resolved()); chain.maybeSingle = vi.fn(async () => resolved())
  chain.then = (res: (v: unknown) => void) => res(resolved())
  ;(state.chains[table] ??= []).push(chain); return chain
}
const client = { from: vi.fn((t: string) => makeChain(t)), rpc: vi.fn() } as any
beforeEach(() => { state.queues = {}; state.chains = {}; state.fallback = { data: null, error: null }; client.from.mockClear() })

const RUN = { id: 'run-1', day: '2026-10-15', mode: 'shadow', asof: '2026-10-15T04:25:00.000Z', status: 'pending', phase: 'pool', brief_mode: 'full', attempts: 0, last_advanced_at: null, cancel_requested: false, log: [], degraded: [], budget_usd: '4.0000', spend_usd: '0.0000', compose_attempts: 0, pool: null, cards: null, story_keys: null, brief: null, baseline: null, plan: null, critique: null, reconciled_at: null, matched_post_id: null, matched_job_id: null, metrics: null, model_scout: 'h', model_editor: 'o', model_critic: 's', error_message: null, created_at: '2026-10-15T04:25:01.000Z', finished_at: null }

describe('kickoffAsOf', () => {
  it('heutiger Kickoff als ISO, wenn erreicht', () => { expect(kickoffAsOf('2026-10-15T04:26:10.000Z', '04:25')).toBe('2026-10-15T04:25:00.000Z') })
  it('null davor und bei ungueltiger Zeit', () => { expect(kickoffAsOf('2026-10-15T04:24:59.000Z', '04:25')).toBeNull(); expect(kickoffAsOf('2026-10-15T10:00:00.000Z', '4:25')).toBeNull() })
})
describe('parseRunRow', () => { it('numeric-Strings → Zahlen', () => { const r = parseRunRow(RUN); expect(r.budget_usd).toBe(4); expect(r.spend_usd).toBe(0) }) })
describe('createRun', () => {
  it('liefert bei 23505 den offenen Run des Tages', async () => {
    state.queues.curation_runs = [{ data: null, error: { code: '23505', message: 'duplicate' } }, { data: RUN, error: null }]
    const r = await createRun(client, { day: '2026-10-15', mode: 'shadow', asof: RUN.asof, brief_mode: 'full', budget_usd: 4, models: { scout: 'h', editor: 'o', critic: 's' } })
    expect(r.id).toBe('run-1'); expect(state.chains.curation_runs[1].eq).toHaveBeenCalledWith('day', '2026-10-15')
  })
})
describe('getNextOpenRun', () => {
  it('nur Shadow-Runs mit abgelaufenem Lease', async () => {
    state.queues.curation_runs = [{ data: [RUN], error: null }]
    const now = Date.parse('2026-10-15T05:00:00.000Z')
    expect((await getNextOpenRun(client, now))?.id).toBe('run-1')
    const c = state.chains.curation_runs[0]
    expect(c.in).toHaveBeenCalledWith('status', ['pending', 'processing'])
    expect(c.or).toHaveBeenCalledWith(`last_advanced_at.is.null,last_advanced_at.lt.${new Date(now - LEASE_STALE_MS).toISOString()}`)
    expect(c.eq).toHaveBeenCalledWith('mode', 'shadow')
  })
})
describe('claimRun', () => {
  it('processing + Lease + attempts in EINEM Update', async () => {
    await claimRun(client, 'run-1', 3)
    const c = state.chains.curation_runs[0]
    expect(c.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'processing', attempts: 3, last_advanced_at: expect.any(String) })); expect(c.eq).toHaveBeenCalledWith('id', 'run-1')
  })
})
describe('loadCurationSettings', () => {
  it('merged DB-Wert ueber Defaults; Fehler → Defaults', async () => {
    state.queues.settings = [{ data: { value: { shadow_enabled: true, kickoff_utc: '04:30' } }, error: null }]
    expect(await loadCurationSettings(client)).toEqual({ ...DEFAULT_CURATION_SETTINGS, shadow_enabled: true, kickoff_utc: '04:30' })
    state.queues.settings = [{ data: null, error: { message: 'weg' } }]
    expect(await loadCurationSettings(client)).toEqual(DEFAULT_CURATION_SETTINGS)
  })
})
describe('insertUnits', () => {
  it('delete je Run, dann insert in Scheiben à 200', async () => {
    const units = Array.from({ length: 250 }, (_, i) => ({ unit_key: `u${i}`, member_ids: [], story_key: null, role: null, rank: i + 1, tier: 'bench', reason: null, alternative: null, precedent_ids: [], is_hand: false, panel_action: null, panel_at: null, outcome: null, final_role: null, final_rank: null, matched_post_id: null, matched_heading: null, similarity: null })) as any
    await insertUnits(client, 'run-1', units)
    const chains = state.chains.curation_units
    expect(chains[0].delete).toHaveBeenCalled(); expect(chains[0].eq).toHaveBeenCalledWith('run_id', 'run-1')
    expect((chains[1].insert.mock.calls[0][0] as unknown[]).length).toBe(200); expect((chains[2].insert.mock.calls[0][0] as unknown[]).length).toBe(50)
    expect(chains[1].insert).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ run_id: 'run-1', unit_key: 'u0' })]))
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen** (Modul fehlt).

- [ ] **Step 3: `lib/curation/service.ts` implementieren** — alle Funktionen aus §3.2; Kern:

```ts
import type { SupabaseAdmin } from '@/lib/news-queue/events'
import { DEFAULT_CURATION_SETTINGS, RUN_SUMMARY_COLUMNS, type BriefMode, type CurationSettings, type RunLogEntry, type RunMetrics, type RunMode, type RunRow, type RunSummary, type UnitInsert, type UnitRow } from '@/lib/curation/types'

export const LEASE_STALE_MS = 900_000   // > maxDuration 800 s der Cron-Route (glossary_jobs: 360 s bei 300 s)
export const MAX_ATTEMPTS = 10
const IN_CHUNK = 200
const KICKOFF_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function stamp(): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())
}
export function kickoffAsOf(nowIso: string, kickoffUtc: string): string | null {
  const m = KICKOFF_RE.exec(kickoffUtc); if (!m) return null
  const asof = `${nowIso.slice(0, 10)}T${m[1]}:${m[2]}:00.000Z`
  return Date.parse(nowIso) >= Date.parse(asof) ? asof : null
}
export function parseRunRow(raw: Record<string, unknown>): RunRow {
  return { ...(raw as unknown as RunRow), budget_usd: Number(raw.budget_usd ?? 0), spend_usd: Number(raw.spend_usd ?? 0),
    log: (raw.log as RunLogEntry[]) ?? [], degraded: (raw.degraded as RunRow['degraded']) ?? [] }
}
function fail(table: string, error: { message: string } | null): never { throw new Error(`${table}: ${error?.message ?? 'unbekannt'}`) }

export async function createRun(supabase: SupabaseAdmin, input: { day: string; mode: RunMode; asof: string; brief_mode: BriefMode; budget_usd: number; models: { scout: string; editor: string; critic: string } }): Promise<RunRow> {
  const row = { day: input.day, mode: input.mode, asof: input.asof, brief_mode: input.brief_mode, budget_usd: input.budget_usd, model_scout: input.models.scout, model_editor: input.models.editor, model_critic: input.models.critic }
  const { data, error } = await supabase.from('curation_runs').insert(row).select('*').single()
  if (error && (error as { code?: string }).code === '23505') {
    const open = await supabase.from('curation_runs').select('*').eq('day', input.day).eq('mode', input.mode).in('status', ['pending', 'processing']).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (open.error || !open.data) fail('curation_runs', open.error)
    return parseRunRow(open.data as Record<string, unknown>)
  }
  if (error || !data) fail('curation_runs', error)
  return parseRunRow(data as Record<string, unknown>)
}
export async function getNextOpenRun(supabase: SupabaseAdmin, now: number = Date.now()): Promise<RunRow | null> {
  const stale = new Date(now - LEASE_STALE_MS).toISOString()
  const { data, error } = await supabase.from('curation_runs').select('*').eq('mode', 'shadow').in('status', ['pending', 'processing'])
    .or(`last_advanced_at.is.null,last_advanced_at.lt.${stale}`).order('created_at', { ascending: true }).limit(1)
  if (error) fail('curation_runs', error)
  const rows = (data ?? []) as Record<string, unknown>[]
  return rows.length ? parseRunRow(rows[0]) : null
}
export async function claimRun(supabase: SupabaseAdmin, id: string, attempts: number): Promise<void> {
  const { error } = await supabase.from('curation_runs').update({ status: 'processing', last_advanced_at: new Date().toISOString(), attempts }).eq('id', id)
  if (error) fail('curation_runs', error)
}
export async function insertUnits(supabase: SupabaseAdmin, runId: string, units: UnitInsert[]): Promise<void> {
  const del = await supabase.from('curation_units').delete().eq('run_id', runId)
  if (del.error) fail('curation_units delete', del.error)
  for (let i = 0; i < units.length; i += IN_CHUNK) {
    const { error } = await supabase.from('curation_units').insert(units.slice(i, i + IN_CHUNK).map(u => ({ ...u, run_id: runId })))
    if (error) fail('curation_units insert', error)
  }
}
export async function loadCurationSettings(supabase: SupabaseAdmin): Promise<CurationSettings> {
  const { data, error } = await supabase.from('settings').select('value').eq('key', 'curation').maybeSingle()
  if (error || !data) return { ...DEFAULT_CURATION_SETTINGS }
  return { ...DEFAULT_CURATION_SETTINGS, ...((data as { value?: Partial<CurationSettings> }).value ?? {}) }
}
// Nach demselben Muster (fail(table, error) bei PostgREST-Fehler):
// getRun: select('*').eq('id').maybeSingle() → parseRunRow | null
// releaseLease: update({ last_advanced_at: null }).eq('id')
// saveRunState: update({ ...patch, last_advanced_at: now }).eq('id')
// appendRunLog: run.log = [...run.log, ...entries]; update({ log: run.log, last_advanced_at: now }).eq('id', run.id)
// finishRun: update({ status, finished_at: now, error_message: errorMessage ?? null, last_advanced_at: null, ...(status === 'done' ? { phase: 'finished' } : {}) }).eq('id')
// listRuns: select(RUN_SUMMARY_COLUMNS)[.eq('mode', mode)].order('day', { ascending: false }).order('created_at', { ascending: false }).limit(limit) → parseRunRow je Zeile (als RunSummary)
// getRunUnits: select('*').eq('run_id').order('tier').order('rank') → UnitRow[]
// getRunsToReconcile: select('*').eq('mode','shadow').eq('status','done').is('reconciled_at', null).lte('asof', new Date(Date.parse(nowIso) - 600_000).toISOString()).order('asof', { ascending: true }).limit(limit)
// markReconciled: update({ ...patch, reconciled_at: now }).eq('id')
// updateUnitOutcomes: je outcome update({ outcome, final_role, final_rank, matched_post_id, matched_heading, similarity }).eq('run_id').eq('unit_key'); added: insert à 200 mit run_id
// spentTodayUsd: select('spend_usd').eq('day', day).eq('mode','shadow') → Summe clientseitig (PostgREST kann sum nicht selektieren)
```

- [ ] **Step 4: Tests + Typecheck** — `SUPABASE_SERVICE_ROLE_KEY= pnpm vitest run tests/lib/curation-service.test.ts && pnpm typecheck`. Erwartet: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/mattes/dev/synthszr && git add lib/curation/service.ts tests/lib/curation-service.test.ts && git commit -m "$(cat <<'EOF'
feat(curation): service.ts — Run-Engine-Helfer, Einheiten, Settings, Kickoff

- createRun (23505 → offener Run), getNextOpenRun (Lease 15 min > maxDuration 800 s),
  claimRun/releaseLease/saveRunState/appendRunLog/finishRun nach glossary_jobs-Muster
- insertUnits idempotent je Run (delete + insert à 200), updateUnitOutcomes, getRunUnits
- loadCurationSettings (Defaults, shadow_enabled aus), kickoffAsOf (fester UTC-Slot, Phase 1)
- getRunsToReconcile, markReconciled, spentTodayUsd (Tageskappe)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `lib/curation/pool.ts` — Pool as-of, Excerpts, Hand-Begriff, Embeddings mit Cache

**Files:**
- Create: `lib/curation/pool.ts`
- Test: `tests/lib/curation-pool.test.ts`

**Interfaces:**
- Consumes: `poolWindow`, `loadRepoEmbeddings` (`lib/curation/baseline-day.ts:195, :642`); `poolExclusionAsOf`, `loadPostPublishTimes`, `eventsAsOf` (`lib/curation/precedents.ts:344, :380, :402`); `loadEventsForItems` (`lib/news-queue/events.ts:136`); `isHandItem` (`lib/curation/origin.ts:115`); `isJunkTitle` (`lib/news-queue/service.ts:136`); `prepareTextForEmbedding` (`lib/embeddings/generator.ts:103`); `parseEmbedding` (`semantic-dedup.ts:120`); `createEmbedFailGuard`, `EmbedTexts` (`scripts/lib/published-units-backfill.ts:157, :20`); RPC `get_pool_excerpts`.
- Produces: Anhang A §3.3.

- [ ] **Step 1: Failing Tests schreiben** — `tests/lib/curation-pool.test.ts` (makeChain wie Task 3, plus `client.rpc = vi.fn()`):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { filterPoolAsOf, isLiveAsOf, loadPoolAsOf, loadPoolEmbeddings, techmemeStoriesOf, toSnapshotItem, type PoolRawRow } from '@/lib/curation/pool'
// … makeChain/state/client wie in Task 3, zusaetzlich: client.rpc = vi.fn(async () => ({ data: [], error: null }))

const ASOF = '2026-10-15T04:25:00.000Z'
function row(p: Partial<PoolRawRow> & { id: string }): PoolRawRow {
  return { title: `Meldung ${p.id} mit genug Text`, source_identifier: 'src@x', source_display_name: null, total_score: 5, bundle_type: null, metadata: null,
    content_length: 2000, daily_repo_id: `repo-${p.id}`, queued_at: '2026-10-14T20:00:00.000Z', expires_at: '2026-10-16T20:00:00.000Z',
    used_in_post_id: null, status: 'pending', selected_at: null, source_pub_rate: 0.1, ...p }
}

describe('filterPoolAsOf', () => {
  it('schliesst used_earlier, expired und (nur live) skipped aus; Junk und zu kurze fallen raus', () => {
    const rows = [
      row({ id: 'ok' }),
      row({ id: 'used', used_in_post_id: 'post-alt' }),
      row({ id: 'exp', expires_at: '2026-10-15T04:00:00.000Z' }),
      row({ id: 'skip', status: 'skipped' }),
      row({ id: 'junk', title: 'http://x.y/z' }),
      row({ id: 'short', content_length: 120 }),
    ]
    const postTimes = new Map([['post-alt', '2026-10-15T01:00:00.000Z']])
    const live = filterPoolAsOf(rows, ASOF, postTimes, { minContentLength: 500, live: true })
    expect(live.kept.map(r => r.id)).toEqual(['ok'])
    expect(live.excluded).toEqual({ used_earlier: 1, expired: 1, skipped: 1, junk: 1, short: 1 })
    const past = filterPoolAsOf(rows, ASOF, postTimes, { minContentLength: 500, live: false })
    expect(past.kept.map(r => r.id)).toEqual(['ok', 'skip'])   // skipped ist historisch nicht rekonstruierbar
  })
  it('Techmeme-Items und Hand-Kandidaten ueberstehen Junk- und Laengenfilter', () => {
    const rows = [
      row({ id: 'tm', content_length: 100, daily_repo_id: null, metadata: { techmeme: true, techmeme_story: 'openai-dots', techmeme_story_index: 2 } }),
      row({ id: 'hand', content_length: 100, status: 'selected', selected_at: '2026-10-15T03:00:00.000Z' }),
      row({ id: 'later', content_length: 100, status: 'selected', selected_at: '2026-10-15T06:00:00.000Z' }),
    ]
    const r = filterPoolAsOf(rows, ASOF, new Map(), { minContentLength: 500, live: false })
    expect(r.kept.map(x => x.id)).toEqual(['tm', 'hand'])
  })
})
describe('techmemeStoriesOf', () => {
  it('gruppiert nach techmeme_story, Member nach total_score, index = kleinster story_index', () => {
    const items = [
      toSnapshotItem(row({ id: 'a', total_score: 3, metadata: { techmeme: true, techmeme_story: 's1', techmeme_story_index: 1 } }), 'x', false),
      toSnapshotItem(row({ id: 'b', total_score: 9, metadata: { techmeme: true, techmeme_story: 's1', techmeme_story_index: 1 } }), 'x', false),
      toSnapshotItem(row({ id: 'c', total_score: 1, metadata: { techmeme: true, techmeme_story: 's2', techmeme_story_index: 4 } }), 'x', false),
      toSnapshotItem(row({ id: 'd' }), 'x', false),
    ]
    expect(techmemeStoriesOf(items)).toEqual([{ story: 's1', index: 1, member_ids: ['b', 'a'] }, { story: 's2', index: 4, member_ids: ['c'] }])
  })
})
describe('isLiveAsOf', () => {
  it('live innerhalb 15 Minuten um jetzt', () => {
    const now = Date.parse(ASOF)
    expect(isLiveAsOf(ASOF, now + 5 * 60_000)).toBe(true)
    expect(isLiveAsOf(ASOF, now + 16 * 60_000)).toBe(false)
  })
})
describe('loadPoolAsOf', () => {
  it('liest das 48-h-Fenster seitenweise, holt Excerpts per RPC und den Hand-Begriff aus Events', async () => {
    state.queues.news_queue = [{ data: [row({ id: 'ok' }), row({ id: 'hand', status: 'selected', selected_at: '2026-10-15T03:00:00.000Z' })], error: null }]
    client.rpc = vi.fn(async () => ({ data: [{ id: 'ok', excerpt: 'Auszug ok' }, { id: 'hand', excerpt: 'Auszug hand' }], error: null }))
    state.queues.queue_item_events = [{ data: [{ id: 1, queue_item_id: 'hand', event: 'select', actor: 'operator', to_status: 'selected', at: '2026-10-15T03:00:00.000Z' }], error: null }]
    const snap = await loadPoolAsOf(client, { asOf: ASOF, minContentLength: 500, windowHours: 48 })
    const q = state.chains.news_queue[0]
    expect(q.gte).toHaveBeenCalledWith('queued_at', '2026-10-13T04:25:00.000Z')
    expect(q.lt).toHaveBeenCalledWith('queued_at', ASOF)
    expect(q.range).toHaveBeenCalledWith(0, 999)
    expect(client.rpc).toHaveBeenCalledWith('get_pool_excerpts', { ids: ['ok', 'hand'], max_chars: 1500 })
    expect(snap.items.find(i => i.id === 'ok')?.excerpt).toBe('Auszug ok')
    expect(snap.handIds).toEqual(['hand'])
    expect(snap.items.find(i => i.id === 'hand')?.hand).toBe(true)
  })
})
describe('loadPoolEmbeddings', () => {
  it('nutzt daily_repo, dann den Cache, erzeugt den Rest und schreibt ihn in den Cache', async () => {
    const items = [
      toSnapshotItem(row({ id: 'r1' }), 'x', false),                                   // repo-r1 hat Embedding
      toSnapshotItem(row({ id: 'c1', daily_repo_id: null }), 'x', false),              // im Cache
      toSnapshotItem(row({ id: 'n1', daily_repo_id: null }), 'Neu', false),            // on-the-fly
    ]
    state.queues.daily_repo = [{ data: [{ id: 'repo-r1', embedding: JSON.stringify([1, 0, 0]) }], error: null }]
    state.queues.curation_item_embeddings = [{ data: [{ item_id: 'c1', embedding: '[0,1,0]' }], error: null }, { data: null, error: null }]
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [0, 0, 1]))
    const res = await loadPoolEmbeddings(client, items, embed)
    expect([...res.embeddings.keys()].sort()).toEqual(['c1', 'n1', 'r1'])
    expect(res.generated).toBe(1); expect(res.failed).toBe(0)
    expect(embed).toHaveBeenCalledWith([expect.stringContaining('Neu')])
    expect(state.chains.curation_item_embeddings[1].upsert).toHaveBeenCalledWith([{ item_id: 'n1', embedding: '[0,0,1]' }], { onConflict: 'item_id' })
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen.**

- [ ] **Step 3: `lib/curation/pool.ts` implementieren** — Kernfunktionen:

```ts
import type { SupabaseAdmin } from '@/lib/news-queue/events'
import { loadEventsForItems } from '@/lib/news-queue/events'
import { isJunkTitle } from '@/lib/news-queue/service'
import { parseEmbedding } from '@/lib/news-queue/semantic-dedup'
import { prepareTextForEmbedding } from '@/lib/embeddings/generator'
import { loadRepoEmbeddings, poolWindow } from '@/lib/curation/baseline-day'
import { eventsAsOf, loadPostPublishTimes, poolExclusionAsOf } from '@/lib/curation/precedents'
import { isHandItem } from '@/lib/curation/origin'
import { createEmbedFailGuard, type EmbedTexts } from '@/scripts/lib/published-units-backfill'
import type { PoolSnapshot, PoolSnapshotItem } from '@/lib/curation/types'

export interface PoolOptions { asOf: string; minContentLength: number; windowHours: number }
export interface PoolRawRow { /* §3.3 */ }
export const POOL_SELECT = 'id, title, source_identifier, source_display_name, total_score, bundle_type, metadata, content_length, daily_repo_id, queued_at, expires_at, used_in_post_id, status, selected_at, source_pub_rate'
const PAGE = 1000, LIMIT = 2000, IN_CHUNK = 200, EXCERPT_CHARS = 1500, EMBED_BATCH = 16, LIVE_WINDOW_MS = 15 * 60_000

export function isLiveAsOf(asOf: string, now: number = Date.now()): boolean { return Math.abs(now - Date.parse(asOf)) < LIVE_WINDOW_MS }
function isTechmeme(m: Record<string, unknown> | null): boolean { return m?.techmeme === true && typeof m?.techmeme_story === 'string' && (m.techmeme_story as string).length > 0 }
function isHandCandidate(r: PoolRawRow, asOf: string, live: boolean): boolean {
  if (live && r.status === 'selected') return true
  return !!r.selected_at && Date.parse(r.selected_at) <= Date.parse(asOf)
}
export function filterPoolAsOf(rows: PoolRawRow[], asOf: string, postTimeById: Map<string, string>, opts: { minContentLength: number; live: boolean }) {
  const excluded = { used_earlier: 0, expired: 0, skipped: 0, junk: 0, short: 0 }
  const kept: PoolRawRow[] = []
  for (const r of rows) {
    const ex = poolExclusionAsOf({ id: r.id, expires_at: r.expires_at, used_in_post_id: r.used_in_post_id }, asOf, '', postTimeById)
    if (ex === 'used_earlier') { excluded.used_earlier++; continue }
    if (ex === 'expired') { excluded.expired++; continue }
    if (opts.live && r.status === 'skipped') { excluded.skipped++; continue }
    const protectedItem = isTechmeme(r.metadata) || isHandCandidate(r, asOf, opts.live)
    if (!protectedItem && isJunkTitle(r.title)) { excluded.junk++; continue }
    if (!protectedItem && (Number(r.content_length) || 0) < opts.minContentLength) { excluded.short++; continue }
    kept.push(r)
  }
  return { kept, excluded }
}
export function toSnapshotItem(row: PoolRawRow, excerpt: string, hand: boolean): PoolSnapshotItem {
  const m = row.metadata
  return { id: row.id, title: row.title, source_identifier: row.source_identifier, source_display_name: row.source_display_name,
    total_score: Number(row.total_score) || 0, bundle_type: row.bundle_type, metadata: m, content_length: row.content_length,
    daily_repo_id: row.daily_repo_id, queued_at: row.queued_at, source_pub_rate: Number(row.source_pub_rate) || 0, excerpt, hand,
    techmeme_story: isTechmeme(m) ? (m!.techmeme_story as string) : null,
    techmeme_story_index: isTechmeme(m) && typeof m!.techmeme_story_index === 'number' ? (m!.techmeme_story_index as number) : null }
}
export function techmemeStoriesOf(items: PoolSnapshotItem[]): PoolSnapshot['techmemeStories'] {
  const by = new Map<string, PoolSnapshotItem[]>()
  for (const it of items) if (it.techmeme_story) (by.get(it.techmeme_story) ?? by.set(it.techmeme_story, []).get(it.techmeme_story)!).push(it)
  return [...by.entries()].map(([story, members]) => ({ story, index: Math.min(...members.map(m => m.techmeme_story_index ?? Number.MAX_SAFE_INTEGER)),
    member_ids: [...members].sort((a, b) => b.total_score - a.total_score).map(m => m.id) })).sort((a, b) => a.index - b.index)
}
export async function loadPoolAsOf(supabase: SupabaseAdmin, opts: PoolOptions): Promise<PoolSnapshot> {
  const from = new Date(Date.parse(opts.asOf) - opts.windowHours * 3_600_000).toISOString()
  const raw: PoolRawRow[] = []
  for (let offset = 0; offset < LIMIT; offset += PAGE) {
    const { data, error } = await supabase.from('news_queue').select(POOL_SELECT).gte('queued_at', from).lt('queued_at', opts.asOf).order('id').range(offset, offset + PAGE - 1)
    if (error) throw new Error(`news_queue: ${error.message}`)
    const page = (data ?? []) as PoolRawRow[]; raw.push(...page); if (page.length < PAGE) break
  }
  const live = isLiveAsOf(opts.asOf)
  const postTimes = await loadPostPublishTimes(supabase, [...new Set(raw.map(r => r.used_in_post_id).filter((x): x is string => !!x))])
  const { kept, excluded } = filterPoolAsOf(raw, opts.asOf, postTimes, { minContentLength: opts.minContentLength, live })
  const excerpts = new Map<string, string>()
  for (let i = 0; i < kept.length; i += IN_CHUNK) {
    const ids = kept.slice(i, i + IN_CHUNK).map(r => r.id)
    const { data, error } = await supabase.rpc('get_pool_excerpts', { ids, max_chars: EXCERPT_CHARS })
    if (error) throw new Error(`get_pool_excerpts: ${error.message}`)
    for (const row of (data ?? []) as Array<{ id: string; excerpt: string | null }>) excerpts.set(row.id, row.excerpt ?? '')
  }
  const handCandidates = kept.filter(r => isHandCandidate(r, opts.asOf, live))
  const events = handCandidates.length ? await loadEventsForItems(supabase, handCandidates.map(r => r.id)) : new Map()
  const handIds = handCandidates.filter(r => isHandItem({ id: r.id, metadata: r.metadata }, eventsAsOf(events.get(r.id) ?? [], opts.asOf))).map(r => r.id)
  const handSet = new Set(handIds)
  const items = kept.map(r => toSnapshotItem(r, excerpts.get(r.id) ?? '', handSet.has(r.id)))
  return { asOf: opts.asOf, windowFrom: from, items, truncated: raw.length >= LIMIT, excluded, handIds, techmemeStories: techmemeStoriesOf(items) }
}
export async function loadPoolEmbeddings(supabase: SupabaseAdmin, items: PoolSnapshotItem[], embed: EmbedTexts) {
  const embeddings = new Map<string, number[]>()
  const repo = await loadRepoEmbeddings(supabase, items.map(i => i.daily_repo_id).filter((x): x is string => !!x))
  for (const it of items) { const e = it.daily_repo_id ? repo.get(it.daily_repo_id) : undefined; if (e && e.length) embeddings.set(it.id, e) }
  const rest = items.filter(i => !embeddings.has(i.id))
  for (let i = 0; i < rest.length; i += IN_CHUNK) {
    const { data, error } = await supabase.from('curation_item_embeddings').select('item_id, embedding').in('item_id', rest.slice(i, i + IN_CHUNK).map(r => r.id))
    if (error) throw new Error(`curation_item_embeddings: ${error.message}`)
    for (const row of (data ?? []) as Array<{ item_id: string; embedding: unknown }>) { const e = parseEmbedding(row.embedding); if (e.length) embeddings.set(row.item_id, e) }
  }
  const todo = rest.filter(i => !embeddings.has(i.id))
  const guard = createEmbedFailGuard()
  let generated = 0, failed = 0
  for (let i = 0; i < todo.length; i += EMBED_BATCH) {
    const batch = todo.slice(i, i + EMBED_BATCH)
    try {
      const vectors = await embed(batch.map(b => prepareTextForEmbedding(b.title, b.excerpt)))
      const rows: Array<{ item_id: string; embedding: string }> = []
      batch.forEach((b, j) => { const v = vectors[j]; if (v && v.length) { embeddings.set(b.id, v); rows.push({ item_id: b.id, embedding: `[${v.join(',')}]` }); generated++ } else failed++ })
      if (rows.length) { const { error } = await supabase.from('curation_item_embeddings').upsert(rows, { onConflict: 'item_id' }); if (error) console.warn('[Curation] Embedding-Cache:', error.message) }
      guard.ok()
    } catch (err) {
      failed += batch.length
      if (guard.fail()) throw new Error(`embeddings: ${guard.count} Fehler in Folge — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { embeddings, generated, failed }
}
```
`createEmbedFailGuard` liefert laut `published-units-backfill.ts:157` ein Objekt — die Methodennamen (`ok`/`fail`/`count` sind hier angenommen) dort nachsehen und übernehmen.

- [ ] **Step 4: Tests + Typecheck** — `SUPABASE_SERVICE_ROLE_KEY= pnpm vitest run tests/lib/curation-pool.test.ts && pnpm typecheck`. Erwartet: PASS.

- [ ] **Step 5: Commit** — `git add lib/curation/pool.ts tests/lib/curation-pool.test.ts && git commit -m "feat(curation): pool.ts — Tages-Pool as-of, Excerpts per RPC, Hand-Begriff, Embeddings mit Cache"` (Body mit Spiegelstrichen: 48-h-Fenster, as-of-Status über poolExclusionAsOf, Techmeme/Hand überstehen Filter, get_pool_excerpts statt Volltext, daily_repo → Cache → on-the-fly; Trailer wie oben).

---

### Task 5: `lib/curation/cluster.ts` — Story-Schlüssel

**Files:**
- Create: `lib/curation/cluster.ts`
- Test: `tests/lib/curation-cluster.test.ts`

**Interfaces:**
- Consumes: `clusterByEmbedding`, `DEFAULT_DEDUP_THRESHOLD` (`semantic-dedup.ts:61, :19`); `cosineSimilarity` (`generator.ts:136`).
- Produces: Anhang A §3.4.

- [ ] **Step 1: Failing Tests** — `tests/lib/curation-cluster.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { clusterPool, handStoriesOf, leaderOf } from '@/lib/curation/cluster'
import type { PoolSnapshot, PoolSnapshotItem } from '@/lib/curation/types'

function item(id: string, p: Partial<PoolSnapshotItem> = {}): PoolSnapshotItem {
  return { id, title: id, source_identifier: 's', source_display_name: null, total_score: 1, bundle_type: null, metadata: null, content_length: 1000,
    daily_repo_id: null, queued_at: '2026-10-14T20:00:00.000Z', source_pub_rate: 0, excerpt: '', hand: false, techmeme_story: null, techmeme_story_index: null, ...p }
}
function snap(items: PoolSnapshotItem[]): PoolSnapshot {
  const tm = new Map<string, string[]>()
  for (const i of items) if (i.techmeme_story) tm.set(i.techmeme_story, [...(tm.get(i.techmeme_story) ?? []), i.id])
  return { asOf: '2026-10-15T04:25:00.000Z', windowFrom: '', items, truncated: false, excluded: { used_earlier: 0, expired: 0, skipped: 0, junk: 0, short: 0 },
    handIds: items.filter(i => i.hand).map(i => i.id), techmemeStories: [...tm].map(([story, member_ids], i) => ({ story, index: i, member_ids })) }
}
const E = (x: number, y: number) => [x, y, 0]

describe('clusterPool', () => {
  it('Hand-Item fuehrt den Cluster, aehnliches Pipeline-Item haengt daran', () => {
    const s = snap([item('pipe', { total_score: 9 }), item('hand', { hand: true, total_score: 2 })])
    const emb = new Map([['pipe', E(1, 0)], ['hand', E(0.99, 0.1)]])
    const r = clusterPool(s, emb)
    expect(r.storyKeyOf.hand).toBe('hand'); expect(r.storyKeyOf.pipe).toBe('hand')
    expect(r.clusters.hand).toEqual(['hand', 'pipe'])
  })
  it('Techmeme-Story: alle Member bekommen den Story-Key ohne Embedding, Anfuehrer zieht Pipeline-Items an', () => {
    const s = snap([item('t1', { techmeme_story: 'dots', total_score: 5 }), item('t2', { techmeme_story: 'dots', total_score: 8 }), item('p', { total_score: 3 })])
    const emb = new Map([['t2', E(0, 1)], ['p', E(0.05, 0.999)]])   // t1 ohne Embedding
    const r = clusterPool(s, emb)
    expect(r.storyKeyOf.t1).toBe('tm:dots'); expect(r.storyKeyOf.t2).toBe('tm:dots'); expect(r.storyKeyOf.p).toBe('tm:dots')
    expect(leaderOf(r, 'tm:dots')).toBe('t2')
  })
  it('Items ohne Embedding sind eigener Cluster; related listet Paare zwischen 0,65 und 0,8', () => {
    const s = snap([item('a', { total_score: 3 }), item('b', { total_score: 2 }), item('c', { total_score: 1 })])
    const emb = new Map([['a', E(1, 0)], ['b', E(0.72, 0.69)]])   // cos ≈ 0.72
    const r = clusterPool(s, emb)
    expect(r.storyKeyOf.c).toBe('c')
    expect(r.related).toHaveLength(1); expect(r.related[0][0]).toBe('a'); expect(r.related[0][1]).toBe('b')
  })
})
describe('handStoriesOf', () => {
  it('liefert je Hand-Story ALLE Member, auch Nicht-Hand-Quellen', () => {
    const s = snap([item('h', { hand: true }), item('p')])
    expect(handStoriesOf(s, { storyKeyOf: { h: 'h', p: 'h' }, clusters: { h: ['h', 'p'] }, related: [] })).toEqual({ h: ['h', 'p'] })
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen.**

- [ ] **Step 3: Implementieren**

```ts
import { clusterByEmbedding, DEFAULT_DEDUP_THRESHOLD } from '@/lib/news-queue/semantic-dedup'
import { cosineSimilarity } from '@/lib/embeddings/generator'
import type { ClusterResult, PoolSnapshot, PoolSnapshotItem } from '@/lib/curation/types'

const RELATED_MIN = 0.65, RELATED_MAX_PAIRS = 40
export function clusterPool(snapshot: PoolSnapshot, embeddings: Map<string, number[]>, threshold: number = DEFAULT_DEDUP_THRESHOLD): ClusterResult {
  const byId = new Map(snapshot.items.map(i => [i.id, i]))
  const byScore = (a: PoolSnapshotItem, b: PoolSnapshotItem) => b.total_score - a.total_score
  const storyKeyOf: Record<string, string> = {}
  const clusters: Record<string, string[]> = {}
  // Techmeme-Stories: Vor-Cluster ohne Embedding-Vergleich, Key 'tm:<story>', Anfuehrer = hoechster total_score
  const tmLeaders = new Map<string, string>()
  for (const st of snapshot.techmemeStories) {
    const members = st.member_ids.map(id => byId.get(id)!).filter(Boolean).sort(byScore)
    if (!members.length) continue
    const key = `tm:${st.story}`
    tmLeaders.set(members[0].id, key)
    clusters[key] = members.map(m => m.id)
    for (const m of members) storyKeyOf[m.id] = key
  }
  const hand = snapshot.items.filter(i => i.hand && !storyKeyOf[i.id]).sort(byScore)
  const leaders = snapshot.items.filter(i => tmLeaders.has(i.id))
  const rest = snapshot.items.filter(i => !i.hand && !storyKeyOf[i.id]).sort(byScore)
  const ordered = [...hand, ...leaders, ...rest]
  const result = clusterByEmbedding(ordered, ordered.map(i => embeddings.get(i.id) ?? []), threshold)
  for (const k of result.kept) { const key = tmLeaders.get(k.id) ?? k.id; storyKeyOf[k.id] = key; clusters[key] ??= [k.id] }
  for (const d of result.dropped) {
    const key = storyKeyOf[d.similarTo] ?? d.similarTo
    storyKeyOf[d.id] = key; (clusters[key] ??= []).push(d.id)
  }
  const leaderIds = result.kept.map(k => k.id)
  const related: Array<[string, string, number]> = []
  for (let i = 0; i < leaderIds.length; i++) for (let j = i + 1; j < leaderIds.length; j++) {
    const a = embeddings.get(leaderIds[i]), b = embeddings.get(leaderIds[j]); if (!a?.length || !b?.length) continue
    const sim = cosineSimilarity(a, b)
    if (sim >= RELATED_MIN && sim < threshold) related.push([storyKeyOf[leaderIds[i]], storyKeyOf[leaderIds[j]], Number(sim.toFixed(3))])
  }
  related.sort((x, y) => y[2] - x[2])
  return { storyKeyOf, clusters, related: related.slice(0, RELATED_MAX_PAIRS) }
}
export function handStoriesOf(snapshot: PoolSnapshot, cluster: ClusterResult): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const id of snapshot.handIds) { const key = cluster.storyKeyOf[id]; if (key && !out[key]) out[key] = cluster.clusters[key] ?? [id] }
  return out
}
export function leaderOf(cluster: ClusterResult, storyKey: string): string { return cluster.clusters[storyKey]?.[0] ?? storyKey }
```
WARUM `clusterByEmbedding` statt `assignStoryKeys`: es liefert `dropped[].similarTo` (den Anführer), das die Zuordnung zu Techmeme-Keys braucht; `assignStoryKeys` kennt nur IDs als Keys.

- [ ] **Step 4: Tests + Typecheck.** Erwartet: PASS.
- [ ] **Step 5: Commit** — `feat(curation): cluster.ts — Story-Schluessel: Hand zuerst, Techmeme-Stories vorgeclustert, related-Paare`.

---

### Task 6: `lib/curation/scout.ts` — Cards

**Files:**
- Create: `lib/curation/scout.ts`
- Test: `tests/lib/curation-scout.test.ts`

**Interfaces:**
- Consumes: `CallToolFn`, `CallInvalidError` (Task 2); Zod (`zod` 3.25); Tabelle `curation_cards`.
- Produces: Anhang A §3.5, Tool/Prompt §4.1.

- [ ] **Step 1: Failing Tests** — `tests/lib/curation-scout.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { batchesOf, fallbackCard, parseScoutOutput, scoutBatch, loadCachedCards, saveCards, SCOUT_TOOL } from '@/lib/curation/scout'
import { CallInvalidError } from '@/lib/ai/call'
// makeChain/state/client wie Task 3

const items = ['a', 'b', 'c', 'd'].map(id => ({ id, title: `T ${id}`, source_identifier: 'q', source_display_name: null, total_score: 1, bundle_type: null, metadata: null, content_length: 900, daily_repo_id: null, queued_at: '', source_pub_rate: 0, excerpt: `E ${id}`, hand: false, techmeme_story: null, techmeme_story_index: null }))

describe('parseScoutOutput', () => {
  it('ignoriert fremde IDs; unter 50 % Abdeckung → null', () => {
    const ids = new Set(['a', 'b', 'c', 'd'])
    expect(parseScoutOutput({ cards: [{ id: 'a', core: 'x' }, { id: 'zz', core: 'y' }, { id: 'b', core: 'z' }] }, ids)).toEqual(new Map([['a', 'x'], ['b', 'z']]))
    expect(parseScoutOutput({ cards: [{ id: 'a', core: 'x' }] }, ids)).toBeNull()
    expect(parseScoutOutput({ nope: 1 }, ids)).toBeNull()
  })
})
describe('scoutBatch', () => {
  it('liefert Cards und missing; bei CallInvalidError sind alle missing', async () => {
    const callTool = vi.fn(async (input: any) => ({ result: input.validate({ cards: [{ id: 'a', core: 'A!' }, { id: 'b', core: 'B!' }, { id: 'c', core: 'C!' }] }), model: 'h', tokens: {} as any, costUsd: 0.01, retried: false, strictDropped: false }))
    const r = await scoutBatch(callTool as any, items)
    expect(r.cards).toEqual([{ id: 'a', core: 'A!' }, { id: 'b', core: 'B!' }, { id: 'c', core: 'C!' }]); expect(r.missing).toEqual(['d']); expect(r.costUsd).toBe(0.01)
    expect(callTool.mock.calls[0][0]).toMatchObject({ useCase: 'curation_scout', tool: SCOUT_TOOL, thinking: false, maxTokens: 4096 })
    const bad = vi.fn(async () => { throw new CallInvalidError('curation_scout') })
    const r2 = await scoutBatch(bad as any, items)
    expect(r2.cards).toEqual([]); expect(r2.missing).toEqual(['a', 'b', 'c', 'd'])
  })
})
describe('Cache', () => {
  it('liest je Modell und schreibt per upsert', async () => {
    state.queues.curation_cards = [{ data: [{ item_id: 'a', core: 'aus Cache' }], error: null }, { data: null, error: null }]
    expect(await loadCachedCards(client, ['a', 'b'], 'h')).toEqual(new Map([['a', 'aus Cache']]))
    expect(state.chains.curation_cards[0].eq).toHaveBeenCalledWith('model', 'h')
    await saveCards(client, [{ id: 'b', core: 'neu' }], 'h')
    expect(state.chains.curation_cards[1].upsert).toHaveBeenCalledWith([{ item_id: 'b', model: 'h', core: 'neu' }], { onConflict: 'item_id,model' })
  })
})
it('batchesOf / fallbackCard', () => {
  expect(batchesOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  expect(fallbackCard(items[0])).toEqual({ id: 'a', core: 'T a' })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen.**

- [ ] **Step 3: Implementieren** — `SCOUT_TOOL`/`SCOUT_SYSTEM` aus §4.1; Zod `z.object({ cards: z.array(z.object({ id: z.string(), core: z.string().min(1) })) })`; `parseScoutOutput` filtert auf `batchIds`, dedupliziert (erste gewinnt), kappt `core` auf 240 Zeichen, liefert `null` wenn `< Math.ceil(batchIds.size / 2)` Treffer; `buildScoutUser(items)` = Zeilen `[${id}] ${title} — ${source_display_name ?? source_identifier} — ${excerpt}`; `scoutBatch` ruft `callTool({ useCase: 'curation_scout', system: SCOUT_SYSTEM, user: buildScoutUser(items), tool: SCOUT_TOOL, maxTokens: 4096, thinking: false, validate: raw => parseScoutOutput(raw, ids) })`, fängt `CallInvalidError` (→ `{ cards: [], missing: alle, costUsd: 0 }`), andere Fehler werfen; `loadCachedCards`: `.select('item_id, core').in('item_id', chunk).eq('model', model)` à 200; `saveCards`: `.upsert(rows, { onConflict: 'item_id,model' })`.

- [ ] **Step 4: Tests + Typecheck.** Erwartet: PASS.
- [ ] **Step 5: Commit** — `feat(curation): scout.ts — Kernsatz je Meldung per Haiku, Batches, Card-Cache`.

---

### Task 7: `lib/curation/archive.ts` — Archivbrief

**Files:**
- Create: `lib/curation/archive.ts`
- Test: `tests/lib/curation-archive.test.ts`

**Interfaces:**
- Consumes: `loadNegativeBlock` (`lib/curation/negatives.ts:128`, `{ days, asOf: Berlin-Tag }` → `{ text, units, approxTokens }`); `berlinDay`, `isoDayShift` (`precedents.ts:408, :420`); `cosineSimilarity`; `parseEmbedding`; RPC `get_precedent_units`; Tabellen `published_units`, `curation_runs`, `curation_units`, `queue_item_events`, `news_queue`, `settings`.
- Produces: Anhang A §3.6.

- [ ] **Step 1: Failing Tests** — `tests/lib/curation-archive.test.ts` (reine Teile ohne Mock; Lader mit makeChain + `client.rpc`):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildArchiveBrief, coverageHits, formatBrief, loadPrecedentUnits, roleSoftRange, techmemeAdoptionOf } from '@/lib/curation/archive'
// makeChain/state/client wie Task 3; client.rpc = vi.fn(async () => ({ data: [], error: null }))

describe('roleSoftRange', () => {
  it('min/median/max je Rolle ueber Posts; Posts ohne die Rolle zaehlen 0', () => {
    const r = roleSoftRange([['topic', 'topic', null], ['topic', 'recap', null, null], [null, null]])
    expect(r.topic).toEqual({ min: 0, median: 1, max: 2 }); expect(r.recap).toEqual({ min: 0, median: 0, max: 1 }); expect(r.none).toEqual({ min: 1, median: 2, max: 2 })
  })
})
describe('coverageHits', () => {
  it('ran ab 0,8, followups 0,6–0,8, je Kandidat nur der beste Treffer', () => {
    const cands = [{ id: 'a', title: 'A', embedding: [1, 0, 0] }, { id: 'b', title: 'B', embedding: [0, 1, 0] }]
    const cov = [
      { id: 'u1', post_id: 'p', heading: 'Lief schon', published_at: '2026-10-12T05:00:00.000Z', embedding: [0.99, 0.1, 0] },
      { id: 'u2', post_id: 'p', heading: 'Aehnlich', published_at: '2026-10-11T05:00:00.000Z', embedding: [0.7, 0.714, 0] },
      { id: 'u3', post_id: 'p', heading: 'Egal', published_at: '2026-10-11T05:00:00.000Z', embedding: [0, 0, 1] },
    ]
    const r = coverageHits(cands, cov)
    expect(r.ran.map(x => [x.candidate_id, x.heading])).toEqual([['a', 'Lief schon']])
    expect(r.followups.map(x => [x.candidate_id, x.heading])).toEqual([['b', 'Aehnlich']])
  })
})
describe('techmemeAdoptionOf', () => {
  it('Uebernahmequote je Story-Rang', () => {
    expect(techmemeAdoptionOf([{ story_index: 0, status: 'used' }, { story_index: 0, status: 'expired' }, { story_index: 3, status: 'expired' }]))
      .toEqual([{ index: 0, stories: 2, used: 1, rate: 0.5 }, { index: 3, stories: 1, used: 0, rate: 0 }])
  })
})
describe('formatBrief', () => {
  it('nummeriert Praezedenzen als P<n>, kappt Paare auf 60 und Panel auf 5 je Rolle und Seite', () => {
    const precedents = Array.from({ length: 3 }, (_, i) => ({ unit_id: `u${i}`, post_id: 'p', heading: `H${i}`, bundle_type: 'topic', published_at: '2026-10-10T05:00:00.000Z', similarity: 0.9 - i / 10, candidate_index: 0 }))
    const pairs = Array.from({ length: 80 }, (_, i) => ({ outcome: 'dropped_never_selected' as const, title: `T${i}`, role: null, final_role: null, day: '2026-10-10', heading: null }))
    const panel = { accepted: Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, title: `A${i}`, role: 'topic', at: '' })), rejected: [] }
    const r = formatBrief({ rules: 'Regel 1', softRange: { topic: { min: 0, median: 1, max: 2 } }, adoption: [], coverage: { ran: [], followups: [] }, precedents, negativeText: '', pairs, panel, candidateTitles: new Map([['c0', 'Kandidat']]) })
    expect(r.precedentIds).toEqual({ P1: 'u0', P2: 'u1', P3: 'u2' })
    expect(r.systemPrefix).toContain('Regel 1'); expect(r.systemPrefix).toContain('topic')
    expect((r.dayBlock.match(/^- T\d+/gm) ?? []).length).toBe(20)      // dropped_never_selected <= 20
    expect((r.dayBlock.match(/^- A\d+/gm) ?? []).length).toBe(5)
  })
})
describe('loadPrecedentUnits', () => {
  it('ruft die RPC mit pgvector-Strings', async () => {
    client.rpc = vi.fn(async () => ({ data: [{ unit_id: 'u', post_id: 'p', heading: 'H', bundle_type: null, published_at: 'x', similarity: 0.9, candidate_index: 1 }], error: null }))
    const r = await loadPrecedentUnits(client, [[1, 0], [0, 1]], '2026-10-15T04:25:00.000Z')
    expect(client.rpc).toHaveBeenCalledWith('get_precedent_units', { candidate_embeddings: ['[1,0]', '[0,1]'], before: '2026-10-15T04:25:00.000Z', per_role: 8 })
    expect(r[0].candidate_index).toBe(1)
  })
})
describe('buildArchiveBrief', () => {
  it('eine werfende Quelle landet in meta.missing, der Rest wird gebaut', async () => {
    client.rpc = vi.fn(async () => ({ data: null, error: { message: 'rpc kaputt' } }))
    state.fallback = { data: [], error: null }
    state.queues.settings = [{ data: null, error: null }]
    const brief = await buildArchiveBrief(client, { asOf: '2026-10-15T04:25:00.000Z', candidates: [{ id: 'a', title: 'A', embedding: [1, 0] }], briefMode: 'full', mode: 'shadow' })
    expect(brief.meta.missing).toContain('precedents')
    expect(typeof brief.systemPrefix).toBe('string'); expect(typeof brief.dayBlock).toBe('string')
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen.**

- [ ] **Step 3: Implementieren** — reine Funktionen vollständig, Lader nach den Query-Angaben in §3.6:

```ts
export function roleSoftRange(rolesByPost: Array<Array<string | null>>) {
  const roles = ['topic', 'recap', 'deep_dive', 'cover_story', 'none']
  const out: Record<string, { min: number; median: number; max: number }> = {}
  for (const role of roles) {
    const counts = rolesByPost.map(post => post.filter(r => (r ?? 'none') === role).length).sort((a, b) => a - b)
    if (!counts.length) continue
    out[role] = { min: counts[0], median: counts[Math.floor(counts.length / 2)], max: counts[counts.length - 1] }
  }
  return out
}
export function coverageHits(candidates: ArchiveCandidate[], coverage: CoverageUnit[]) {
  const ran: Hit[] = [], followups: Hit[] = []
  for (const c of candidates) {
    let best: { u: CoverageUnit; sim: number } | null = null
    for (const u of coverage) { if (!u.embedding.length || u.embedding.length !== c.embedding.length) continue; const sim = cosineSimilarity(c.embedding, u.embedding); if (!best || sim > best.sim) best = { u, sim } }
    if (!best) continue
    const hit = { candidate_id: c.id, heading: best.u.heading, published_at: best.u.published_at, sim: Number(best.sim.toFixed(3)) }
    if (best.sim >= 0.8) ran.push(hit); else if (best.sim >= 0.6) followups.push(hit)
  }
  return { ran, followups }
}
export function techmemeAdoptionOf(rows: Array<{ story_index: number; status: string }>) {
  const by = new Map<number, { stories: number; used: number }>()
  for (const r of rows) { const e = by.get(r.story_index) ?? { stories: 0, used: 0 }; e.stories++; if (r.status === 'used') e.used++; by.set(r.story_index, e) }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([index, e]) => ({ index, stories: e.stories, used: e.used, rate: e.stories ? e.used / e.stories : 0 }))
}
```
`formatBrief`: `systemPrefix` = Abschnitte „Betreiber-Regeln" (Text oder „keine"), „Rollen je Post (30 Tage): <role> min/median/max", „Techmeme-Übernahme je Rang: #<index> <used>/<stories>"; `dayBlock` = „Schon gelaufen (≥0,8)" (`- <kandidat-titel> ≈ „<heading>" (<datum>)`), „Nachlese-Kandidaten (0,6–0,8)", „Präzedenz-Einheiten" (`[P<n>] <heading> (<rolle ?? 'ohne Label'>, <datum>) ~ <kandidat-titel>`; Nummerierung in Reihenfolge des Arrays), `negativeText` (unverändert aus `loadNegativeBlock`), „Korrektur-Paare aus eigenen Plänen" (`- <title> [<role ?? '-'> → <outcome>(<final_role>)] <day>`; Kappung: alle `added`, alle `relabeled`, ≤ 10 `dropped_after_selection`, ≤ 20 `dropped_never_selected`, Hartgrenze 60 — zuerst added, dann relabeled, dann die jüngsten), „Panel: angenommen / abgelehnt" (≤ 5 je Rolle je Seite). `precedentIds` = `{ P1: unit_id, … }`. `approx_tokens = Math.ceil((systemPrefix.length + dayBlock.length) / 3.5)`.
`buildArchiveBrief`: `day = berlinDay(asOf)`; Quellen je in `try/catch` mit `meta.missing.push('<rules|softrange|coverage|precedents|negatives|pairs|panel|adoption>')`; `briefMode === 'none'` → nur `rules` + `softrange` + `adoption` laden; `'precedents-only'` → zusätzlich `coverage`, `precedents`, `negatives`; `'full'` → alles. Kandidaten-Embeddings für die RPC: alle `candidates` (Aufrufer kappt auf ≤ 120). Coverage-Fenster `[isoDayShift(day, -7) 00:00Z, asOf)`; Negativ `loadNegativeBlock(supabase, { days: 14, asOf: day })`; Paare: Runs `mode = input.mode`, `reconciled_at not null`, `asof in [asOf − 14 d, asOf)` → `curation_units` mit `outcome not null` (`.in('run_id', …)` à 200), Titel aus `run.pool.items` des jeweiligen Runs (erstes Member); Panel: `queue_item_events` `.in('event', ['panel_accept','panel_reject']).gte('at', asOf − 30 d).lt('at', asOf)` seitenweise, dann `news_queue` `.select('id, title, bundle_type').in('id', …)` à 200.
`loadPrecedentUnits`: `supabase.rpc('get_precedent_units', { candidate_embeddings: embs.map(v => \`[${v.join(',')}]\`), before, per_role: perRole })`; Fehler → `throw new Error('get_precedent_units: …')`.

- [ ] **Step 4: Tests + Typecheck.** Erwartet: PASS.
- [ ] **Step 5: Commit** — `feat(curation): archive.ts — Archivbrief (Regeln, Soft-Range, Coverage as-of, Praezedenz-RPC, Negativ-Block, Korrektur-Paare, Panel)`.

---

### Task 8: `lib/curation/compose.ts` — Chefredaktion

**Files:**
- Create: `lib/curation/compose.ts`
- Test: `tests/lib/curation-compose.test.ts`

**Interfaces:**
- Consumes: `CallToolFn` (Task 2); `mulberry32` (`baseline-metrics.ts:155`); `unitKeyOf` (`baseline-day.ts:877`) für `baselinePlan`; `handStoriesOf` (Task 5); Zod.
- Produces: Anhang A §3.7, Tool/Prompt §4.2–4.3.

- [ ] **Step 1: Failing Tests** — `tests/lib/curation-compose.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { baselinePlan, buildComposeMessages, composeDay, parseComposeOutput, unitKeyFor, validatePlan, COMPOSE_TOOL } from '@/lib/curation/compose'
import type { ClusterResult, PoolSnapshot, PoolSnapshotItem } from '@/lib/curation/types'
// item()/snap() wie in Task 5

const items = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => item(id, { total_score: 6 - 'abcdef'.indexOf(id), hand: id === 'c' }))
const snapshot = snap(items)
const cluster: ClusterResult = { storyKeyOf: { a: 'a', b: 'b', c: 'c', d: 'a', e: 'e', f: 'f' }, clusters: { a: ['a', 'd'], b: ['b'], c: ['c'], e: ['e'], f: ['f'] }, related: [] }
const raw = (units: Array<Record<string, unknown>>) => ({ thesis: 'T', units, techmeme_decisions: [], hand_story_decisions: [] })

describe('validatePlan', () => {
  it('entfernt unbekannte IDs, dedupliziert, kappt auf 5, mappt none→null, nummeriert je Tier, setzt is_hand', () => {
    const plan = validatePlan(raw([
      { member_ids: ['a', 'zz', 'a', 'd'], role: 'topic', rank: 7, tier: 'recommended', reason: 'x'.repeat(200), alternative: '', precedent_ids: ['P1', 'P9'] },
      { member_ids: ['zz'], role: 'none', rank: 1, tier: 'recommended', reason: 'weg', alternative: '', precedent_ids: [] },
      { member_ids: ['c'], role: 'none', rank: 2, tier: 'held', reason: 'hand', alternative: 'recap', precedent_ids: [] },
      { member_ids: ['b'], role: 'none', rank: 9, tier: 'quatsch', reason: 'b', alternative: '', precedent_ids: [] },
    ]), snapshot, cluster, { P1: 'unit-1' })
    expect(plan.units.map(u => [u.unit_key, u.tier, u.rank])).toEqual([['topic::a', 'recommended', 1], ['single::c', 'held', 1], ['single::b', 'bench', 1]])
    expect(plan.units[0].member_ids).toEqual(['a', 'd']); expect(plan.units[0].reason).toHaveLength(160); expect(plan.units[0].precedent_ids).toEqual(['unit-1'])
    expect(plan.units[1].is_hand).toBe(true); expect(plan.units[1].alternative).toBe('recap')
    expect(plan.fixes.join(' ')).toMatch(/unbekannt|leer|tier/i)
    expect(plan.source).toBe('model')
  })
  it('kappt > 5 Quellen auf die 5 mit hoechstem total_score', () => {
    const big = snap(['1', '2', '3', '4', '5', '6', '7'].map(id => item(id, { total_score: Number(id) })))
    const cl: ClusterResult = { storyKeyOf: Object.fromEntries(big.items.map(i => [i.id, '1'])), clusters: { '1': big.items.map(i => i.id) }, related: [] }
    const plan = validatePlan(raw([{ member_ids: ['1', '2', '3', '4', '5', '6', '7'], role: 'topic', rank: 1, tier: 'recommended', reason: 'r', alternative: '', precedent_ids: [] }]), big, cl, {})
    expect(plan.units[0].member_ids).toEqual(['7', '6', '5', '4', '3'])
  })
})
describe('baselinePlan', () => {
  it('total_score-Top-20: 1–10 recommended, Rest bench, Hand-Story ohne Platz → held', () => {
    const ids = Array.from({ length: 22 }, (_, i) => `i${i}`)
    const s = snap([...ids.map((id, i) => item(id, { total_score: 100 - i })), item('hand', { hand: true, total_score: 1 })])
    const cl: ClusterResult = { storyKeyOf: Object.fromEntries([...ids, 'hand'].map(id => [id, id])), clusters: Object.fromEntries([...ids, 'hand'].map(id => [id, [id]])), related: [] }
    const plan = baselinePlan(s, cl, { total_score: { '10': ids.slice(0, 10), '20': ids.slice(0, 20) } })
    expect(plan.units.filter(u => u.tier === 'recommended')).toHaveLength(10)
    expect(plan.units.filter(u => u.tier === 'bench')).toHaveLength(10)
    expect(plan.units.find(u => u.member_ids[0] === 'hand')?.tier).toBe('held')
    expect(plan.source).toBe('baseline')
  })
})
describe('buildComposeMessages', () => {
  it('Cards gemischt (seed-stabil), Hand markiert, Brief als Prefix', () => {
    const cards = items.map(i => ({ id: i.id, core: `K ${i.id}` }))
    const brief = { systemPrefix: 'PREFIX', dayBlock: 'TAG', precedentIds: {}, meta: {} as any }
    const a = buildComposeMessages({ cards, snapshot, cluster, brief, seed: 7 }), b = buildComposeMessages({ cards, snapshot, cluster, brief, seed: 7 })
    expect(a.user).toBe(b.user); expect(a.cachedPrefix).toContain('PREFIX'); expect(a.system).toContain('TAG')
    expect(a.user).toMatch(/\[c\][^\n]*HAND/)
  })
})
describe('composeDay', () => {
  it('ruft curation_editor mit 24k, effort medium und validiert', async () => {
    const callTool = vi.fn(async (input: any) => ({ result: input.validate(raw([{ member_ids: ['a'], role: 'topic', rank: 1, tier: 'recommended', reason: 'r', alternative: '', precedent_ids: [] }])), model: 'o', tokens: {} as any, costUsd: 0.9, retried: false, strictDropped: false }))
    const r = await composeDay(callTool as any, { cards: [], snapshot, cluster, brief: null, seed: 1 }, {})
    expect(callTool.mock.calls[0][0]).toMatchObject({ useCase: 'curation_editor', tool: COMPOSE_TOOL, maxTokens: 24000, effort: 'medium' })
    expect(r.plan.units[0].unit_key).toBe('topic::a'); expect(r.costUsd).toBe(0.9)
  })
})
it('unitKeyFor / parseComposeOutput', () => {
  expect(unitKeyFor(null, 'x')).toBe('single::x'); expect(unitKeyFor('recap', 'x')).toBe('recap::x')
  expect(parseComposeOutput({ thesis: 1 })).toBeNull()
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen.**

- [ ] **Step 3: Implementieren** — `COMPOSE_TOOL`, `COMPOSE_SYSTEM` wörtlich aus §4.2/4.3; Zod-Schema analog `RawComposePlan`; `validatePlan` nach §3.7 (Reihenfolge der Einheiten = Eingabe, Ränge je Tier neu ab 1; `fixes` mit lesbaren Meldungen `unbekannte ID <id> entfernt`, `Einheit ohne Member entfernt`, `tier '<x>' → bench`, `Quellen auf 5 gekappt (<key>)`, `doppelter unit_key <key> → bench#2`); `baselinePlan`: Gruppierung von `baseline.total_score['20']` per `unitKeyOf(id, item.bundle_type (nur techmeme+topic bleibt — wie neutralizeHandLabels), item.metadata)` in Listenreihenfolge; `buildComposeMessages`: `cachedPrefix = COMPOSE_SYSTEM + '\n\n' + (brief?.systemPrefix ?? '')`, `system = brief ? brief.dayBlock : 'Kein Archivbrief verfügbar (degradiert).'`, `user` = Abschnitte „Hand-Stories (jede genau einer Einheit zuordnen)" (`handStoriesOf` → je Story `s=<key>: <ids>`), „Techmeme-Stories" (`<story> #<index>: <ids>`), „Ähnliche Story-Paare (0,65–0,8)", „Cards" (seededShuffle über `mulberry32(seed)`: Fisher-Yates), je Card `[<id>] s=<story_key> q=<source_display_name ?? source_identifier> t=<total_score.toFixed(1)> <'HAND' wenn hand> <'TM:'+story wenn techmeme> — <title> — <core>`; bei `revisionHints`: Abschnitt „Revision — behebe:" + Hinweise + `previousPlan` als JSON.

- [ ] **Step 4: Tests + Typecheck.** Erwartet: PASS.
- [ ] **Step 5: Commit** — `feat(curation): compose.ts — compose_day-Tool, Prompt mit gemischten Cards, Validierung mit Bench-Ersatz, Baseline-Plan`.

---

### Task 9: `lib/curation/critic.ts` — Kritiker

**Files:**
- Create: `lib/curation/critic.ts`
- Test: `tests/lib/curation-critic.test.ts`

**Interfaces:**
- Consumes: `cosineSimilarity`; `handStoriesOf`, `leaderOf` (Task 5); `CallToolFn`.
- Produces: Anhang A §3.8, Tool §4.4.

- [ ] **Step 1: Failing Tests** — `tests/lib/curation-critic.test.ts` (Fixtures wie Task 8):

```ts
import { describe, expect, it, vi } from 'vitest'
import { checkHardRules, checkSoftRules, critiqueWithModel, revisionHints, CRITIC_TOOL } from '@/lib/curation/critic'
import type { ComposePlan, ComposeUnit } from '@/lib/curation/types'

function unit(p: Partial<ComposeUnit> & { member_ids: string[]; tier: ComposeUnit['tier']; rank: number }): ComposeUnit {
  return { unit_key: `${p.role ?? 'single'}::${p.member_ids[0]}`, story_key: p.member_ids[0], role: null, reason: '', alternative: null, precedent_ids: [], is_hand: false, ...p }
}
const plan = (units: ComposeUnit[]): ComposePlan => ({ thesis: '', units, techmeme_decisions: [], hand_story_decisions: [], fixes: [], source: 'model' })
const nine = (tier: ComposeUnit['tier'] = 'recommended', from = 0) => Array.from({ length: 9 }, (_, i) => unit({ member_ids: [`r${from + i}`], tier, rank: i + 1 }))
// snapshot: Items r0..r25 (source 'q<i%4>'), 'h1' hand, 'h2' hand in Story h1; cluster: alle eigene Stories ausser h2→h1

describe('checkHardRules', () => {
  it('Setzliste 9–11, Gesamt <= 20, eine cover_story, <= 5 Quellen, <= 30 % je Quelle', () => {
    const tooFew = plan(nine().slice(0, 8))
    expect(checkHardRules(tooFew, snapshot, cluster, new Map())).toContain('setzliste_size:8')
    const covers = plan([...nine().map((u, i) => (i < 2 ? { ...u, role: 'cover_story' as const } : u))])
    expect(checkHardRules(covers, snapshot, cluster, new Map()).some(c => c.startsWith('cover_count:2'))).toBe(true)
    const tooMany = plan([...nine(), ...nine('bench'), ...nine('bench', 9)])
    expect(checkHardRules(tooMany, snapshot, cluster, new Map()).some(c => c.startsWith('total_size:'))).toBe(true)
  })
  it('Hand-Invariante: fehlende Hand-Story, gesplittete Hand-Story, held ohne Hand', () => {
    const noHand = plan(nine())
    expect(checkHardRules(noHand, snapshot, cluster, new Map())).toContain('hand_missing:h1')
    const split = plan([...nine(), unit({ member_ids: ['h1'], tier: 'bench', rank: 1, is_hand: true }), unit({ member_ids: ['h2'], tier: 'bench', rank: 2, is_hand: true })])
    expect(checkHardRules(split, snapshot, cluster, new Map())).toContain('hand_split:h1')
    const heldWrong = plan([...nine(), unit({ member_ids: ['h1', 'h2'], tier: 'held', rank: 1, is_hand: true }), unit({ member_ids: ['r20'], tier: 'held', rank: 2 })])
    expect(checkHardRules(heldWrong, snapshot, cluster, new Map())).toContain('held_not_hand:single::r20')
  })
  it('story_duplicate bei gleichem Key oder Cosine >= 0,8 der Anfuehrer', () => {
    const dup = plan([...nine(), unit({ member_ids: ['h1', 'h2'], tier: 'bench', rank: 1, is_hand: true }), unit({ member_ids: ['r20'], tier: 'bench', rank: 2 }), unit({ member_ids: ['r21'], tier: 'bench', rank: 3 })])
    const emb = new Map([['r20', [1, 0]], ['r21', [0.95, 0.3]]])
    expect(checkHardRules(dup, snapshot, cluster, emb).some(c => c.startsWith('story_duplicate:'))).toBe(true)
  })
})
describe('checkSoftRules', () => {
  it('held > 5 und mehr als zwei Techmeme-Stories als topic/cover', () => {
    const many = plan([...nine(), ...Array.from({ length: 6 }, (_, i) => unit({ member_ids: [`h${i}`], tier: 'held', rank: i + 1, is_hand: true }))])
    expect(checkSoftRules(many, snapshot, cluster)).toContain('held_many:6')
  })
})
describe('critiqueWithModel', () => {
  it('ruft curation_critic mit effort low', async () => {
    const callTool = vi.fn(async (input: any) => ({ result: input.validate({ hard: ['x'], soft: [] }), model: 's', tokens: {} as any, costUsd: 0.05, retried: false, strictDropped: false }))
    const r = await critiqueWithModel(callTool as any, plan(nine()), snapshot, cluster, null)
    expect(callTool.mock.calls[0][0]).toMatchObject({ useCase: 'curation_critic', tool: CRITIC_TOOL, effort: 'low' })
    expect(r.hard).toEqual(['x'])
  })
})
it('revisionHints uebersetzt Codes', () => {
  expect(revisionHints(['setzliste_size:8', 'hand_missing:h1'])).toEqual([expect.stringContaining('9'), expect.stringContaining('h1')])
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen.**

- [ ] **Step 3: Implementieren** — `checkHardRules` nach §3.8: Setzliste = `units.filter(tier==='recommended')`; `total = recommended + bench`; `cover_count` über `role === 'cover_story'` in recommended ∪ bench; `sources_max` je Einheit `member_ids.length > 5`; `source_share`: je `source_identifier` Anteil der Setzlisten-Einheiten (Einheit zählt zur Quelle ihres ersten Members) `> 0.3` nur wenn Setzliste ≥ 4; `unknown_id`; `story_duplicate`: zwei Einheiten (recommended ∪ bench) mit gleichem `story_key` ODER `cosineSimilarity(emb(leaderA), emb(leaderB)) >= 0.8` (Anführer = erstes Member); `hand_missing`: jede Story aus `handStoriesOf` ohne Einheit, die ein Member enthält; `hand_split`: Hand-Story-Member in > 1 Einheit; `held_not_hand`: `tier === 'held' && !is_hand`. `checkSoftRules`: `held_many:<n>` (> 5), `label_conflict:<story_key>` (Einheiten derselben Hand-Story mit verschiedenen `role`), `techmeme_topics:<n>` (Einheiten mit `role in (topic, cover_story)` deren `story_key` mit `tm:` beginnt, > 2). `critiqueWithModel`: user = Plan als JSON (units ohne reason-Kürzung) + „Snapshot:" ID→Titel-Liste (`[<id>] <title>`) + Hard-Regel-Text; `maxTokens: 4096, effort: 'low'`; Zod `{ hard: string[], soft: string[] }`.

- [ ] **Step 4: Tests + Typecheck.** Erwartet: PASS.
- [ ] **Step 5: Commit** — `feat(curation): critic.ts — harte und weiche Regeln deterministisch, Sonnet-Kritiker, Revisionshinweise`.

---

### Task 10: `lib/curation/run.ts` — Phasenmaschine

**Files:**
- Create: `lib/curation/run.ts`
- Test: `tests/lib/curation-run.test.ts`

**Interfaces:**
- Consumes: Tasks 3–9 (alle Signaturen aus §3.2–3.8); `totalScoreListsByK` (`baseline-day.ts:864`, erwartet `PoolItem[]` — `PoolSnapshotItem` ist strukturell kompatibel: `id,title,source_identifier,total_score,bundle_type,metadata,content_length,daily_repo_id,queued_at`); `estimateUsd` (Task 2).
- Produces: Anhang A §3.9.

- [ ] **Step 1: Failing Tests** — `tests/lib/curation-run.test.ts`. Die Phasen-Module werden per `vi.mock` gestubbt (`@/lib/curation/pool`, `cluster`, `scout`, `archive`, `compose`, `critic`, `service`), damit die Maschine isoliert testbar ist:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  loadPoolAsOf: vi.fn(), loadPoolEmbeddings: vi.fn(), clusterPool: vi.fn(), scoutBatch: vi.fn(), loadCachedCards: vi.fn(), saveCards: vi.fn(),
  buildArchiveBrief: vi.fn(), composeDay: vi.fn(), baselinePlan: vi.fn(), checkHardRules: vi.fn(), checkSoftRules: vi.fn(), critiqueWithModel: vi.fn(),
  saveRunState: vi.fn(), appendRunLog: vi.fn(), finishRun: vi.fn(), insertUnits: vi.fn(), getRun: vi.fn(),
}))
vi.mock('@/lib/curation/pool', () => ({ loadPoolAsOf: m.loadPoolAsOf, loadPoolEmbeddings: m.loadPoolEmbeddings }))
vi.mock('@/lib/curation/cluster', () => ({ clusterPool: m.clusterPool, handStoriesOf: () => ({}), leaderOf: (c: any, k: string) => k }))
vi.mock('@/lib/curation/scout', () => ({ scoutBatch: m.scoutBatch, loadCachedCards: m.loadCachedCards, saveCards: m.saveCards, fallbackCard: (i: any) => ({ id: i.id, core: i.title }), batchesOf: (a: any[], n: number) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o } }))
vi.mock('@/lib/curation/archive', () => ({ buildArchiveBrief: m.buildArchiveBrief }))
vi.mock('@/lib/curation/compose', () => ({ composeDay: m.composeDay, baselinePlan: m.baselinePlan, buildComposeMessages: () => ({ cachedPrefix: 'p', system: 's', user: 'u' }) }))
vi.mock('@/lib/curation/critic', () => ({ checkHardRules: m.checkHardRules, checkSoftRules: m.checkSoftRules, critiqueWithModel: m.critiqueWithModel, revisionHints: (h: string[]) => h }))
vi.mock('@/lib/curation/service', async (orig) => ({ ...(await orig() as object), saveRunState: m.saveRunState, appendRunLog: m.appendRunLog, finishRun: m.finishRun, insertUnits: m.insertUnits, getRun: m.getRun }))
import { advanceRun, phaseCompose, reserveBudget, POOL_MIN_ITEMS } from '@/lib/curation/run'
import { DEFAULT_CURATION_SETTINGS } from '@/lib/curation/types'

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, title: `T${i}`, source_identifier: 'q', source_display_name: null, total_score: n - i, bundle_type: null, metadata: null, content_length: 1000, daily_repo_id: null, queued_at: '', source_pub_rate: 0, excerpt: '', hand: false, techmeme_story: null, techmeme_story_index: null }))
const snap = (n: number) => ({ asOf: '2026-10-15T04:25:00.000Z', windowFrom: '', items: items(n), truncated: false, excluded: { used_earlier: 0, expired: 0, skipped: 0, junk: 0, short: 0 }, handIds: [], techmemeStories: [] })
const run = (over: Partial<any> = {}) => ({ id: 'r', day: '2026-10-15', mode: 'shadow', asof: '2026-10-15T04:25:00.000Z', status: 'processing', phase: 'pool', brief_mode: 'full', attempts: 1, last_advanced_at: null, cancel_requested: false, log: [], degraded: [], budget_usd: 4, spend_usd: 0, compose_attempts: 0, pool: null, cards: null, story_keys: null, brief: null, baseline: null, plan: null, critique: null, reconciled_at: null, matched_post_id: null, matched_job_id: null, metrics: null, model_scout: 'h', model_editor: 'o', model_critic: 's', error_message: null, created_at: '', finished_at: null, ...over })
const deps = (over: Partial<any> = {}) => ({ supabase: {} as any, callTool: vi.fn(), embed: vi.fn(), settings: DEFAULT_CURATION_SETTINGS, models: { scout: 'h', editor: 'o', critic: 's' }, now: () => 0, budgetMs: 600_000, ...over })
const plan = (src: 'model' | 'baseline' = 'model') => ({ thesis: '', units: [], techmeme_decisions: [], hand_story_decisions: [], fixes: [], source: src })
beforeEach(() => { vi.clearAllMocks(); m.saveRunState.mockResolvedValue(undefined); m.appendRunLog.mockResolvedValue(undefined); m.finishRun.mockResolvedValue(undefined); m.checkSoftRules.mockReturnValue([]); m.baselinePlan.mockReturnValue(plan('baseline')) })

describe('advanceRun', () => {
  it('Pool unter 40 → error pool_small, kein Modellaufruf, keine Einheiten', async () => {
    m.loadPoolAsOf.mockResolvedValue(snap(12))
    const d = deps(); const r = await advanceRun(d, run())
    expect(r.finished).toBe(true); expect(m.finishRun).toHaveBeenCalledWith(d.supabase, 'r', 'error', `pool_small:12`)
    expect(d.callTool).not.toHaveBeenCalled(); expect(m.insertUnits).not.toHaveBeenCalled()
  })
  it('vor compose mit < 420 s Restbudget endet der Tick ohne Call', async () => {
    let t = 0
    const d = deps({ now: () => t, budgetMs: 600_000 })
    m.loadPoolAsOf.mockResolvedValue(snap(POOL_MIN_ITEMS)); m.loadCachedCards.mockResolvedValue(new Map()); m.scoutBatch.mockImplementation(async () => { t += 200_000; return { cards: [], missing: [], costUsd: 0.1 } })
    m.loadPoolEmbeddings.mockResolvedValue({ embeddings: new Map(), generated: 0, failed: 0 }); m.clusterPool.mockReturnValue({ storyKeyOf: {}, clusters: {}, related: [] })
    m.buildArchiveBrief.mockResolvedValue({ systemPrefix: '', dayBlock: '', precedentIds: {}, meta: { missing: [] } })
    const r = await advanceRun(d, run())
    expect(r.phase).toBe('compose'); expect(r.finished).toBe(false); expect(m.composeDay).not.toHaveBeenCalled()
  })
})
describe('phaseCompose', () => {
  const ready = () => run({ phase: 'compose', pool: snap(50), cards: [], story_keys: { storyKeyOf: {}, clusters: {}, related: [] }, brief: null, baseline: { total_score: { '10': [], '20': [] } } })
  it('Hard-Verstoss → genau eine Revision; nach zwei Versuchen Baseline-Plan + compose_fallback', async () => {
    m.composeDay.mockResolvedValue({ plan: plan(), costUsd: 0.5, model: 'o' }); m.checkHardRules.mockReturnValue(['cover_count:2']); m.critiqueWithModel.mockResolvedValue({ hard: [], soft: [], costUsd: 0.05 })
    const patch = await phaseCompose(deps(), ready())
    expect(m.composeDay).toHaveBeenCalledTimes(2); expect(patch.plan?.source).toBe('baseline'); expect(patch.degraded).toContain('compose_fallback'); expect(patch.compose_attempts).toBe(2)
  })
  it('Budget reicht nicht fuer den Kritiker → degraded critic, Plan bleibt', async () => {
    m.composeDay.mockResolvedValue({ plan: plan(), costUsd: 3.9, model: 'o' }); m.checkHardRules.mockReturnValue([])
    const patch = await phaseCompose(deps(), ready())
    expect(m.critiqueWithModel).not.toHaveBeenCalled(); expect(patch.degraded).toContain('critic'); expect(patch.plan?.source).toBe('model')
  })
  it('Budget reicht nicht fuer compose → Baseline-Plan + budget', async () => {
    const patch = await phaseCompose(deps(), { ...ready(), spend_usd: 3.95 })
    expect(m.composeDay).not.toHaveBeenCalled(); expect(patch.degraded).toContain('budget'); expect(patch.plan?.source).toBe('baseline')
  })
})
it('reserveBudget', () => { expect(reserveBudget(run({ spend_usd: 3 }), 0.9)).toBe(true); expect(reserveBudget(run({ spend_usd: 3 }), 1.1)).toBe(false) })
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen.**

- [ ] **Step 3: Implementieren** — Gerüst (vollständige Phasen nach §3.9):

```ts
export const TICK_BUDGET_MS = 600_000, COMPOSE_MIN_REMAINING_MS = 420_000, POOL_MIN_ITEMS = 40
const SCOUT_PARALLEL = 4, ARCHIVE_CANDIDATES = 80
export function reserveBudget(run: RunRow, usd: number): boolean { return run.spend_usd + usd <= run.budget_usd }
export function unitsFromPlan(plan: ComposePlan): UnitInsert[] {
  return plan.units.map(u => ({ unit_key: u.unit_key, member_ids: u.member_ids, story_key: u.story_key, role: u.role, rank: u.rank, tier: u.tier, reason: u.reason, alternative: u.alternative, precedent_ids: u.precedent_ids, is_hand: u.is_hand, panel_action: null, panel_at: null, outcome: null, final_role: null, final_rank: null, matched_post_id: null, matched_heading: null, similarity: null }))
}
export async function phasePool(deps: RunDeps, run: RunRow): Promise<Partial<RunRow>> {
  const pool = await loadPoolAsOf(deps.supabase, { asOf: run.asof, minContentLength: deps.settings.min_content_length, windowHours: deps.settings.pool_window_hours })
  if (pool.items.length < POOL_MIN_ITEMS) throw new Error(`pool_small:${pool.items.length}`)
  const lists = totalScoreListsByK(pool.items as unknown as PoolItem[], [10, 20])
  return { pool, baseline: { total_score: lists }, phase: 'scout' }
}
export async function phaseScout(deps: RunDeps, run: RunRow): Promise<Partial<RunRow>> {
  const items = run.pool!.items
  const cached = await loadCachedCards(deps.supabase, items.map(i => i.id), deps.models.scout)
  const todo = items.filter(i => !cached.has(i.id))
  const cards: ScoutCard[] = items.filter(i => cached.has(i.id)).map(i => ({ id: i.id, core: cached.get(i.id)! }))
  let spend = run.spend_usd, missing: string[] = []
  const batches = batchesOf(todo, deps.settings.scout_batch_size)
  for (let i = 0; i < batches.length; i += SCOUT_PARALLEL) {
    const results = await Promise.all(batches.slice(i, i + SCOUT_PARALLEL).map(b => scoutBatch(deps.callTool, b)))
    for (const r of results) { cards.push(...r.cards); missing.push(...r.missing); spend += r.costUsd; if (r.cards.length) await saveCards(deps.supabase, r.cards, deps.models.scout) }
  }
  const byId = new Map(items.map(i => [i.id, i]))
  for (const id of missing) cards.push(fallbackCard(byId.get(id)!))
  const degraded = missing.length > items.length * 0.1 ? uniq([...run.degraded, 'scout_partial']) : run.degraded
  return { cards, spend_usd: spend, degraded, phase: 'cluster' }
}
// phaseCluster: loadPoolEmbeddings → clusterPool → { story_keys, degraded(+'pool_embeddings' wenn failed > 0), phase:'archive' }
// phaseArchive: candidates = Anfuehrer der Top-80 nach total_score ∪ handIds ∪ Techmeme-Anfuehrer (mit Embedding, max 120) → buildArchiveBrief({ asOf, candidates, briefMode: run.brief_mode, mode: run.mode }) → { brief, degraded(+'archive' wenn meta.missing.length), phase:'compose' }
export async function phaseCompose(deps: RunDeps, run: RunRow): Promise<Partial<RunRow>> {
  const { pool, story_keys: cluster, brief, baseline } = run
  const embeddings = (await loadPoolEmbeddings(deps.supabase, pool!.items, deps.embed)).embeddings   // Cache-Treffer, keine neuen Calls
  let spend = run.spend_usd, attempts = run.compose_attempts, degraded = [...run.degraded]
  let hints: string[] | undefined, previous: ComposePlan | undefined, plan: ComposePlan | null = null, critique: Critique = { hard: [], soft: [], model_hard: [], model_soft: [] }
  const seed = Number(run.asof.slice(0, 10).replace(/-/g, '')) + attempts
  while (attempts < 2) {
    const msgs = buildComposeMessages({ cards: run.cards!, snapshot: pool!, cluster: cluster!, brief, seed, revisionHints: hints, previousPlan: previous })
    const estimate = estimateUsd(deps.models.editor, msgs.cachedPrefix.length + msgs.system.length + msgs.user.length, 24_000)
    if (!reserveBudget({ ...run, spend_usd: spend }, estimate)) { degraded = uniq([...degraded, 'budget']); break }
    attempts++; await saveRunState(deps.supabase, run.id, { compose_attempts: attempts, spend_usd: spend })   // VOR dem Call persistieren
    const res = await composeDay(deps.callTool, { cards: run.cards!, snapshot: pool!, cluster: cluster!, brief, seed, revisionHints: hints, previousPlan: previous }, brief?.precedentIds ?? {})
    spend += res.costUsd
    const hard = checkHardRules(res.plan, pool!, cluster!, embeddings), soft = checkSoftRules(res.plan, pool!, cluster!)
    let modelHard: string[] = [], modelSoft: string[] = []
    if (deps.settings.critic_enabled) {
      const est = estimateUsd(deps.models.critic, 30_000, 4_096)
      if (reserveBudget({ ...run, spend_usd: spend }, est)) { try { const c = await critiqueWithModel(deps.callTool, res.plan, pool!, cluster!, brief); modelHard = c.hard; modelSoft = c.soft; spend += c.costUsd } catch (e) { degraded = uniq([...degraded, 'critic']); deps.log?.(`[Curation] Kritiker: ${String(e)}`) } }
      else degraded = uniq([...degraded, 'critic'])
    }
    critique = { hard, soft, model_hard: modelHard, model_soft: modelSoft }
    plan = res.plan
    if (!hard.length) break
    hints = revisionHints(hard); previous = res.plan; plan = null
  }
  if (!plan) { plan = baselinePlan(pool!, cluster!, baseline!); degraded = uniq([...degraded, degraded.includes('budget') ? 'budget' : 'compose_fallback']) }
  return { plan, critique, spend_usd: spend, compose_attempts: attempts, degraded, phase: 'units' }
}
export async function phaseUnits(deps: RunDeps, run: RunRow): Promise<Partial<RunRow>> { await insertUnits(deps.supabase, run.id, unitsFromPlan(run.plan!)); return { phase: 'finished' } }
export async function advanceRun(deps: RunDeps, run: RunRow): Promise<{ phase: RunPhase; finished: boolean; note: string }> {
  const now = deps.now ?? Date.now, start = now(), budget = deps.budgetMs ?? TICK_BUDGET_MS
  const phases: Record<Exclude<RunPhase, 'finished'>, (d: RunDeps, r: RunRow) => Promise<Partial<RunRow>>> = { pool: phasePool, scout: phaseScout, cluster: phaseCluster, archive: phaseArchive, compose: phaseCompose, units: phaseUnits }
  let current = run
  while (current.phase !== 'finished') {
    const remaining = budget - (now() - start)
    if (remaining <= 0 || (current.phase === 'compose' && remaining < COMPOSE_MIN_REMAINING_MS)) return { phase: current.phase, finished: false, note: `Budget: ${Math.round(remaining / 1000)} s uebrig` }
    try {
      const patch = await phases[current.phase](deps, current)
      await saveRunState(deps.supabase, current.id, patch)
      await appendRunLog(deps.supabase, current, [{ at: stamp(), text: `Phase ${current.phase} fertig`, ok: true }])
      current = { ...current, ...patch }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.startsWith('pool_small')) { await finishRun(deps.supabase, current.id, 'error', msg); return { phase: current.phase, finished: true, note: msg } }
      throw err
    }
  }
  await finishRun(deps.supabase, current.id, 'done')
  return { phase: 'finished', finished: true, note: 'done' }
}
export async function runDayInline(deps: RunDeps, run: RunRow): Promise<RunRow> {
  let r = run
  for (;;) { const res = await advanceRun({ ...deps, budgetMs: Number.POSITIVE_INFINITY }, r); if (res.finished) break; r = (await getRun(deps.supabase, r.id))! }
  return (await getRun(deps.supabase, run.id))!
}
```
`uniq` = `[...new Set(x)]`. In `phaseCompose` ist bei fehlendem Budget für den ERSTEN Compose-Versuch `plan` null → Baseline mit `'budget'`; `'compose_fallback'` nur, wenn zwei Versuche mit Hard-Verstößen endeten.

- [ ] **Step 4: Tests + Typecheck.** Erwartet: PASS.
- [ ] **Step 5: Commit** — `feat(curation): run.ts — Phasenmaschine mit Tick-Budget, Compose-Revision, Baseline-Fallback, Budget-Reservierung`.

---

### Task 11: `lib/curation/reconcile.ts` — Rekonziliation und Metriken

**Files:**
- Create: `lib/curation/reconcile.ts`
- Test: `tests/lib/curation-reconcile.test.ts`

**Interfaces:**
- Consumes: `processPost`, `PostRow`, `EmbedTexts` (`published-units-backfill.ts:102, :77, :20`); `precedentSelectedItems`, `berlinDay` (`precedents.ts:442, :408`); `assignStoryKeys`, `unitRecallAtK`, `precisionAtK`, `unitDuplicateRate`, `pairedBootstrap`, `mdeAtN` (`baseline-metrics.ts`); `unitListsByK`, `unitCappedMetricsOf` (`baseline-day.ts:895, :1024`); `loadPoolEmbeddings` (Task 4); `cosineSimilarity`, `parseEmbedding`; Service-Funktionen (Task 3).
- Produces: Anhang A §3.10.

- [ ] **Step 1: Failing Tests** — `tests/lib/curation-reconcile.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { aggregateRuns, metricsOf, pickMatchingPost, reconcileOutcomes } from '@/lib/curation/reconcile'
import type { RunMetrics, UnitRow } from '@/lib/curation/types'

const ASOF = '2026-10-15T04:25:00.000Z'
describe('pickMatchingPost', () => {
  const post = (id: string, created_at: string, published_at: string | null, status = 'published') => ({ id, status, created_at, published_at })
  it('bevorzugt den manuellen Job des Tages (published_at kann durch den Backfill spaet liegen)', () => {
    const r = pickMatchingPost(ASOF, { jobs: [{ id: 'j', created_at: '2026-10-15T05:10:00.000Z', generated_post_id: 'p', selected_items: [], source: 'manual' }], posts: [post('p', '2026-10-15T05:00:00.000Z', '2026-10-20T09:00:00.000Z')] })
    expect(r).toEqual({ post_id: 'p', job_id: 'j', attribution: 'job' })
  })
  it('sonst fruehester Post mit published_at in (asof, asof+24h]; dann Tag von created_at; sonst null', () => {
    expect(pickMatchingPost(ASOF, { jobs: [], posts: [post('b', '2026-10-15T06:00:00.000Z', '2026-10-15T07:00:00.000Z'), post('a', '2026-10-15T05:00:00.000Z', '2026-10-15T06:30:00.000Z')] })).toMatchObject({ post_id: 'a', attribution: 'published_at' })
    expect(pickMatchingPost(ASOF, { jobs: [], posts: [post('c', '2026-10-15T06:00:00.000Z', '2026-10-18T07:00:00.000Z')] })).toMatchObject({ post_id: 'c', attribution: 'created_at_day' })
    expect(pickMatchingPost(ASOF, { jobs: [], posts: [post('d', '2026-10-16T06:00:00.000Z', '2026-10-16T07:00:00.000Z')] })).toBeNull()
    expect(pickMatchingPost(ASOF, { jobs: [{ id: 'auto', created_at: '2026-10-15T05:00:00.000Z', generated_post_id: 'x', selected_items: [], source: 'auto' }], posts: [post('x', '2026-10-15T05:00:00.000Z', '2026-10-15T05:30:00.000Z')] })).toMatchObject({ attribution: 'published_at' })
  })
})
const unit = (p: Partial<UnitRow> & { unit_key: string; member_ids: string[]; tier: UnitRow['tier'] }): UnitRow => ({ id: p.unit_key, run_id: 'r', story_key: p.member_ids[0], role: null, rank: 1, reason: null, alternative: null, precedent_ids: [], is_hand: false, panel_action: null, panel_at: null, outcome: null, final_role: null, final_rank: null, matched_post_id: null, matched_heading: null, similarity: null, created_at: '', ...p })
const pub = (id: string, member_ids: string[], bundle_type: string | null = null, embedding: number[] | null = null, position = 0) => ({ id, position, heading: `H ${id}`, bundle_type, member_ids, embedding })

describe('reconcileOutcomes', () => {
  it('ID-Treffer kept/relabeled, Similarity merged, dropped_after_selection vs never, added', () => {
    const units = [
      unit({ unit_key: 'topic::a', member_ids: ['a'], tier: 'recommended', role: 'topic' }),
      unit({ unit_key: 'single::b', member_ids: ['b'], tier: 'recommended', rank: 2 }),
      unit({ unit_key: 'single::c', member_ids: ['c'], tier: 'bench' }),
      unit({ unit_key: 'single::d', member_ids: ['d'], tier: 'bench', rank: 2 }),
      unit({ unit_key: 'single::e', member_ids: ['e'], tier: 'held', is_hand: true }),
    ]
    const published = [pub('u1', ['a'], 'topic', [1, 0, 0], 0), pub('u2', ['b'], 'recap', [0, 1, 0], 1), pub('u3', [], null, [0, 0, 1], 2), pub('u4', ['zz'], null, [0.5, 0.5, 0.7], 3)]
    const emb = new Map([['c', [0, 0, 1]], ['d', [1, 1, 0]]])
    const r = reconcileOutcomes(units, published, emb, new Set(['d', 'e']), 'post', 0.8)
    const by = Object.fromEntries(r.outcomes.map(o => [o.unit_key, o]))
    expect(by['topic::a']).toMatchObject({ outcome: 'kept', final_role: 'topic', final_rank: 1 })
    expect(by['single::b']).toMatchObject({ outcome: 'relabeled', final_role: 'recap' })
    expect(by['single::c']).toMatchObject({ outcome: 'merged', matched_heading: 'H u3' })
    expect(by['single::d'].outcome).toBe('dropped_after_selection'); expect(by['single::e'].outcome).toBe('dropped_after_selection')
    expect(r.added.map(a => a.id)).toEqual(['u4'])
  })
})
describe('metricsOf', () => {
  it('Unit-Recall@20 auf Story-Ebene, Setzlisten-Precision, cut_rate, additions, held_rate', () => {
    const units = [unit({ unit_key: 'single::a', member_ids: ['a'], tier: 'recommended' }), unit({ unit_key: 'single::b', member_ids: ['b'], tier: 'recommended', rank: 2 }), unit({ unit_key: 'single::c', member_ids: ['c'], tier: 'bench' }), unit({ unit_key: 'single::h', member_ids: ['h'], tier: 'held', is_hand: true })]
    const published = [pub('u1', ['a']), pub('u2', ['c']), pub('u3', ['x'])]
    const outcomes = [{ unit_key: 'single::a', outcome: 'kept' as const, final_role: null, final_rank: 1, matched_post_id: 'p', matched_heading: 'H u1', similarity: 1 }, { unit_key: 'single::b', outcome: 'dropped_after_selection' as const, final_role: null, final_rank: null, matched_post_id: null, matched_heading: null, similarity: null }, { unit_key: 'single::c', outcome: 'kept' as const, final_role: null, final_rank: 2, matched_post_id: 'p', matched_heading: 'H u2', similarity: 1 }, { unit_key: 'single::h', outcome: 'dropped_after_selection' as const, final_role: null, final_rank: null, matched_post_id: null, matched_heading: null, similarity: null }]
    const snapshot = { asOf: ASOF, windowFrom: '', items: ['a', 'b', 'c', 'h', 'x'].map(id => ({ id, title: id, source_identifier: 'q', source_display_name: null, total_score: 1, bundle_type: null, metadata: null, content_length: 1000, daily_repo_id: null, queued_at: '', source_pub_rate: 0, excerpt: '', hand: id === 'h', techmeme_story: null, techmeme_story_index: null })), truncated: false, excluded: { used_earlier: 0, expired: 0, skipped: 0, junk: 0, short: 0 }, handIds: ['h'], techmemeStories: [] }
    const cluster = { storyKeyOf: { a: 'a', b: 'b', c: 'c', h: 'h', x: 'x' }, clusters: {}, related: [] }
    const m = metricsOf({ units, outcomes, published, added: [published[2]], baseline: { total_score: { '10': ['x', 'a'], '20': ['x', 'a'] } }, snapshot, cluster, itemEmbeddings: new Map(), attribution: 'job' })
    expect(m.unit_recall_20).toBeCloseTo(2 / 3); expect(m.setzlisten_recall_10).toBeCloseTo(1 / 3); expect(m.setzlisten_precision_10).toBeCloseTo(0.5)
    expect(m.cut_rate).toBeCloseTo(0.5); expect(m.additions).toBe(1); expect(m.additions_rate).toBeCloseTo(1 / 3); expect(m.held_rate).toBe(1)
    expect(m.baseline_total_score_unit_recall_20).toBeCloseTo(2 / 3); expect(m.diff_vs_total_score_20).toBeCloseTo(0)
    expect(m.outcomes.kept).toBe(2)
  })
})
describe('aggregateRuns', () => {
  it('mittelt nur attribuierte Tage; Gate-Felder', () => {
    const mk = (u: number, b: number): RunMetrics => ({ attribution: 'job', published_units: 9, published_attributable: 9, plan: { recommended: 10, bench: 10, held: 0 }, unit_recall_20: u, unit_recall_id_20: u, setzlisten_recall_10: 0.4, setzlisten_precision_10: 0.5, duplicate_rate_recommended: 0, cut_rate: 0.3, additions: 1, additions_rate: 0.1, hand_stories: 2, held_rate: 0, baseline_total_score_unit_recall_20: b, baseline_total_score_recall_10: 0.2, diff_vs_total_score_20: u - b, outcomes: { kept: 0, relabeled: 0, merged: 0, dropped_after_selection: 0, dropped_never_selected: 0, added: 0 } })
    const list = [...Array.from({ length: 6 }, () => mk(0.6, 0.4)), { ...mk(0, 0), attribution: 'none' as const }]
    const a = aggregateRuns(list, 0.42)
    expect(a.n).toBe(6); expect(a.mean.unit_recall_20).toBeCloseTo(0.6); expect(a.diff_vs_total_score_20.mean).toBeCloseTo(0.2)
    expect(a.gate.floor).toBe(true); expect(a.gate.duplicates_zero).toBe(true); expect(a.gate.precision_vs_hand).toBe(true)
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen.**

- [ ] **Step 3: Implementieren** — nach §3.10. `pickMatchingPost`: Job-Treffer nur `source === 'manual'` mit Post `status === 'published'` und `created_at` im Fenster `[asOf − 2 h, asOf + 24 h]`, jüngster; dann `published_at`-Fenster `(asOf, asOf + 24 h]`, frühester; dann `berlinDay(created_at) === berlinDay(asOf)`. `reconcileOutcomes`: Reihenfolge recommended (rank asc) → bench → held; Pass 1 ID-Treffer, Pass 2 Similarity (nur Einheiten ohne Treffer, nur published ohne Treffer; `max over members` von `cosineSimilarity(itemEmbeddings.get(member), unit.embedding)`), `similarity` als `Number(x.toFixed(3))`; `final_rank = position + 1`. `metricsOf`: `storyOf = assignStoryKeys(uniqueIds, itemEmbeddings, 0.8)` — für Items ohne Embedding eigener Key; aber Plan-Treffer sollen auch ohne Embedding über die Outcomes zählen: Treffer-Definition für Recall = Einheit hat `outcome in (kept, relabeled, merged)`; `unit_recall_20 = |published units mit Plan-Treffer in recommended ∪ bench| / published.length`; `setzlisten_recall_10 = |published mit Treffer aus recommended Rang 1–10| / published.length`; `setzlisten_precision_10 = Treffer in recommended Rang 1–10 / min(10, |recommended|)`; `unit_recall_id_20` nur ID-Treffer (kept/relabeled); `duplicate_rate_recommended = unitDuplicateRate(ids der recommended, unitOf = unit_key, storyOf)`; `cut_rate = recommended mit dropped_after_selection / |recommended|`; `additions_rate = added.length / published.length`; `held_rate = held / hand_stories` (hand_stories = Anzahl Hand-Einheiten über alle Tiers); Baseline: `unitListsByK(baseline.total_score['20'], id => unitKeyOf(id, bundle_type, metadata), [10, 20])` → `unitCappedMetricsOf(lists, publishedAsBaselineUnits, covered, storyOf, [10, 20])` mit `publishedAsBaselineUnits = published.map(p => ({ memberIds: p.member_ids }))` → `unit_recall['20']`, `unit_recall['10']`; `diff = unit_recall_20 − baseline`. Division durch 0 → 0. `reconcileRun` nach §3.10 (Post-Zeile `select('id, content, published_at')`; `processPost(supabase, embed, post, false)`; danach `published_units` `.select('id, position, heading, bundle_type, member_ids, embedding').eq('post_id', postId).order('position')`, Embeddings via `parseEmbedding`; `selected_items` des Jobs: `article_jobs.select('selected_items').eq('id', jobId)` → `precedentSelectedItems(raw).map(i => i.id)`; Item-Embeddings: `loadPoolEmbeddings(supabase, snapshot.items, embed)` — ohne neue Calls für gecachte). `aggregateRuns`: `pairedBootstrap(diffs)` aus `baseline-metrics.ts:188`; `recall_gain = n >= 5 ? mean >= 0.10 && lo90 > 0 : null`.

- [ ] **Step 4: Tests + Typecheck.** Erwartet: PASS.
- [ ] **Step 5: Commit** — `feat(curation): reconcile.ts — Attribution Job→published_at→Tag, published_units nachpflegen, Outcomes, Metriken, Gate-Aggregation`.

---

### Task 12: Cron-Route `app/api/cron/curation-jobs/route.ts` + `vercel.json`

**Files:**
- Create: `app/api/cron/curation-jobs/route.ts`
- Modify: `vercel.json` (`crons`: `{ "path": "/api/cron/curation-jobs", "schedule": "*/1 * * * *" }` hinter `article-jobs`)
- Test: `tests/api/curation-jobs-route.test.ts`

**Interfaces:**
- Consumes: `verifyCronAuth` (`lib/security/cron-auth.ts:54`, `{ authorized }`); Service (Task 3); `advanceRun` (Task 10); `reconcileRun` (Task 11); `createCaller` (Task 2); `generateEmbeddings`; `berlinDay`.
- Produces: `GET /api/cron/curation-jobs` → immer HTTP 200 mit `{ ok, kickoff?, reconciled?, advanced?, idle? }`.

- [ ] **Step 1: Failing Tests** — `tests/api/curation-jobs-route.test.ts` (Muster `tests/api/glossary-jobs-route.test.ts:7-33`):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  verifyCronAuth: vi.fn(() => ({ authorized: true })), loadCurationSettings: vi.fn(), createRun: vi.fn(), spentTodayUsd: vi.fn(async () => 0),
  getRunsToReconcile: vi.fn(async () => []), reconcileRun: vi.fn(), getNextOpenRun: vi.fn(async () => null), claimRun: vi.fn(), releaseLease: vi.fn(),
  finishRun: vi.fn(), appendRunLog: vi.fn(), advanceRun: vi.fn(), listTodayRuns: vi.fn(async () => []),
}))
vi.mock('@/lib/security/cron-auth', () => ({ verifyCronAuth: m.verifyCronAuth }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/curation/service', async (orig) => ({ ...(await orig() as object), loadCurationSettings: m.loadCurationSettings, createRun: m.createRun, spentTodayUsd: m.spentTodayUsd, getRunsToReconcile: m.getRunsToReconcile, getNextOpenRun: m.getNextOpenRun, claimRun: m.claimRun, releaseLease: m.releaseLease, finishRun: m.finishRun, appendRunLog: m.appendRunLog, listRuns: m.listTodayRuns }))
vi.mock('@/lib/curation/run', () => ({ advanceRun: m.advanceRun }))
vi.mock('@/lib/curation/reconcile', () => ({ reconcileRun: m.reconcileRun }))
vi.mock('@/lib/ai/call', () => ({ createCaller: () => ({ callTool: vi.fn(), modelFor: async (u: string) => `model-${u}` }) }))
vi.mock('@/lib/embeddings/generator', () => ({ generateEmbeddings: vi.fn() }))
import { DEFAULT_CURATION_SETTINGS } from '@/lib/curation/types'
const req = () => new Request('https://x/api/cron/curation-jobs') as any
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T04:26:00.000Z')); m.loadCurationSettings.mockResolvedValue({ ...DEFAULT_CURATION_SETTINGS, shadow_enabled: true }) })

describe('GET /api/cron/curation-jobs', () => {
  it('401 ohne Cron-Auth', async () => {
    m.verifyCronAuth.mockReturnValueOnce({ authorized: false } as any)
    const { GET } = await import('@/app/api/cron/curation-jobs/route')
    expect((await GET(req())).status).toBe(401)
  })
  it('Kickoff legt den Tages-Run an, wenn shadow_enabled, Zeit erreicht und kein Run fuer heute', async () => {
    m.createRun.mockResolvedValue({ id: 'r', status: 'pending' })
    const { GET } = await import('@/app/api/cron/curation-jobs/route')
    const body = await (await GET(req())).json()
    expect(m.createRun).toHaveBeenCalledWith({}, expect.objectContaining({ day: '2026-10-15', mode: 'shadow', asof: '2026-10-15T04:25:00.000Z', brief_mode: 'full', budget_usd: 4, models: { scout: 'model-curation_scout', editor: 'model-curation_editor', critic: 'model-curation_critic' } }))
    expect(body.kickoff).toBe('r')
  })
  it('kein Kickoff bei shadow_enabled=false, vor der Zeit oder bei erschoepfter Tageskappe', async () => {
    const { GET } = await import('@/app/api/cron/curation-jobs/route')
    m.loadCurationSettings.mockResolvedValueOnce({ ...DEFAULT_CURATION_SETTINGS, shadow_enabled: false }); await GET(req()); expect(m.createRun).not.toHaveBeenCalled()
    vi.setSystemTime(new Date('2026-10-15T04:20:00.000Z')); await GET(req()); expect(m.createRun).not.toHaveBeenCalled()
    vi.setSystemTime(new Date('2026-10-15T04:30:00.000Z')); m.spentTodayUsd.mockResolvedValueOnce(12); await GET(req()); expect(m.createRun).not.toHaveBeenCalled()
  })
  it('Rekonziliation hat Vorrang vor advance; danach idle', async () => {
    m.getRunsToReconcile.mockResolvedValueOnce([{ id: 'old', asof: '2026-10-14T04:25:00.000Z' }]); m.reconcileRun.mockResolvedValue({ matched: { post_id: 'p', job_id: 'j', attribution: 'job' }, metrics: {} })
    m.listTodayRuns.mockResolvedValue([{ id: 'today', day: '2026-10-15', mode: 'shadow', status: 'done' }])
    const { GET } = await import('@/app/api/cron/curation-jobs/route')
    const body = await (await GET(req())).json()
    expect(body.reconciled).toBe('old'); expect(m.advanceRun).not.toHaveBeenCalled()
  })
  it('advance: attempts >= MAX_ATTEMPTS → error vor der Arbeit; Exception → Log + Lease frei + ok:false', async () => {
    m.listTodayRuns.mockResolvedValue([{ id: 'r', day: '2026-10-15', mode: 'shadow', status: 'processing' }])
    m.getNextOpenRun.mockResolvedValueOnce({ id: 'r', attempts: 10, log: [] })
    const { GET } = await import('@/app/api/cron/curation-jobs/route')
    await GET(req()); expect(m.finishRun).toHaveBeenCalledWith({}, 'r', 'error', expect.stringContaining('10'))
    m.getNextOpenRun.mockResolvedValueOnce({ id: 'r', attempts: 1, log: [] }); m.advanceRun.mockRejectedValueOnce(new Error('kaputt'))
    const body = await (await GET(req())).json()
    expect(m.claimRun).toHaveBeenCalledWith({}, 'r', 2); expect(m.releaseLease).toHaveBeenCalledWith({}, 'r'); expect(body.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen.**

- [ ] **Step 3: Route implementieren**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createCaller } from '@/lib/ai/call'
import { generateEmbeddings } from '@/lib/embeddings/generator'
import { berlinDay } from '@/lib/curation/precedents'
import { appendRunLog, claimRun, createRun, finishRun, getNextOpenRun, getRunsToReconcile, kickoffAsOf, listRuns, loadCurationSettings, releaseLease, spentTodayUsd, stamp, MAX_ATTEMPTS } from '@/lib/curation/service'
import { advanceRun, TICK_BUDGET_MS } from '@/lib/curation/run'
import { reconcileRun } from '@/lib/curation/reconcile'

export const maxDuration = 800   // wie app/api/cron/article-jobs/route.ts:6 (Pro-Plan); TICK_BUDGET_MS 600 s laesst 200 s fuer Protokoll und Antwort
export const runtime = 'nodejs'

/** Minutentick der Morgenkonferenz (Phase 1 Shadow): Kickoff → Rekonziliation des Vortags → eine Arbeitseinheit. Immer 200 (Vercel fuehrt den Cron sonst als fehlgeschlagen). */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request).authorized) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = createAdminClient()
  const settings = await loadCurationSettings(supabase)
  const nowIso = new Date().toISOString()
  const out: Record<string, unknown> = { ok: true }
  const embed = (texts: string[]) => generateEmbeddings(texts, { batchSize: 16 })

  // 1 Kickoff — fester UTC-Slot (Phase 1); Analyse-Bedingung und Deadline kommen in Phase 2.
  if (settings.shadow_enabled) {
    const asof = kickoffAsOf(nowIso, settings.kickoff_utc)
    if (asof) {
      const day = berlinDay(asof)
      const today = (await listRuns(supabase, { limit: 5, mode: 'shadow' })).filter(r => r.day === day)
      const spent = await spentTodayUsd(supabase, day)
      if (!today.length && spent < settings.daily_budget_usd) {
        const { modelFor } = createCaller({ runId: 'kickoff', mode: 'shadow' })
        const run = await createRun(supabase, { day, mode: 'shadow', asof, brief_mode: 'full', budget_usd: settings.budget_usd,
          models: { scout: await modelFor('curation_scout'), editor: await modelFor('curation_editor'), critic: await modelFor('curation_critic') } })
        out.kickoff = run.id
      }
    }
  }
  // 2 Rekonziliation des Vortags (eine je Tick, kurz)
  const [due] = await getRunsToReconcile(supabase, nowIso, 1)
  if (due) {
    try { const r = await reconcileRun(supabase, due, embed); out.reconciled = due.id; out.attribution = r.matched?.attribution ?? 'none' }
    catch (err) { console.error('[Curation] Rekonziliation fehlgeschlagen:', err); out.reconcile_error = err instanceof Error ? err.message : String(err) }
    return NextResponse.json(out)
  }
  // 3 Advance — eine Arbeitseinheit je Tick (Muster app/api/cron/glossary-jobs/route.ts)
  const run = await getNextOpenRun(supabase)
  if (!run) return NextResponse.json({ ...out, idle: true })
  if (run.attempts >= MAX_ATTEMPTS) {
    await finishRun(supabase, run.id, 'error', `Nach ${MAX_ATTEMPTS} Durchgaengen ohne Fortschritt aufgegeben (Function-Timeout?). Server-Log pruefen.`)
    return NextResponse.json({ ...out, ok: false, error: 'max attempts' })
  }
  const attempt = run.attempts + 1
  await claimRun(supabase, run.id, attempt); run.attempts = attempt
  const { callTool } = createCaller({ runId: run.id, mode: 'shadow' })
  try {
    const res = await advanceRun({ supabase, callTool, embed, settings, models: { scout: run.model_scout!, editor: run.model_editor!, critic: run.model_critic! }, budgetMs: TICK_BUDGET_MS, log: (t) => console.log(t) }, run)
    return NextResponse.json({ ...out, advanced: run.id, ...res })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unbekannt'
    console.error('[Curation] Tick fehlgeschlagen:', err)
    await appendRunLog(supabase, run, [{ at: stamp(), text: `Tick fehlgeschlagen: ${message}`, ok: false }])
    await releaseLease(supabase, run.id)
    return NextResponse.json({ ...out, ok: false, advanced: run.id, error: message })
  }
}
```
`listRuns` nimmt hier den Platz einer eigenen `listTodayRuns`-Funktion ein (Filter clientseitig auf `day`).

- [ ] **Step 4: `vercel.json`** — Cron-Eintrag ergänzen. Hinweis: Vercel-Crons senden `Authorization: Bearer <CRON_SECRET>`; `verifyCronAuth` prüft genau das.

- [ ] **Step 5: Tests + Typecheck** — `SUPABASE_SERVICE_ROLE_KEY= pnpm vitest run tests/api/curation-jobs-route.test.ts && pnpm typecheck`. Erwartet: PASS.
- [ ] **Step 6: Commit** — `feat(curation): Minuten-Cron curation-jobs — Kickoff 04:25 UTC, Rekonziliation, Advance mit Lease`.

---

### Task 13: Admin-API + Seite `/admin/curation` + Navigation

**Files:**
- Create: `app/api/admin/curation/runs/route.ts`
- Create: `app/admin/curation/page.tsx`
- Modify: `components/admin/admin-nav.tsx:147-170` (Gruppe „News & Synthese", Eintrag `{ label: 'Morgenkonferenz', href: '/admin/curation', icon: ClipboardList }` — `ClipboardList` aus `lucide-react` importieren)
- Test: `tests/api/curation-runs-route.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` (`lib/auth/session.ts:110`); `listRuns`, `getRun`, `getRunUnits` (Task 3).
- Produces: `GET /api/admin/curation/runs?limit=30` → `{ runs: RunSummary[] }`; `GET /api/admin/curation/runs?id=<uuid>` → `{ run: RunRow (ohne cards/brief.dayBlock), units: UnitRow[], titles: Record<string, string> }`.

- [ ] **Step 1: Failing Tests** — `tests/api/curation-runs-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ requireAdmin: vi.fn(async () => null), listRuns: vi.fn(), getRun: vi.fn(), getRunUnits: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ requireAdmin: m.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/curation/service', () => ({ listRuns: m.listRuns, getRun: m.getRun, getRunUnits: m.getRunUnits }))
const req = (q = '') => new Request(`https://x/api/admin/curation/runs${q}`) as any
beforeEach(() => vi.clearAllMocks())

describe('GET /api/admin/curation/runs', () => {
  it('401 ohne Session', async () => {
    m.requireAdmin.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Nicht autorisiert' }), { status: 401 }))
    const { GET } = await import('@/app/api/admin/curation/runs/route'); expect((await GET(req())).status).toBe(401)
  })
  it('Liste mit limit (max 100)', async () => {
    m.listRuns.mockResolvedValue([{ id: 'a' }])
    const { GET } = await import('@/app/api/admin/curation/runs/route')
    expect(await (await GET(req('?limit=500'))).json()).toEqual({ runs: [{ id: 'a' }] }); expect(m.listRuns).toHaveBeenCalledWith({}, { limit: 100 })
  })
  it('Detail liefert Run ohne Cards, Einheiten und Titel-Map', async () => {
    m.getRun.mockResolvedValue({ id: 'r', cards: [{ id: 'x', core: 'c' }], pool: { items: [{ id: 'x', title: 'Titel X' }] }, brief: { systemPrefix: 'p', dayBlock: 'd', precedentIds: {}, meta: {} } })
    m.getRunUnits.mockResolvedValue([{ unit_key: 'u', member_ids: ['x'] }])
    const { GET } = await import('@/app/api/admin/curation/runs/route')
    const body = await (await GET(req('?id=r'))).json()
    expect(body.run.cards).toBeUndefined(); expect(body.run.pool).toBeUndefined(); expect(body.units).toHaveLength(1); expect(body.titles).toEqual({ x: 'Titel X' })
    m.getRun.mockResolvedValueOnce(null); expect((await GET(req('?id=nix'))).status).toBe(404)
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen.**

- [ ] **Step 3: Route implementieren** — `requireAdmin` zuerst; `new URL(request.url).searchParams` (Testbarkeit, Kommentar `app/api/admin/glossary-jobs/route.ts:75-77`); Detail: `const { pool, cards, ...rest } = run; titles = Object.fromEntries(pool?.items.map(i => [i.id, i.title]) ?? [])`; `brief` nur mit `meta` und `precedentIds` (Texte weglassen; die Seite zeigt Zähler). Fehler aus Service → `{ error: message }` mit 500; wenn `message` `curation_runs` und `schema cache` enthält, 500 mit Hinweis „Migration 20261014090000 einspielen".

- [ ] **Step 4: Seite `app/admin/curation/page.tsx`** — `'use client'`, Muster `app/admin/llm-costs/page.tsx` (Kopf `p-8`, h1 `text-3xl font-bold tracking-tighter`, Loader, Fehler-Card mit Migrations-Hinweis bei `schema cache`). Links Liste der Runs (Tabelle: Tag, Modus, Status/Phase, `degraded`-Badges, Kosten `spend_usd.toFixed(2)`, Unit-Recall@20 vs. Baseline aus `metrics`, Attribution), Klick lädt Detail. Detail: KPI-Grid (`metrics`: unit_recall_20, setzlisten_recall_10/precision_10, duplicate_rate, cut_rate, additions, held_rate, diff_vs_total_score_20), drei Gruppen „Setzliste", „Bank", „Zurückgestellt" (Card je Gruppe; Zeile je Einheit: Rang, Rolle-Badge, Titel der Member aus `titles` (erstes fett, weitere grau), `is_hand` → Badge „Hand", `reason`, `outcome`-Badge mit Farbe: kept grün, relabeled blau, merged violett, dropped_* grau/rot), darunter „Zugaben des Betreibers" (Einheiten mit `outcome === 'added'`: `matched_heading`), Kritik (hard rot, soft gelb), Protokoll (`log` aus Detail — dafür `log` im Detail NICHT entfernen). Kein Schreibzugriff, keine Buttons außer Aktualisieren.

- [ ] **Step 5: Nav-Link** einfügen; `pnpm typecheck`; `SUPABASE_SERVICE_ROLE_KEY= pnpm vitest run tests/api/curation-runs-route.test.ts`. Erwartet: PASS.

- [ ] **Step 6: Commit** — `feat(admin): Morgenkonferenz read-only — Runs, drei Tiers, Metriken, Protokoll`.

---

### Task 14: Scripts — Backtest, Einzellauf, Nach-Rekonziliation

**Files:**
- Create: `scripts/backtest-curation.ts`, `scripts/shadow-once-curation.ts`, `scripts/reconcile-curation.ts`
- Create: `lib/curation/backtest.ts` (reine Teile: Argument-Parser, Tagesliste, Report-Aggregation) — Script bleibt dünne Schleife
- Modify: `package.json` (`"curation:backtest": "tsx scripts/backtest-curation.ts"`, `"curation:shadow-once": "tsx scripts/shadow-once-curation.ts"`, `"curation:reconcile": "tsx scripts/reconcile-curation.ts"` hinter `curation:baseline`)
- Test: `tests/lib/curation-backtest.test.ts`

**Interfaces:**
- Consumes: Service, `runDayInline`, `reconcileRun`, `aggregateRuns`, `createCaller`, `flushUsageLog`, `generateEmbeddings`, `berlinDay`, `isoDayShift`.
- Produces: `parseBacktestArgs(argv): BacktestArgs | null`, `backtestDays(args, today): string[]`, Report-JSON `scripts/curation-backtest.json`.

```ts
export interface BacktestArgs { from: string; to: string; last: number; brief: BriefMode; sequential: boolean; dryRun: boolean; limit: number | null; maxUsd: number; kickoffUtc: string; out: string }
export const BACKTEST_DEFAULTS = { from: '2026-08-25', to: '2026-09-29', last: 30, brief: 'precedents-only', sequential: false, maxUsd: 90, kickoffUtc: '04:25', out: 'scripts/curation-backtest.json' } as const
export function parseBacktestArgs(argv: string[]): BacktestArgs | null   // --from, --to, --last, --brief none|precedents-only|full, --sequential, --dry-run, --limit N, --max-usd X, --kickoff HH:MM, --out
export function backtestDays(args: BacktestArgs, today: string): string[]  // Gate-Fenster [from, to] ∪ [today − last, today − 1], sortiert, dedupliziert, bei limit gekappt (vom Anfang)
```

- [ ] **Step 1: Failing Tests** — `tests/lib/curation-backtest.test.ts`: `parseBacktestArgs([])` liefert Defaults; `--brief quatsch` → null; `--since`-Form nicht akzeptiert; `backtestDays({...defaults, limit: 3}, '2026-10-14')` → `['2026-08-25','2026-08-26','2026-08-27']`; ohne limit: enthält `2026-09-29` und `2026-10-13`, nicht `2026-10-14`, keine Dubletten im Überlappungsbereich.

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen.**

- [ ] **Step 3: `lib/curation/backtest.ts` implementieren** (Parser nach dem Muster `parseSinceArg`, `precedents.ts:553`).

- [ ] **Step 4: `scripts/backtest-curation.ts`** — dotenv-Kopf (`~/.synthszr.env.prod` vor `.env.local`), dynamische Imports in `main()`; Ablauf je Tag `d` aus `backtestDays`: `asof = \`${d}T${HH}:${MM}:00.000Z\``; `createRun({ day: d, mode: 'backtest', asof, brief_mode: args.brief, budget_usd: settings.budget_usd, models })` (ein bestehender `done`-Run desselben Tages und Modus wird übersprungen, außer `--force`); `--dry-run`: nur `phasePool` + `phaseCluster` über `advanceRun` mit einem `callTool`, das wirft (`'dry-run'`) — Abbruch nach Cluster, Run auf `cancelled`, Zähler ausgeben; sonst `runDayInline`, danach `reconcileRun(supabase, run, embed)` sofort (Post ist historisch bekannt); `--sequential`: Tage strikt nacheinander (Korrektur-Paare aus eigenen Backtest-Runs mit `asof < d` fließen über `loadCorrectionPairs(mode: 'backtest')`), sonst 3 Tage parallel; Kosten-Summe über `run.spend_usd`; `> args.maxUsd` → Abbruch mit `[Curation] WARNUNG: Budget …`, Exit 1 nach Report. Report: `{ generated_at, args, days: [{ day, run_id, status, spend_usd, degraded, attribution, metrics }], aggregate: aggregateRuns(metricsList, handPrecisionRef) }` mit `handPrecisionRef` aus `scripts/curation-baseline.json` (`baselines.hand.precision_full`, falls Datei existiert, sonst null). Logging je Tag: `[Curation] <d>: <status> · <n> Einheiten · UnitRecall@20 <x> (total_score <y>) · <spend> USD · <min>`. Ende `console.table(aggregate.mean)`, `[Curation] FERTIG — n/m Tage, <USD>`, `await flushUsageLog()`, `process.exit(0)`.

- [ ] **Step 5: `scripts/shadow-once-curation.ts`** — ein Shadow-Lauf für heute (oder `--asof <ISO>`), `mode: 'shadow'`, `runDayInline`; `--dry-run` wie oben. Zweck: erster Lauf unter Beobachtung, bevor `shadow_enabled` scharf geht. Loggt Phasen und Kosten.

- [ ] **Step 6: `scripts/reconcile-curation.ts`** — alle Runs `status done, reconciled_at null` (beide Modi, `--mode shadow|backtest`, `--since`), je Run `reconcileRun`; `--dry-run` zeigt nur `pickMatchingPost`-Ergebnis je Run.

- [ ] **Step 7: Dry-Run gegen Prod (lesend, erlaubt — Migration muss eingespielt sein)**

```bash
cd /Users/mattes/dev/synthszr && pnpm curation:backtest -- --dry-run --limit 2
```
Erwartet: zwei Tage, je `[Curation] <d>: Pool <n> Items (excluded …) · <k> Stories · <h> Hand`, keine Modellaufrufe (`callTool` wirft nicht, weil nie aufgerufen), Runs als `cancelled`, Exit 0. Pool-Größe plausibel (300–900).

- [ ] **Step 8: [FREIGABE] Backtest-Probelauf — 2 Tage, echte Modellkosten (~2–4 USD)**

```bash
cd /Users/mattes/dev/synthszr && pnpm curation:backtest -- --limit 2 --max-usd 6 --out scripts/curation-backtest-probe.json
```
Erwartet: zwei `done`-Runs, `attribution` ≠ `none` (Gate-Tage haben manuelle Jobs), `metrics.unit_recall_20` in [0, 1], `spend_usd` 1–2 je Tag, `degraded` leer oder nur `scout_partial`. Prüfen: `select day, status, phase, spend_usd, degraded, metrics->>'unit_recall_20' from curation_runs where mode='backtest' order by day` (lesend). Ergebnis dem Betreiber zeigen, BEVOR der Volllauf startet.

- [ ] **Step 9: [FREIGABE] Backtest-Volllauf (~55–90 USD)**

```bash
cd /Users/mattes/dev/synthszr && pnpm curation:backtest -- --brief precedents-only --max-usd 90
```
Danach Ablation (nur mit eigener Freigabe): `--brief none` und `--brief full --sequential`. Die Gate-Zahlen stehen in `aggregate.gate`; Entscheidungsregel der Spec gilt erst nach ≥ 20 Shadow-Tagen — der Backtest ist die Plausibilitätsprüfung vorher.

- [ ] **Step 10: Tests + Typecheck; Commit** — `feat(curation): Backtest-, Einzellauf- und Rekonziliations-Script mit Report und Gate-Aggregation`.

---

### Task 15: Doku, Spec-Änderungsprotokoll, Runbook Shadow-Start

**Files:**
- Modify: `CLAUDE.md` (neuer Abschnitt `### Curation Phase 1 — Shadow (2026-10-14)` direkt hinter dem Phase-0-Abschnitt)
- Modify: `docs/superpowers/specs/2026-10-05-news-curation-team-design.md` (Abschnitt `## Änderungsprotokoll v4 → v4.1 (Betreiber-Entscheidungen 2026-10-14)` am Ende; Status-Zeile oben auf „v4.1")

- [ ] **Step 1: CLAUDE.md-Abschnitt** — Inhalt: Zweck (Shadow auf Vercel, kein Write auf Queue/Draft), Tabellen (`curation_runs`, `curation_units`, Caches, RPCs — je ein Satz), Engine (Minuten-Cron, Phasen, Lease 15 min, `maxDuration 800`, Tick-Budget 600 s, Compose nur ab 420 s Rest), Settings (`curation`: Felder mit Defaults; `curation_operator_rules`), Modelle über Use Cases, Kosten (Budget 4 je Run, 12 je Tag, Reservierung), Rekonziliation (Attribution-Kaskade, pflegt `published_units` nach), Admin `/admin/curation`, Scripts (`curation:backtest`, `curation:shadow-once`, `curation:reconcile`, alle mit `--dry-run`), Testregel `SUPABASE_SERVICE_ROLE_KEY=`, Gate-Regel (Shadow → Assist nach ≥ 20 Tagen: Unit-Recall@20 ≥ total_score + 0,10 mit Bootstrap-90 % > 0, Boden 0,5/0,35, Precision ≥ Hand, Dubletten 0; Abbruch bei < total_score nach 20 Tagen).

- [ ] **Step 2: Runbook „Shadow scharf schalten" (in CLAUDE.md, als nummerierte Liste mit [FREIGABE])**
  1. Migration 20261014090000 eingespielt (Task 1 Step 8) und Phase-0-Migration vorhanden.
  2. `pnpm curation:shadow-once -- --dry-run` (lesend): Pool und Cluster plausibel.
  3. **[FREIGABE]** `pnpm curation:shadow-once` (ein echter Lauf, ~1–2 USD) → `/admin/curation` prüfen.
  4. **[FREIGABE]** Settings setzen (SQL, lesend prüfbar):
     ```sql
     insert into settings (key, value) values ('curation', '{"shadow_enabled": true}'::jsonb)
       on conflict (key) do update set value = settings.value || '{"shadow_enabled": true}'::jsonb;
     insert into settings (key, value) values ('curation_operator_rules', '{"text": ""}'::jsonb) on conflict (key) do nothing;
     ```
  5. Deploy auf `main` (Vercel-Cron `*/1` ist in `vercel.json`); am nächsten Morgen ab 04:26 UTC entsteht der Run, Rekonziliation läuft nach dem Publish.
  6. Nach 20 Shadow-Tagen: `aggregateRuns` über `/admin/curation` oder `pnpm curation:reconcile -- --report`; Gate-Entscheidung durch den Betreiber.

- [ ] **Step 3: Spec-Änderungsprotokoll v4 → v4.1** — die vier Betreiber-Entscheidungen vom Kopf dieses Plans (Vercel statt launchd; erweiterte Schreibrechte; `get_precedent_units` ohne Rollen-Parameter; fester Kickoff in Phase 1), plus Befunde aus dem Code-Mapping, die die Spec korrigieren: `callModelNonStreaming` steht bei :1183 und ist nicht exportiert; Preise für Opus 5.5/Fable 5.1 sind eingetragen (Kostenabschnitt überholt); `excerpt` ist bei ~77 % des Pools leer (Scout liest gekappten Content); `getCoverageEmbeddingsAsOf` entsteht in `archive.ts`; `daily_repo` hat `collected_at`, nicht `created_at`; Mindestlänge der Queue-UI ist nicht persistiert (Default 500 aus Settings).

- [ ] **Step 4: Commit** — `docs(curation): Phase 1 Shadow — CLAUDE.md, Runbook Shadow-Start, Spec v4.1`.

- [ ] **Step 5: Abschluss** — `SUPABASE_SERVICE_ROLE_KEY= pnpm vitest run tests/lib tests/api/curation-jobs-route.test.ts tests/api/curation-runs-route.test.ts && pnpm typecheck`; dann Branch-Review (subagent-driven-development: finaler Reviewer), PR nach `main` mit der [FREIGABE]-Liste im PR-Text: Migration (Task 1 Step 8), Backtest-Probelauf (Task 14 Step 8), Backtest-Volllauf (Task 14 Step 9), Einzellauf (Runbook 3), Settings (Runbook 4).

---

## Self-Review (2026-10-14, nach dem Schreiben)

1. **Spec-Abdeckung Phase 1:** Pool (T4), Cluster (T5), Scout (T6), Archivar inkl. Negativ-Block, Präzedenz-RPC, Korrektur-Paare, Panel, Soft-Range, Techmeme-Quote (T7), Chefredaktion mit Tool `compose_day`, zufälliger Card-Reihenfolge, Hand-/Techmeme-Entscheidungen (T8), Kritiker deterministisch + Sonnet, Revision, Baseline-Plan bei Fehlschlag (T9/T10), `curation_runs`/`curation_units` (T1), Rekonziliation mit Outcomes und Metriken je Tag, Attribution ≤ 24 h (T11), Shadow-Runner (T12 statt launchd — Betreiber-Entscheidung), Backtest über Gate-Tage + 30 Tage mit `--brief`-Ablationen und `--sequential` (T14), read-only `/admin/curation` mit drei Tiers (T13), Use Cases + Settings-Gruppe (T2), `lib/ai/call.ts` (T2), Budget-Reservierung (T10). Nicht in Phase 1 (bewusst, Spec): Techmeme-Run-Phase, Kickoff-Deadline, Commit, Draft, Panel-Schreiben, Bündeltyp `story`, `merged_into`-Events, Nachtlauf-Replay (offene Abweichung aus Phase 0 bleibt offen).
2. **Platzhalter:** keine „TBD"/„später"; Lade-Funktionen sind durch exakte Queries in §3 spezifiziert, reine Funktionen durch Code.
3. **Typ-Konsistenz:** `ClusterResult.storyKeyOf` ist `Record` (nicht Map) — in T5/T8/T9/T11 einheitlich; `UnitInsert` ohne `id/run_id/created_at` (T3/T10/T11); `CallToolFn` generisch (T2/T6/T8/T9/T10); `reconcileOutcomes` nimmt `postId` (T11) für `matched_post_id`.
4. **Review Focus:** 1 → T10-Test „pool_small"; 2 → T8 `validatePlan` + T10 „zwei Versuche → Baseline"; 3 → T9 Hand-Invariante; 4 → T11 `pickMatchingPost` + `reconcileRun`-Pfad ohne Post; 5 → T10 Restbudget + T12 `MAX_ATTEMPTS`; 6 → T10 Budget-Tests; 7 → T2 strict-Retry.
