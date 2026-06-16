# Artikel-Job-Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 40 Opus-Artikel für den automatischen Tages-Post über mehrere 15-Min-Cron-Ticks generieren (resumable Job-Queue), statt inline in einer 300s-Function.

**Architecture:** Neue Tabelle `article_jobs` als Zustandsmaschine (planning → writing(×n) → finalizing → done). Der 05:30-Cron legt einen Job an; jeder 15-Min-Tick führt genau eine Phase/Batch aus, persistiert den Zustand → resumable. `runGhostwriterPipeline` wird in einzeln aufrufbare Schritte zerlegt; der manuelle `/api/ghostwriter-queue`-Flow nutzt sie als dünner Wrapper unverändert weiter.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Postgres, jsonb), Vercel Cron, vitest. Modelle via `getModelForUseCase`. Generierung: Anthropic/OpenAI/Google über bestehende `lib/claude/ghostwriter*`.

**Referenz-Spec:** `docs/superpowers/specs/2026-06-16-article-job-queue-design.md`

**Verifikations-Konvention (Mattes):** Prod-Checks via `npx vercel env pull .env.backfill.local --environment=production --yes` (danach löschen!) + curl/SQL gegen Supabase (Projekt-Ref `zadrjbyszvsusukajsbp`). Nur eigene Dateien committen — NIE die vorbestehenden Working-Tree-Änderungen (gelöschte `supabase/migrations/*.sql`, `db-backups/`, etc.). Commit-Footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Create** `lib/article-jobs/service.ts` — Job-CRUD + Phasen-Logik (`createArticleJob`, `getNextOpenJob`, `advanceArticleJob`, `markJobError`). Eine Verantwortung: Job-Lebenszyklus.
- **Modify** `lib/claude/ghostwriter-pipeline.ts` — Generator in Schritte zerlegen (`buildSectionContext`, `writeSectionsBatch`, `finalizeArticle`), `runGhostwriterPipeline` als Wrapper.
- **Modify** `app/api/cron/scheduled-tasks/route.ts` — `generateDailyPost` → `enqueueDailyPostJob`; neuer `advanceArticleJob`-Block pro Tick.
- **Create** `tests/lib/article-jobs-batch.test.ts` — vitest für budget-/cursor-Logik (reine Logik, gemockte `writeSection`).
- **DB** Tabelle `article_jobs` via Supabase `apply_migration` (lokale Migrations-Dateien sind im Working Tree gelöscht → remote-Apply ist der saubere Weg).

---

## Task 1: Tabelle `article_jobs`

**Files:**
- DB: via Supabase MCP `apply_migration` (name: `article_jobs`)

- [ ] **Step 1: Tabelle anlegen (apply_migration)**

SQL:
```sql
create table if not exists article_jobs (
  id uuid primary key default gen_random_uuid(),
  digest_id uuid references daily_digests(id),
  status text not null default 'pending',          -- pending|processing|done|error
  phase text default 'planning',                   -- planning|writing|finalizing
  model text,
  effort text default 'medium',
  max_items int not null default 40,
  vocabulary_intensity int not null default 50,
  selected_items jsonb not null default '[]'::jsonb,
  used_item_ids jsonb not null default '[]'::jsonb,
  plan jsonb,
  written_sections jsonb not null default '[]'::jsonb,
  cursor int not null default 0,
  generated_post_id uuid references generated_posts(id),
  attempts int not null default 0,
  max_attempts int not null default 12,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index if not exists article_jobs_open_idx
  on article_jobs (created_at) where status in ('pending','processing');
create unique index if not exists article_jobs_digest_uidx
  on article_jobs (digest_id) where status <> 'error';
```

- [ ] **Step 2: Verify**

Run (Supabase MCP `execute_sql`):
```sql
select column_name, data_type from information_schema.columns where table_name='article_jobs' order by ordinal_position;
```
Expected: alle obigen Spalten. Der `article_jobs_digest_uidx` erzwingt Idempotenz (max. 1 nicht-error-Job pro Digest).

