# Synthszr Rankings — Phase 1b-i (extract-Phase) Implementation Plan v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die `extract`-Phase: unverarbeitete `daily_repo`-News (gedeckeltes Daily-Fenster) werden batchweise vom LLM nach AI-Produkten durchsucht, jedes Produkt über `resolveProduct` aufgelöst, dedupliziert pro Item und als `product_mentions` verknüpft — resumable, idempotent (stabiler Mention-Hash), fehler-/hänger-sicher, vom 15-Min-Cron hinter Budget-Guard getrieben. Sentiment/Kategorie/Features folgen in 1b-ii/iii.

**Architecture:** `extractProducts` liefert ein **Result-Objekt** (`{ok:true,products}` | `{ok:false,error,retryable}`) — Provider-/Timeout-Fehler markieren News NIE als verarbeitet. Die `extract`-Phase holt einen gedeckelten daily-Batch, dedupliziert pro `resolveProduct`-`productId`, schreibt Mentions idempotent über einen **stabilen Mention-Hash** (productId-basiert, NICHT LLM-Excerpt), markiert Items nur bei Erfolg, zählt Poison-Attempts. In 1b-i endet der Job nach extract auf `done` (kein Wechsel zu `enrich`, das noch `noop` ist → kein Hänger). Alle DB-Fehler werden geworfen, nicht verschluckt.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk` (tool-use + AbortController-Timeout), zod, Supabase, vitest.

## Global Constraints

- **Spec:** `…/2026-06-28-synthszr-rankings-design.md` §7. **Memory:** `project_synthszr_rankings.md`.
- **Schema-verifiziert (Prod):** `daily_repo` hat `title, content, newsletter_date, processed_for_products_at, processed_for_products_version, processed_for_products_model, product_processing_attempts (NOT NULL DEFAULT 0), product_processing_error`. `product_mentions` hat `UNIQUE(product_id, daily_repo_id, excerpt_hash)`. `ranking_jobs.run_date` existiert NICHT → Task 1 ergänzt es.
- **Keine stille Datenvernichtung:** Jeder Supabase-Call wird als `{ data, error }` ausgewertet; `if (error) throw`. LLM-Provider-/Timeout-Fehler ⇒ Item NICHT als verarbeitet markieren (retrybar via attempts). Nur ein *valider, leerer* LLM-Output zählt als „0 Produkte".
- **Kein Hänger:** In 1b-i setzt extract bei leerer Queue den Job auf `status='done'` (NICHT `phase='enrich'` — enrich ist noch `noop_phase`). Der Übergang zu enrich kommt mit 1b-ii.
- **Idempotenz:** Genau eine Mention pro (Produkt, News). Dedup pro `productId` innerhalb eines Items + stabiler `mentionHash(productId)` (NICHT vom LLM-Excerpt abhängig) + INSERT/23505-Catch. `resolveProduct` ist bereits idempotent.
- **Daily ≠ Backfill:** `mode='daily'` verarbeitet nur News der letzten 7 Tage (`newsletter_date >= now-7d`), neueste zuerst. Backfill ist ein eigener Job/Budget (nicht in 1b-i).
- **Budget:** Cron ruft `advanceRankingJob` nur, wenn ≥150s Tick-Budget übrig (nach Article-Job). LLM-Call hat AbortController-Timeout (~50s). extract-Schleife bricht ~45s vor `EXTRACT_BUDGET_MS` ab.
- **Tägliche Idempotenz:** genau ein Daily-Job pro Tag (`run_date` + Unique-Index + 23505-Catch).
- **Tests:** vitest. Pure Logik (Prompt, zod-Parse inkl. Limits, mentionHash) = Unit-Tests. LLM-/DB-Phase = Controller-Prod-Verifikation mit Mini-Sample (`EXTRACT_BATCH=1`, 1–3 Ticks).
- **Commits:** ein Commit pro Task, auf `main`, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Migration — `ranking_jobs.run_date` (tägliche Idempotenz)

**Files:**
- Create: `supabase/migrations/20260628190000_ranking_jobs_run_date.sql`

- [ ] **Step 1: Migration schreiben**

```sql
-- Genau ein Daily-Ranking-Job pro Tag (P0: createRankingJob race-/mehrfach-sicher).
ALTER TABLE ranking_jobs ADD COLUMN IF NOT EXISTS run_date date NOT NULL DEFAULT current_date;
CREATE UNIQUE INDEX IF NOT EXISTS ranking_jobs_daily_run_uq
  ON ranking_jobs(mode, run_date) WHERE mode = 'daily';
