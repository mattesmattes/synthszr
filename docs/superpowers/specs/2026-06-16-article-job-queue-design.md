# Artikel-Generierung als resumable Job-Queue — Design

**Datum:** 2026-06-16
**Status:** Genehmigt (Design), bereit für Implementierungsplan

## Problem

Der automatische Tages-Blogpost (`postGeneration` im `/api/cron/scheduled-tasks`,
05:30 MEZ) generiert aktuell **inline in einer einzigen Vercel-Function**
(`generateDailyPost` → `generateQueueArticle` → `runGhostwriterPipeline`:
plan → write sections → proofread → dedup). Bei 40 Artikeln überschreitet das
das **harte 300s-Limit von Vercel Pro** (gemessen: Opus-40 'high' ~270–290s,
'medium' >295s). Folge: Die Function wird am Cap gekillt, der Post wird zwar
gespeichert, aber `markTaskRun` läuft nicht mehr und die Finalisierung
(Queue-Item-Verknüpfung) bricht ab. Modell-Wechsel (Sonnet) und effort-Senkung
('medium') lösen es nicht — der Flaschenhals ist Sektionsanzahl + Proofread/
Dedup-Schwanz, nicht die per-Section-Geschwindigkeit.

Decoupling in einen eigenen Cron hilft **nicht** — der 300s-Cap gilt pro
Function-Invocation, egal welcher Cron.

## Ziel

40 Opus-Artikel (volle Qualität) zuverlässig generieren, indem die Arbeit über
**mehrere Cron-Ticks** verteilt wird (echte Multi-Invocation-Verarbeitung).
Jeder Tick bleibt klar unter 300s. Der Post ist ein **Draft** (newsletterSend
ist aus), den der Nutzer vor dem Publishen reviewt — eine Fertigstellung über
~30–60 Min (3–4 Ticks) ist akzeptabel.

## Nicht-Ziele

- Kein neuer Cron-Eintrag (Verarbeitung läuft über den bestehenden
  `*/15 * * * *` `scheduled-tasks`-Cron).
- Kein Self-Chaining per `fetch` an den eigenen Host (würde am selben
  401 — Apex-Redirect / Deployment Protection — scheitern wie der ursprüngliche
  Bug; der einzige zuverlässige Trigger für neue Invocations ist der Cron, den
  Vercel intern autorisiert aufruft).
- Keine Änderung am manuellen `create-article`-Flow (bleibt synchron/streamend,
  Opus, bis zu 40 Items in einer Session — der Nutzer wartet dort aktiv).
- Kein Cover-Bild im Cron (bleibt manueller Review-Schritt, wie bisher).

## Architektur

Neue Tabelle `article_jobs` (Vorbild: `podcast_jobs`). Eine kleine
Zustandsmaschine, die der Job-Processor pro Tick um **eine Phase / einen Batch**
weiterführt; der gesamte Zustand liegt in der DB → jeder Tick ist resumable.

```
05:30-Cron (postGeneration)         jeder 15-Min-Tick (article-job processor)
        │                                        │
        ▼                                        ▼
  Job anlegen (pending)   ──►   planning ──► writing ──► writing ──► finalizing ──► done
  (selected_items,               (Plan)      (Batch 1)   (Batch 2)   (proofread+      (Draft-Post
   digest_id, model,                                                  dedup+insert)    in generated_posts)
   effort, max_items)
```

### Phasen (genau eine pro Tick)

1. **`planning`** — `planArticle(items, planningModel)` (1 LLM-Call, ~10s).
   Speichert `plan` (jsonb) + geordnete Items. Setzt `phase='writing'`,
   `cursor=0`.
2. **`writing`** — schreibt Sektionen ab `cursor`, **budget-bewusst bis ~210s
   Wall-Clock** (dann Tick beenden), hängt Ergebnisse an `written_sections`
   (jsonb-Array, geordnet) an, advanciert `cursor`. Sind noch Sektionen offen →
   bleibt `phase='writing'` (nächster Tick macht weiter); alle geschrieben →
   `phase='finalizing'`. (40 Items ≈ 2 Writing-Ticks bei Opus 'medium'.)
3. **`finalizing`** — assembliert Metadata-Block + Sektionen → `proofread` →
   Metaphern-`dedup` → Frontmatter parsen (`parseArticleContent`) →
   markdown→tiptap + URL-Sanitize → Draft in `generated_posts` schreiben
   (Spalten wie der manuelle `saveAsDraft`: `digest_id`, `pending_queue_item_ids`,
   `title`, `slug`, `excerpt`, `category`, `ai_model`, `status='draft'`) →
   `markTaskRun(supabase, 'post_generation')` → `phase='done'`,
   `generated_post_id` gesetzt.

### Datenmodell: `article_jobs`

| Spalte | Typ | Zweck |
|---|---|---|
| `id` | uuid pk | |
| `digest_id` | uuid | Verknüpfung + Idempotenz (ein Job/Post pro Digest) |
| `status` | text | `pending` \| `processing` \| `done` \| `error` |
| `phase` | text | `planning` \| `writing` \| `finalizing` (null bei done/error) |
| `model` | text | Generierungsmodell (Opus-Live-ID aus Settings) |
| `effort` | text | per-Section reasoning effort (z.B. `high`) |
| `max_items` | int | Ziel-Artikelanzahl (40) |
| `vocabulary_intensity` | int | 0–100 |
| `selected_items` | jsonb | die ausgewählten Queue-Items inkl. Content (Snapshot) |
| `used_item_ids` | jsonb | IDs für `pending_queue_item_ids` beim Insert |
| `plan` | jsonb | Output von `planArticle` |
| `written_sections` | jsonb | geordnetes Array fertiger Sektions-Markdown-Strings |
| `cursor` | int | nächste zu schreibende Sektion |
| `generated_post_id` | uuid | gesetzt in `finalizing` |
| `attempts` | int | pro Tick inkrementiert; Stuck-Guard |
| `max_attempts` | int | Default z.B. 10 |
| `error_message` | text | |
| `created_at` / `started_at` / `completed_at` | timestamptz | |