---

## Task 2: Pipeline in resumable Schritte zerlegen

**Files:**
- Modify: `lib/claude/ghostwriter-pipeline.ts`
- Test: `tests/lib/article-jobs-batch.test.ts`

Die drei neuen exportierten Funktionen kapseln die Phasen-Bausteine. `runGhostwriterPipeline` (Zeilen 493–663) wird so umgebaut, dass es diese Funktionen aufruft und dieselben Events streamt — der manuelle Flow bleibt identisch.

- [ ] **Step 1: `buildSectionContext` extrahieren**

Neue exportierte Funktion. Bewegt die Setup-Logik aus `runGhostwriterPipeline` (aktuell Zeilen ~530–572: Edit-Learning laden, `companiesPerItem`, `cacheableUserPrefix`, `metadataBlock`).

```ts
export interface SectionContext {
  cacheableUserPrefix: string
  companiesPerItem: Map<string, { public: string[]; premarket: string[] }>
  metadataBlock: string
  loadedPatterns: LearnedPattern[]
}

export async function buildSectionContext(
  items: PipelineItem[],
  plan: ArticlePlan,
  vocabularyContext: string | undefined,
): Promise<SectionContext> {
  // ... bewege hier den Code aus runGhostwriterPipeline Zeilen 530–572 hinein:
  //   - getActiveLearnedPatterns / findSimilarEditExamples / buildPromptEnhancement
  //   - companiesPerItem via extractRelevantCompanies
  //   - prefixParts -> cacheableUserPrefix
  //   - metadataBlock aus plan (excerptBullets, articleTitle, category, introParagraph)
  // return { cacheableUserPrefix, companiesPerItem, metadataBlock, loadedPatterns }
}
```

- [ ] **Step 2: `writeSectionsBatch` extrahieren (budget-bewusst)**

Schreibt geordnete Sektionen ab `cursor`, bis `budgetMs` Wall-Clock erreicht ist. Nutzt die bestehende `writeSection`. Concurrency 6 wie bisher, aber pro Aufruf maximal so viele Batches, dass `budgetMs` nicht überschritten wird (nach jedem abgeschlossenen Batch Zeit prüfen).