```

- [ ] **Step 2: Anwenden** → `supabase db push --dry-run` (nur diese Migration), dann `echo "y" | supabase db push` → „Finished".

- [ ] **Step 3: Verifizieren** (Prod-Keys via `vercel env pull`): `curl … /rest/v1/ranking_jobs?select=run_date&limit=1` → HTTP `200`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260628190000_ranking_jobs_run_date.sql
git commit -m "feat(rankings): ranking_jobs.run_date + Unique-Index (ein Daily-Job/Tag)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `extractProducts` (Result-Typ, Timeout, gehärtet) + `ranking_extract` use-case

**Files:**
- Modify: `lib/ai/model-config.ts`
- Create: `lib/rankings/extract-products.ts`
- Create: `tests/lib/rankings-extract-products.test.ts`

**Interfaces:**
- Produces: `interface ExtractedProduct { name: string; vendor: string; excerpt?: string }`; `type ExtractProductsResult = { ok: true; products: ExtractedProduct[]; usage?: { inputTokens: number; outputTokens: number } } | { ok: false; error: string; retryable: boolean }`; pure `buildExtractPrompt(title, content): string`; pure `parseExtractResponse(raw: unknown): ExtractedProduct[]` (zod mit Längenlimits, Müll⇒[]); async `extractProducts(title, content): Promise<ExtractProductsResult>`.

- [ ] **Step 1: Failing tests (pure) schreiben**

```typescript
// tests/lib/rankings-extract-products.test.ts
import { describe, it, expect } from 'vitest'
import { buildExtractPrompt, parseExtractResponse } from '@/lib/rankings/extract-products'

describe('buildExtractPrompt', () => {
  it('enthält Titel, Inhalt und die leere-Liste-Regel', () => {
    const p = buildExtractPrompt('OpenAI ships GPT-5.6', 'GPT-5.6 is faster ...')
    expect(p).toContain('OpenAI ships GPT-5.6')
    expect(p).toContain('GPT-5.6 is faster')
    expect(p.toLowerCase()).toContain('leere liste')
  })
})