### Komponenten / Boundaries

- **`lib/claude/ghostwriter-pipeline.ts`** — den monolithischen Generator
  `runGhostwriterPipeline` in wiederverwendbare, einzeln aufrufbare Schritte
  zerlegen, ohne den manuellen Flow zu brechen:
  - `planArticle(items, model)` — existiert bereits.
  - `buildSectionContext(items, plan, vocabularyContext)` → `{ cacheableUserPrefix,
    companiesPerItem }` (das Setup, das aktuell inline in `runGhostwriterPipeline`
    passiert). Pro Writing-Tick günstig neu berechenbar (Vocab/Edit-Learning-Fetch).
  - `writeSectionsBatch(orderedItems, plan, ctx, cursor, model, effort, budgetMs)`
    → schreibt Sektionen ab `cursor` bis Budget erschöpft, gibt
    `{ sections: string[], nextCursor: number, done: boolean }`.
  - `finalizeArticle(plan, sections, model, vocabulary)` → assembliert →
    proofread → dedup → finaler Markdown-String.
  - `runGhostwriterPipeline` bleibt als dünner Wrapper, der diese Schritte
    sequenziell aufruft und dieselben SSE-Events streamt (manueller Flow
    unverändert).
- **`lib/article-jobs/service.ts`** (neu) — CRUD + Phasen-Logik: `createArticleJob`,
  `getNextOpenJob`, `advanceJob` (führt genau eine Phase aus), `markJobError`.
  Nutzt `createAdminClient()` (Cron-Kontext, keine Session).
- **`app/api/cron/scheduled-tasks/route.ts`**:
  - `generateDailyPost` → ersetzt durch `enqueueDailyPostJob` (legt `article_job`
    an statt inline zu generieren; Idempotenz-Check beibehalten).
  - Neuer Block (jeder Tick, nach den Standard-Tasks): `advanceArticleJob()` —
    holt den ältesten offenen Job und führt eine Phase aus. Best-effort,
    try/catch, non-fatal für den restlichen Cron.

### Datenfluss

`selected_items` werden **beim Anlegen** gesnapshotted (inkl. aus `daily_repo`
angereichertem Content), damit spätere Ticks deterministisch dieselben Items
verwenden — unabhängig von zwischenzeitlichen Queue-Änderungen. Queue-Items
werden beim Anlegen wie bisher via `selectItemsForArticle` auf `selected`
markiert; `used_item_ids` wandert beim finalen Insert in
`pending_queue_item_ids` (Markierung als `used` erst beim Publish, wie der
manuelle Flow).

### Fehlerbehandlung / Resume

- Crasht ein Tick mitten in `writing`, bleibt der Job auf `processing`/`writing`
  mit dem zuletzt persistierten `cursor` → der nächste Tick macht weiter
  (bereits geschriebene Sektionen sind in `written_sections`).
- `advanceJob` inkrementiert `attempts`; bei `attempts > max_attempts` oder
  Job zu lange in `processing` → `status='error'` + `error_message` + Log.
  (Optionaler künftiger Schritt: Slack/Alert — hier zunächst nur Log + DB-Status,
  analog zum bestehenden Cron-Verhalten.)
- Pro Digest nur ein Job: `createArticleJob` prüft auf existierenden Job/Post für
  den Digest und no-op't sonst.

### Brücke (bereits aktiv)

`schedule_config.postGeneration.maxItems` steht temporär auf **20** (läuft mit
dem aktuellen Inline-Code zuverlässig). Sobald die Job-Queue live + verifiziert
ist, wird auf **40** zurückgestellt.

## Testen / Erfolgskriterien

- **Verifikation auf Production** (Mattes-Präferenz): nach Deploy einen Job
  manuell anlegen (oder via temporärem postGeneration-Zeitfenster wie gehabt),
  über mehrere Ticks laufen lassen (oder Phasen einzeln triggern) und prüfen:
  - `article_jobs` durchläuft planning → writing(×n) → finalizing → done.
  - Kein Tick überschreitet 300s.
  - Am Ende existiert ein Draft in `generated_posts` mit 40 Artikeln, korrektem
    Titel/Excerpt, `pending_queue_item_ids` = 40, `ai_model` = Opus,
    `last_run_post_generation` = heute.
- **Resume-Test:** Job mitten in `writing` künstlich unterbrechen → nächster Tick
  setzt an `cursor` fort, keine doppelten/fehlenden Sektionen.
- **Manueller Flow unverändert:** `/api/ghostwriter-queue` streamt weiterhin
  korrekt (Regression-Check über einen kleinen Lauf).

## Offene Punkte / bewusste Vereinfachungen (YAGNI)

- Budget-bewusstes Batching nutzt eine feste Wall-Clock-Grenze (~210s), keine
  adaptive Modellkostenschätzung.
- Keine Parallelverarbeitung mehrerer Jobs (ein Job pro Tag genügt).
- Kein neues Admin-UI für `article_jobs` (Status via DB/Logs; optionaler
  Folgeschritt).