```ts
export interface WriteBatchResult {
  sections: string[]   // NUR die in DIESEM Aufruf geschriebenen, in Reihenfolge
  nextCursor: number
  done: boolean
}

export async function writeSectionsBatch(
  orderedItems: PipelineItem[],
  plan: ArticlePlan,
  ctx: SectionContext,
  cursor: number,
  model: AIModel,
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max',
  budgetMs: number,
  startedAt: number,     // Date.now() vom Tick-Beginn (für Gesamt-Budget)
): Promise<WriteBatchResult> {
  const out: string[] = []
  let i = cursor
  const concurrency = 6
  while (i < orderedItems.length) {
    const batch = orderedItems.slice(i, i + concurrency)
    const results = await Promise.all(batch.map((item, k) => {
      const itemIdx = plan.ordering[i + k]
      const heading = plan.headings[String(itemIdx)] || item.title
      const itemCompanies = ctx.companiesPerItem.get(item.id) || { public: [], premarket: [] }
      return writeSection(item, heading, model, {
        relevantCompanies: itemCompanies,
        cacheableUserPrefix: ctx.cacheableUserPrefix,
        effort,
      }).catch(err => `## ${heading}\n\n*Fehler: ${err instanceof Error ? err.message : String(err)}*\n`)
    }))
    out.push(...results.map(r => r + '\n\n'))
    i += batch.length
    if (Date.now() - startedAt > budgetMs) break   // Budget erschöpft -> Rest im nächsten Tick
  }
  return { sections: out, nextCursor: i, done: i >= orderedItems.length }
}
```

- [ ] **Step 3: `finalizeArticle` extrahieren**

Assembliert Metadata-Block + alle Sektionen → Proofread (`proofreadText`) → Metaphern-Dedup (`findDuplicateMetaphors` + `streamMetaphorDeduplication`, aktuell in `queue-article.ts` Zeilen ~282–296) → finaler Markdown-String.

```ts
export async function finalizeArticle(
  metadataBlock: string,
  sections: string[],
  model: AIModel,
  vocabulary: Array<{ term: string }> | null,
): Promise<string> {
  const body = sections.join('')
  let full = metadataBlock + body
  // Proofread (Zeilen 651–662 Logik)
  try {
    const proofreadingModel = await getModelForUseCase('proofreading') as AIModel
    full = metadataBlock + await proofreadText(body, proofreadingModel)
  } catch (err) {
    console.error('[Pipeline] Proofreading failed:', err)
  }
  // Dedup (aus queue-article.ts)
  const duplicates = findDuplicateMetaphors(full, vocabulary || undefined)
  if (duplicates.size > 0) {
    let deduped = ''
    for await (const chunk of streamMetaphorDeduplication(full, duplicates, model)) deduped += chunk
    if (deduped.trim()) full = deduped
  }
  return full
}
```
Hinweis: `findDuplicateMetaphors`/`streamMetaphorDeduplication` werden bereits in `ghostwriter.ts` exportiert (Import in `queue-article.ts` vorhanden) — in `ghostwriter-pipeline.ts` importieren.

- [ ] **Step 4: `runGhostwriterPipeline` auf die Schritte umstellen**

`runGhostwriterPipeline` ruft jetzt `buildSectionContext` → yieldet `metadataBlock` als `metadata`-Event → schreibt Sektionen (für den Stream weiterhin progressiv, mit `budgetMs = Infinity`, `startedAt = Date.now()`) → yieldet `assembling`/`proofreading`/`proofread` wie bisher. Verhalten + Event-Reihenfolge unverändert. Die Dedup bleibt wo sie ist (in `queue-article.ts` nach dem Generator) — `finalizeArticle` ist NUR für den Job-Pfad; der manuelle Pfad behält seine bestehende Proofread/Dedup-Logik. (D.h. `finalizeArticle` darf NICHT in den manuellen Stream eingebaut werden, sonst doppelte Dedup.)

- [ ] **Step 5: vitest für `writeSectionsBatch`**

```ts
// tests/lib/article-jobs-batch.test.ts
import { describe, it, expect, vi } from 'vitest'
// Mock writeSection (langsam) -> prüft Cursor/Budget/Reihenfolge
describe('writeSectionsBatch', () => {
  it('stoppt am Budget und gibt korrekten nextCursor zurück', async () => {
    // Mock so, dass jeder Batch ~50ms kostet, budgetMs=120 -> ~2-3 Batches
    // Erwartet: nextCursor < total, done=false, sections in Reihenfolge
  })
  it('done=true wenn alle Items geschrieben', async () => {
    // budgetMs=Infinity, 8 items -> nextCursor=8, done=true, 8 sections
  })
})
```
Run: `npm test -- article-jobs-batch` → Expected: PASS. (Mock `writeSection` per `vi.mock('@/lib/claude/ghostwriter-pipeline', ...)` partial, oder Funktion testbar via Dependency-Injection.)

- [ ] **Step 6: tsc + commit**

Run: `npx tsc --noEmit 2>&1 | grep -cE "error TS"` → Expected: `0`.
```bash
git add lib/claude/ghostwriter-pipeline.ts tests/lib/article-jobs-batch.test.ts
git commit -m "refactor(pipeline): split runGhostwriterPipeline into resumable steps"
```

---

## Task 3: `lib/article-jobs/service.ts`

**Files:**
- Create: `lib/article-jobs/service.ts`

- [ ] **Step 1: `createArticleJob` (Idempotenz + Item-Snapshot)**

Nutzt die bestehende Selektion (`getSelectedItems`/`getBalancedSelection`/`selectItemsForArticle`) und Content-Anreicherung aus `generateQueueArticle` — am besten dafür einen kleinen Helfer `selectAndEnrichItems(maxItems, vocabularyIntensity)` aus `queue-article.ts` exportieren (gibt `{ pipelineItems, usedItemIds, model, vocabulary }`), damit Job-Pfad und manueller Pfad dieselbe Selektion teilen (kein Drift).

```ts
import { createAdminClient } from '@/lib/supabase/admin'