describe('parseExtractResponse', () => {
  it('parst gültige Produktliste', () => {
    expect(parseExtractResponse({ products: [{ name: 'GPT-5.6', vendor: 'OpenAI', excerpt: 'x' }] }))
      .toEqual([{ name: 'GPT-5.6', vendor: 'OpenAI', excerpt: 'x' }])
  })
  it('filtert Einträge ohne name/vendor', () => {
    expect(parseExtractResponse({ products: [{ name: 'GPT-5.6', vendor: 'OpenAI' }, { name: '' }, { vendor: 'x' }] })).toHaveLength(1)
  })
  it('begrenzt überlange Strings (DB-Schutz)', () => {
    const r = parseExtractResponse({ products: [{ name: 'x'.repeat(500), vendor: 'y'.repeat(500), excerpt: 'z'.repeat(5000) }] })
    expect(r[0].name.length).toBeLessThanOrEqual(120)
    expect(r[0].vendor.length).toBeLessThanOrEqual(120)
    expect((r[0].excerpt ?? '').length).toBeLessThanOrEqual(2000)
  })
  it('toleriert Müll → []', () => {
    expect(parseExtractResponse(null)).toEqual([])
    expect(parseExtractResponse({})).toEqual([])
    expect(parseExtractResponse({ products: 'nope' })).toEqual([])
  })
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag** → `npm test -- rankings-extract-products` → FAIL.

- [ ] **Step 3: Implementierung**

`lib/ai/model-config.ts`: `UseCase`-Union um `'ranking_extract'` erweitern + Eintrag (Modell-ID gegen die bestehende Registry-Konvention prüfen; `claude-haiku-4-5-20251001` ist im Projekt bereits als günstiges Default in Gebrauch):

```typescript
  ranking_extract: {
    label: 'Rankings — Produkt-Extraktion',
    description: 'AI-Produkte aus News-Items extrahieren (hochvolumig)',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
```

`lib/rankings/extract-products.ts`:

```typescript
import { z } from 'zod'

export interface ExtractedProduct { name: string; vendor: string; excerpt?: string }
export type ExtractProductsResult =
  | { ok: true; products: ExtractedProduct[]; usage?: { inputTokens: number; outputTokens: number } }
  | { ok: false; error: string; retryable: boolean }

const ProductSchema = z.object({
  name: z.string().trim().min(1).max(120),
  vendor: z.string().trim().min(1).max(120),
  excerpt: z.string().trim().max(2000).optional(),
})
const ResponseSchema = z.object({ products: z.array(z.unknown()) })

const LLM_TIMEOUT_MS = 50_000

/** Baut den Extraktions-Prompt (pure, gehärtet). */
export function buildExtractPrompt(title: string, content: string): string {
  return `Extrahiere ALLE konkret benannten AI-PRODUKTE aus dieser Tech-News.

REGELN:
- Nur echte Produkte/Modelle/Tools (z.B. ein konkretes Sprachmodell, eine IDE, ein Bild-/Video-Generator), KEINE Firmen ohne konkretes Produkt, keine generischen Begriffe ("KI", "Chatbot").
- Erfinde KEINE Produktnamen. Wenn kein konkretes AI-Produkt genannt wird, gib eine LEERE Liste zurück.
- name: exakter im Text genannter Produktname inkl. Version/Qualifier.
- vendor: der Hersteller/Eigentümer des Produkts (NICHT der zitierte Publisher/das Newsportal), als kurzer Markenname OHNE Rechtsform ("OpenAI", nicht "OpenAI Inc.").
- excerpt: kurzer wörtlicher Beleg-Ausschnitt aus dem Text.

TITEL: ${title}

INHALT:
${content.slice(0, 8000)}`
}

/** Validiert/filtert + begrenzt Längen. Müll ⇒ []. */
export function parseExtractResponse(raw: unknown): ExtractedProduct[] {
  const outer = ResponseSchema.safeParse(raw)
  if (!outer.success) return []
  const out: ExtractedProduct[] = []
  for (const item of outer.data.products) {
    const p = ProductSchema.safeParse(item)
    if (p.success) out.push({ name: p.data.name, vendor: p.data.vendor, excerpt: p.data.excerpt })
  }
  return out
}

/** LLM-Extraktion via Anthropic tool-use. Provider-/Timeout-Fehler ⇒ {ok:false,retryable}. */
export async function extractProducts(title: string, content: string): Promise<ExtractProductsResult> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { getModelForUseCase } = await import('@/lib/ai/model-config')
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: 'ANTHROPIC_API_KEY missing', retryable: true }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const model = await getModelForUseCase('ranking_extract')
  const tool = {
    name: 'report_products',
    description: 'Melde alle in der News genannten AI-Produkte',
    input_schema: {
      type: 'object' as const,
      properties: {
        products: {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string' }, vendor: { type: 'string' }, excerpt: { type: 'string' } }, required: ['name', 'vendor'] },
        },
      },
      required: ['products'],
    },
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const resp = await client.messages.create({
      model, max_tokens: 1536, tools: [tool],
      tool_choice: { type: 'tool', name: 'report_products' },
      messages: [{ role: 'user', content: buildExtractPrompt(title, content) }],
    }, { signal: controller.signal })
    const block = resp.content.find((b) => b.type === 'tool_use')
    const products = parseExtractResponse(block && 'input' in block ? block.input : null)
    return { ok: true, products, usage: { inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true }
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 4: Test** → `npm test -- rankings-extract-products` → PASS. **Typecheck:** `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/model-config.ts lib/rankings/extract-products.ts tests/lib/rankings-extract-products.test.ts
git commit -m "feat(rankings): extractProducts (Result-Typ, Timeout, gehärtet) + ranking_extract use-case

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `mentionHash` + `createRankingJob` (täglich idempotent) + extract-Phase-Body

**Files:**
- Modify: `lib/rankings/jobs.ts`
- Create: `lib/rankings/mention.ts`
- Create: `tests/lib/rankings-mention.test.ts`

**Interfaces:**
- Produces: pure `mentionHash(productId: string): string` (stabil, NICHT excerpt-abhängig); `createRankingJob(opts?: { mode?: 'daily'|'backfill' }): Promise<{ created: boolean; reason?: string }>` (täglich idempotent via run_date+23505); gefüllter `extract`-case.
- Consumes: `extractProducts`/`ExtractProductsResult` (Task 2); `resolveProduct` (1a); `createAdminClient`.

- [ ] **Step 1: Failing test (mentionHash) schreiben**

```typescript
// tests/lib/rankings-mention.test.ts
import { describe, it, expect } from 'vitest'
import { mentionHash } from '@/lib/rankings/mention'

describe('mentionHash', () => {
  it('stabil pro productId (unabhängig von Excerpt)', () => {
    expect(mentionHash('p1')).toBe(mentionHash('p1'))
  })
  it('verschiedene Produkte → verschiedene Hashes', () => {
    expect(mentionHash('p1')).not.toBe(mentionHash('p2'))
  })
})
```

- [ ] **Step 2: Test, Fehlschlag** → `npm test -- rankings-mention` → FAIL.

- [ ] **Step 3: `mention.ts`**

```typescript
// lib/rankings/mention.ts
import { createHash } from 'node:crypto'

/** Stabiler Mention-Hash: genau eine Mention pro (Produkt, News). NICHT vom
 *  nicht-deterministischen LLM-Excerpt abhängig (sonst Doppelzählung bei Re-Run). */
export function mentionHash(productId: string): string {
  return createHash('sha1').update(`${productId} primary`).digest('hex')
}
```

- [ ] **Step 4: Test** → `npm test -- rankings-mention` → PASS.

- [ ] **Step 5: `createRankingJob` + extract-Phase in `jobs.ts`**

Konstanten oben: `const EXTRACT_BATCH = 5`, `const EXTRACT_BUDGET_MS = 180_000`, `const EXTRACT_TAIL_MS = 45_000`, `const MAX_ITEM_ATTEMPTS = 3`, `const DAILY_WINDOW_DAYS = 7`, `const EXTRACT_VERSION = '1b-i'`.

`createRankingJob` (täglich idempotent):

```typescript
export async function createRankingJob(opts: { mode?: 'daily' | 'backfill' } = {}): Promise<{ created: boolean; reason?: string }> {
  const mode = opts.mode ?? 'daily'
  const supabase = createAdminClient()
  // run_date default current_date → Unique(mode, run_date) WHERE mode='daily' verhindert Mehrfach/Tag.
  const { error } = await supabase.from('ranking_jobs').insert({ mode, phase: 'extract', status: 'pending' })
  if (error?.code === '23505') return { created: false, reason: 'already_created_today' }
  if (error) return { created: false, reason: `insert_failed: ${error.message}` }
  return { created: true }
}
```

extract-`case` (ersetzt `noop_phase` für extract; alle DB-Fehler werfen, dedup, stabiler Hash, daily-Fenster, Ende→done):

```typescript
    case 'extract': {
      const startedAt = Date.now()
      const { extractProducts } = await import('@/lib/rankings/extract-products')
      const { resolveProduct } = await import('@/lib/rankings/resolve-product')
      const { mentionHash } = await import('@/lib/rankings/mention')
      const { getModelForUseCase } = await import('@/lib/ai/model-config')
      const model = await getModelForUseCase('ranking_extract')
      const sinceIso = new Date(Date.now() - DAILY_WINDOW_DAYS * 86_400_000).toISOString()

      let processedAny = false
      while (Date.now() - startedAt < EXTRACT_BUDGET_MS - EXTRACT_TAIL_MS) {
        const sel = supabase
          .from('daily_repo')
          .select('id, title, content, newsletter_date, product_processing_attempts')
          .is('processed_for_products_at', null)
          .or(`product_processing_attempts.is.null,product_processing_attempts.lt.${MAX_ITEM_ATTEMPTS}`)
          .order('newsletter_date', { ascending: false })
          .limit(EXTRACT_BATCH)
        if (j.mode === 'daily') sel.gte('newsletter_date', sinceIso) // Daily: nur jüngstes Fenster
        const { data: items, error: selErr } = await sel
        if (selErr) throw new Error(`daily_repo fetch: ${selErr.message}`)
        if (!items || items.length === 0) {
          // 1b-i: KEIN Wechsel zu enrich (noop) → Job sauber abschließen, sonst Hänger.
          const { error: doneErr } = await supabase.from('ranking_jobs')
            .update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', j.id)
          if (doneErr) throw new Error(`job done: ${doneErr.message}`)
          return processedAny ? 'extract_done' : 'extract_empty'
        }
        for (const item of items) {
          try {
            const res = await extractProducts(item.title ?? '', item.content ?? '')
            if (!res.ok) throw new Error(`extract: ${res.error}`) // retrybar: Item NICHT als verarbeitet markieren
            const seen = new Set<string>()
            for (const prod of res.products) {
              const { productId } = await resolveProduct({ vendor: prod.vendor, detectedName: prod.name, evidence: `daily_repo:${item.id}` })
              if (seen.has(productId)) continue // Dedup pro Item
              seen.add(productId)
              const { error: mErr } = await supabase.from('product_mentions').insert({
                product_id: productId, daily_repo_id: item.id,
                excerpt: (prod.excerpt ?? '').slice(0, 2000), excerpt_hash: mentionHash(productId),
                mention_date: item.newsletter_date, model,
              })
              if (mErr && mErr.code !== '23505') throw new Error(`mention insert: ${mErr.message}`)
            }
            const { error: upErr } = await supabase.from('daily_repo').update({
              processed_for_products_at: new Date().toISOString(),
              processed_for_products_version: EXTRACT_VERSION,
              processed_for_products_model: model,
            }).eq('id', item.id)
            if (upErr) throw new Error(`processed update: ${upErr.message}`)
            processedAny = true
          } catch (itemErr) {
            const msg = itemErr instanceof Error ? itemErr.message : String(itemErr)
            await supabase.from('daily_repo').update({
              product_processing_attempts: (item.product_processing_attempts ?? 0) + 1,
              product_processing_error: msg.slice(0, 500),
            }).eq('id', item.id)
          }
          await supabase.from('ranking_jobs').update({ last_advanced_at: new Date().toISOString() }).eq('id', j.id)
          if (Date.now() - startedAt >= EXTRACT_BUDGET_MS - EXTRACT_TAIL_MS) break
        }
      }
      return 'extract_progress'
    }
```

(`j` = das geclaimte Job-Objekt; falls die bestehende Variable anders heißt, anpassen. `enrich/research/aggregate/assets` bleiben `noop_phase`.)

- [ ] **Step 6: Typecheck + bestehende Tests** → `npm run build` (bis „Compiled successfully") + `npm test -- rankings` (alle grün).

- [ ] **Step 7: Commit**

```bash
git add lib/rankings/jobs.ts lib/rankings/mention.ts tests/lib/rankings-mention.test.ts
git commit -m "feat(rankings): extract-Phase (daily-gedeckelt, dedup, idempotent, fehler-/hänger-sicher) + createRankingJob

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Cron-Verdrahtung mit Budget-Guard + Heartbeat-Metriken

**Files:**
- Modify: `app/api/cron/scheduled-tasks/route.ts`

- [ ] **Step 1: Cron-Block ergänzen** (nach dem `advanceArticleJob`-Block). Erfasse zu Beginn des Handlers `const schedulerStartedAt = Date.now()` (falls nicht vorhanden).

```typescript
  // Rankings: tägliches extract-Enqueue + jeden Tick eine Phase weiter, NUR wenn
  // genug Tick-Budget übrig ist (Article-Job hat Vorrang). advanceRankingJob ist
  // Claim-/Lease-geschützt (FOR UPDATE SKIP LOCKED).
  try {
    const remainingMs = 300_000 - (Date.now() - schedulerStartedAt)
    if (currentHour >= 6) {
      const { createRankingJob } = await import('@/lib/rankings/jobs')
      results.rankingEnqueue = (await createRankingJob({ mode: 'daily' })).created ? 'enqueued' : 'skipped'
    }
    if (remainingMs > 150_000) {
      const { advanceRankingJob } = await import('@/lib/rankings/jobs')
      results.rankingJob = await advanceRankingJob()
    } else {
      results.rankingJob = 'skipped_budget'
    }
  } catch (error) {
    console.error('[Scheduler] Ranking job error:', error)
    results.rankingJob = 'error'
  }
```

Im heartbeat-`value`-Objekt ergänzen: `rankingJob: results.rankingJob ?? null, rankingEnqueue: results.rankingEnqueue ?? null`.

- [ ] **Step 2: Typecheck** → `npm run build` (bis „Compiled successfully").

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/scheduled-tasks/route.ts
git commit -m "feat(rankings): Cron-Verdrahtung mit Budget-Guard + Heartbeat

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Controller-Prod-Verifikation (nach Task 4) — MINI-SAMPLE, nicht volle Queue

`vercel env pull --environment=production`. Wegwerf-Skript (tsx), bewusst klein, um Kosten zu begrenzen:
1. `createRankingJob({mode:'daily'})` → `{created:true}`; sofort nochmal → `already_created_today` (tägliche Idempotenz ✓).
2. `advanceRankingJob()` 1–3× (intern `EXTRACT_BATCH` ggf. temporär 1) bis `extract_done`/`extract_empty`.
3. Stichprobe: einige `daily_repo` haben `processed_for_products_at`; `products`/`product_mentions` enthalten plausible AI-Produkte — **manuell sichten** (Extraktionsqualität, Vendor-Konsistenz).
4. Zweiter advance-Lauf erzeugt KEINE doppelten Mentions (Idempotenz) und der Job ist `done` (kein Hänger, `enrich` wurde nicht betreten).
5. Cleanup der Test-Mentions/-Produkte/-Jobs nach Bedarf.

## Self-Review (Review-Feedback eingearbeitet)

**P0:** (1) `extractProducts`-Result-Typ, Provider-Fehler ⇒ throw, Item nicht processed ✓; (2) attempts NULL-safe Query ✓; (3) alle DB-Fehler geworfen ✓; (4) extract→`done` statt `enrich` (kein Hänger) ✓; (5) run_date + Unique + 23505 (ein Daily-Job/Tag) ✓; (6) stabiler `mentionHash(productId)` statt LLM-Excerpt ✓; (7) Dedup pro productId/Item ✓; (8) Daily-Fenster 7 Tage ✓; (9) Reihenfolge eindeutig (daily neueste zuerst) ✓; (10) Cron-Budget-Guard + LLM-AbortController-Timeout ✓; (11) Schema prod-verifiziert ✓; (12) Prompt-Härtung Vendor ohne Rechtsform/Publisher ✓.
**P1:** max_tokens 1536 ✓; Prompt gehärtet (leere Liste, keine Erfindung) ✓; zod-Längenlimits ✓; Mini-Sample-Verifikation ✓; usage/Token im Result (Spend-Anbindung vorbereitet) ✓.

**Offen für 1b-ii+ (notiert):** Token-/Spend-Budget aktiv durchsetzen (Pause bei Überschreitung); Reprocessing-Strategie bei `processed_for_products_version`-Bump; Heartbeat-Detailmetriken (processed/mentionsCreated); Übergang extract→enrich.

**Placeholder-Scan:** keine TODO/TBD. `j` = geclaimtes Job-Objekt (Implementer prüft den exakten Variablennamen im bestehenden `advanceRankingJob`).

## Nicht in 1b-i (→ 1b-ii/iii/iv, 1c)

Taxonomie-Resolve + `product_mention_categories`; Sentiment + `product_feature_observations`; Fuzzy-Disambiguierung + RPCs; Score/Aggregation; aktive Spend-Durchsetzung; extract→enrich-Übergang.