export async function createArticleJob(opts: {
  digestId: string; maxItems: number; model: string; effort: string; vocabularyIntensity: number
}): Promise<{ created: boolean; reason?: string }> {
  const supabase = createAdminClient()
  // Idempotenz: existiert Post ODER nicht-error-Job für diesen Digest?
  const { data: existingPost } = await supabase.from('generated_posts').select('id').eq('digest_id', opts.digestId).maybeSingle()
  if (existingPost) return { created: false, reason: 'post_exists' }
  const { data: existingJob } = await supabase.from('article_jobs').select('id').eq('digest_id', opts.digestId).neq('status','error').maybeSingle()
  if (existingJob) return { created: false, reason: 'job_exists' }
  // Items selektieren + anreichern (geteilter Helfer aus queue-article.ts)
  const { pipelineItems, usedItemIds, model } = await selectAndEnrichItems(opts.maxItems, opts.vocabularyIntensity)
  if (pipelineItems.length === 0) return { created: false, reason: 'no_items' }
  await supabase.from('article_jobs').insert({
    digest_id: opts.digestId, status: 'pending', phase: 'planning',
    model: opts.model || model, effort: opts.effort, max_items: opts.maxItems,
    vocabulary_intensity: opts.vocabularyIntensity,
    selected_items: pipelineItems, used_item_ids: usedItemIds,
  })
  return { created: true }
}
```

- [ ] **Step 2: `getNextOpenJob` + `markJobError`**

```ts
export async function getNextOpenJob() {
  const supabase = createAdminClient()
  const { data } = await supabase.from('article_jobs')
    .select('*').in('status', ['pending','processing'])
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  return data
}
export async function markJobError(id: string, message: string) {
  const supabase = createAdminClient()
  await supabase.from('article_jobs').update({ status: 'error', error_message: message.slice(0,500), completed_at: new Date().toISOString() }).eq('id', id)
}
```

- [ ] **Step 3: `advanceArticleJob` (genau eine Phase/Tick)**

```ts
export async function advanceArticleJob(): Promise<string> {
  const supabase = createAdminClient()
  const job = await getNextOpenJob()
  if (!job) return 'no_job'
  if (job.attempts >= job.max_attempts) { await markJobError(job.id, 'max_attempts exceeded'); return 'error_max_attempts' }
  const startedAt = Date.now()
  await supabase.from('article_jobs').update({ status: 'processing', attempts: job.attempts + 1, started_at: job.started_at ?? new Date().toISOString() }).eq('id', job.id)
  try {
    if (job.phase === 'planning') {
      const planningModel = await getModelForUseCase('article_planning') as AIModel
      const plan = await planArticle(job.selected_items, planningModel)
      await supabase.from('article_jobs').update({ plan, phase: 'writing', cursor: 0 }).eq('id', job.id)
      return 'planned'
    }
    if (job.phase === 'writing') {
      const orderedItems = job.plan.ordering.map((idx: number) => job.selected_items[idx - 1]).filter(Boolean)
      const vocabularyContext = buildVocabularyContext(/* aus job.vocabulary_intensity + vocab fetch */)
      const ctx = await buildSectionContext(job.selected_items, job.plan, vocabularyContext)
      const res = await writeSectionsBatch(orderedItems, job.plan, ctx, job.cursor, job.model, job.effort, 210_000, startedAt)
      const written = [...job.written_sections, ...res.sections]
      await supabase.from('article_jobs').update({ written_sections: written, cursor: res.nextCursor, phase: res.done ? 'finalizing' : 'writing' }).eq('id', job.id)
      return res.done ? 'writing_done' : 'writing_progress'
    }
    if (job.phase === 'finalizing') {
      const { data: vocab } = await supabase.from('vocabulary_dictionary').select('term')
      const ctx = await buildSectionContext(job.selected_items, job.plan, undefined) // nur metadataBlock nötig
      const fullMarkdown = await finalizeArticle(ctx.metadataBlock, job.written_sections, job.model, vocab)
      const postId = await persistDraftPost(supabase, job, fullMarkdown)  // s. Step 4
      await markTaskRun(supabase, 'post_generation')
      await supabase.from('article_jobs').update({ status: 'done', phase: null, generated_post_id: postId, completed_at: new Date().toISOString() }).eq('id', job.id)
      return 'finalized'
    }
    return 'unknown_phase'
  } catch (err) {
    // Tick-Fehler: Job bleibt processing (resume nächster Tick); nur Log, attempts schützt vor Endlosschleife
    console.error('[ArticleJobs] advance error:', err)
    return 'tick_error'
  }
}
```
Hinweis `markTaskRun`: aus `scheduled-tasks` exportieren oder hier duplizieren (kleine Settings-Upsert-Funktion).

- [ ] **Step 4: `persistDraftPost` (spiegelt manuellen `saveAsDraft`)**

```ts
async function persistDraftPost(supabase, job, fullMarkdown: string): Promise<string> {
  const { parseArticleContent, generateSlug } = await import('@/lib/utils/parse-article-content')
  const { markdownToTiptap } = await import('@/lib/utils/markdown-to-tiptap')
  const { sanitizeTiptapUrls } = await import('@/lib/utils/url-verifier')
  const { metadata, body } = parseArticleContent(fullMarkdown)
  const title = metadata.title || `Artikel`
  let tiptap = markdownToTiptap(body)
  const { content, changes } = sanitizeTiptapUrls(tiptap); if (changes.length) tiptap = content
  const { data: newPost, error } = await supabase.from('generated_posts').insert({
    digest_id: job.digest_id, title, slug: metadata.slug || generateSlug(title),
    excerpt: metadata.excerpt || null, category: metadata.category || 'AI & Tech',
    content: JSON.stringify(tiptap), word_count: body.split(/\s+/).length,
    status: 'draft', ai_model: job.model,
    pending_queue_item_ids: job.used_item_ids?.length ? job.used_item_ids : [],
  }).select('id').single()
  if (error) throw new Error(`insert failed: ${error.message}`)
  return newPost.id
}
```

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit 2>&1 | grep -cE "error TS"` → `0`.
```bash
git add lib/article-jobs/service.ts lib/claude/queue-article.ts
git commit -m "feat(article-jobs): job service + phase state machine"
```

---

## Task 4: scheduled-tasks-Integration

**Files:**
- Modify: `app/api/cron/scheduled-tasks/route.ts`

- [ ] **Step 1: postGeneration → enqueue statt inline**

Den `postGeneration`-Block (der aktuell `generateDailyPost` aufruft) ersetzen: bei erfüllter Bedingung `createArticleJob({ digestId: <latest digest id>, maxItems: config.postGeneration.maxItems ?? MAX_DIGEST_SECTIONS, model: '' /* aus settings */, effort: 'medium', vocabularyIntensity: 50 })`. `results.postGeneration = created ? 'job_enqueued' : reason`. `generateDailyPost` (+ ungenutzte Imports) entfernen.

- [ ] **Step 2: `advanceArticleJob`-Block pro Tick**

Nach den Standard-Tasks (vor/nach dem Translation-Block), best-effort:
```ts
try {
  const { advanceArticleJob } = await import('@/lib/article-jobs/service')
  results.articleJob = await advanceArticleJob()
} catch (e) { console.error('[Scheduler] article job error:', e); results.articleJob = 'error' }
```

- [ ] **Step 3: tsc + Build + commit**

Run: `npx tsc --noEmit 2>&1 | grep -cE "error TS"` → `0`; `npm run build` → erfolgreich.
```bash
git add app/api/cron/scheduled-tasks/route.ts
git commit -m "feat(cron): enqueue + advance article job instead of inline generation"
git push origin main
```

---

## Task 5: Verifikation auf Production

**Files:** keine (Prod-Checks)

- [ ] **Step 1: Deploy READY abwarten** (Vercel MCP `list_deployments`, neuester Commit `state: READY`).

- [ ] **Step 2: Job anlegen + über Ticks treiben**

Da der reale Cron nur alle 15 Min läuft, den `advanceArticleJob` schneller treiben: temporär postGeneration-Zeit auf „jetzt" + `last_run_daily_analysis` bumpen (wie in der bisherigen Debug-Session), Cron via `curl https://www.synthszr.com/api/cron/scheduled-tasks` (Bearer `CRON_SECRET`) **mehrfach** triggern (Tick 1 = enqueue+planning, Tick 2..n = writing, letzter = finalizing). Nach jedem Trigger:
```sql
select status, phase, cursor, jsonb_array_length(written_sections) as written,
       max_items, generated_post_id from article_jobs order by created_at desc limit 1;
```
Expected: planning → writing (written wächst) → finalizing → done; **kein Trigger > ~250s**.

- [ ] **Step 3: Ergebnis prüfen**

```sql
select id,title,status,ai_model,word_count,cardinality(pending_queue_item_ids) as items
from generated_posts where id=(select generated_post_id from article_jobs order by created_at desc limit 1);
select value->>'timestamp' from settings where key='last_run_post_generation';
```
Expected: Draft mit ~40 Artikeln, sinnvollem Titel/Excerpt, `items`=40, `ai_model`=Opus, `last_run_post_generation`=heute.

- [ ] **Step 4: Resume-Test**

Einen frischen Job in `writing` künstlich „unterbrechen" (z.B. Trigger mit künstlich kurzem Budget) und prüfen, dass der nächste Tick an `cursor` fortsetzt — keine doppelten/fehlenden Sektionen (`written` strikt monoton, am Ende == max_items).

- [ ] **Step 5: Manueller Flow Regression**

`curl POST /api/ghostwriter-queue` (Bearer, `{useSelected:true,maxItems:2}`) → 200-Stream mit `started`/`text`/`done`. Verhalten unverändert.

- [ ] **Step 6: Schedule/Settings zurücksetzen + env löschen**

postGeneration-Zeit + `last_run_daily_analysis` auf Originalwerte zurück. `rm -f .env.backfill.local`.

---

## Task 6: Auto-Anzahl auf 40 zurückstellen

**Files:** DB (settings)

- [ ] **Step 1:** Erst NACHDEM Task 5 grün ist:
```sql
update settings set value = jsonb_set(value,'{postGeneration,maxItems}','40'::jsonb) where key='schedule_config';
```
- [ ] **Step 2:** Verify: `select value->'postGeneration' from settings where key='schedule_config';` → `maxItems:40`.

---

## Self-Review (gegen die Spec)

- **Spec-Coverage:** Tabelle (T1), Phasen planning/writing/finalizing (T2/T3), Pipeline-Refactor in Schritte (T2), service.ts (T3), scheduled-tasks enqueue+advance (T4), Idempotenz (T3 Step1 + unique index T1), Resume (T3 advanceArticleJob lässt Job auf processing + Resume-Test T5 Step4), Brücke-Rückstellung (T6), manueller Flow unverändert (T2 Step4 + T5 Step5). ✓
- **Type-Konsistenz:** `SectionContext`, `WriteBatchResult`, `writeSectionsBatch`-Signatur, `finalizeArticle`-Signatur, `advanceArticleJob`-Rückgabe (Strings) durchgängig. `effort`-Union identisch zu `queue-article.ts`/`ghostwriter-pipeline.ts`.
- **Bewusste Lücken:** `selectAndEnrichItems`-Helfer muss in T3 Step1 aus `queue-article.ts` extrahiert/exportiert werden (DRY mit manuellem Flow). `buildVocabularyContext` analog (kleiner Helfer aus `generateQueueArticle`). `markTaskRun` aus `scheduled-tasks` teilen.
