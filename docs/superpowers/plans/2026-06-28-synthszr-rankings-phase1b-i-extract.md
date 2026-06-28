# Synthszr Rankings — Phase 1b-i (extract-Phase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die erste Pipeline-Phase (`extract`) funktionsfähig machen: unverarbeitete `daily_repo`-News werden batchweise vom LLM nach AI-Produkten durchsucht, jedes Produkt über `resolveProduct` (Phase 1a) aufgelöst und als `product_mentions` verknüpft — resumable, idempotent, im 300s-Budget, vom 15-Min-Cron getrieben. Sentiment/Kategorie/Features folgen in 1b-ii/iii.

**Architecture:** `extractProducts(text)` kapselt den LLM-Call (Anthropic tool-use → strukturiertes JSON, zod-validiert). Die `extract`-Phase in `advanceRankingJob` holt einen `daily_repo`-Batch (`processed_for_products_at IS NULL`, ältestes zuerst), ruft pro Item `extractProducts` + `resolveProduct` + `product_mentions`-Insert (idempotent via `UNIQUE(product_id, daily_repo_id, excerpt_hash)`), markiert das Item als verarbeitet und schreibt nach jedem Item Fortschritt. Pure Bausteine (Prompt, zod-Parse, mention-Payload/excerpt_hash) sind unit-testbar; LLM-/DB-Teile werden Controller-Prod-verifiziert.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk` (tool-use), zod, Supabase, vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-28-synthszr-rankings-design.md` §7 (Pipeline). **Memory:** `project_synthszr_rankings.md`.
- **Voraussetzungen (erfüllt):** `resolveProduct` (Phase 1a), `ranking_jobs`+`claim_ranking_job`-RPC, `product_mentions`-Schema mit `UNIQUE(product_id, daily_repo_id, excerpt_hash)`, `daily_repo.processed_for_products_at/_version/_model/_attempts/_error` (Phase 0).
- **Budget/Resumability:** Eine `extract`-Phase-Invocation bleibt unter ~200s (Cron-Tick). Fortschritt nach JEDEM verarbeiteten daily_repo-Item persistieren (`processed_for_products_at` + Job-`cursor`), damit ein Abbruch ohne Doppelarbeit resumed. Poison-Item-Schutz: `product_processing_attempts++`; Item mit ≥3 Versuchen überspringen + `product_processing_error` setzen.
- **Idempotenz:** Mehrfaches Verarbeiten desselben News-Items erzeugt keine doppelten Mentions (`UNIQUE`-Constraint + INSERT/23505-Catch). `resolveProduct` ist bereits idempotent.
- **LLM:** neuer model-config use-case `ranking_extract` (default günstig, hochvolumig). Anthropic tool-use erzwingt strukturiertes JSON; Output wird zod-validiert (defekter/leerer Output ⇒ leere Produktliste, kein Crash).
- **Versions-Sicherheit:** Produktauflösung über `resolveProduct` (exakter canonical_key) — keine Fuzzy-Logik hier.
- **Tests:** vitest. Pure Logik = Unit-Tests (keine SDK-/DB-Imports). LLM-/DB-Teile: Controller-Prod-Verifikation.
- **Commits:** ein Commit pro Task, auf `main`, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: `ranking_extract` use-case + `extractProducts` (LLM)

**Files:**
- Modify: `lib/ai/model-config.ts` (use-case-Definition + Typ)
- Create: `lib/rankings/extract-products.ts`
- Create: `tests/lib/rankings-extract-products.test.ts`

**Interfaces:**
- Produces: `interface ExtractedProduct { name: string; vendor: string; excerpt?: string }`; pure `buildExtractPrompt(title: string, content: string): string`; pure `parseExtractResponse(raw: unknown): ExtractedProduct[]` (zod, toleriert Müll → []); async `extractProducts(title: string, content: string): Promise<ExtractedProduct[]>` (LLM). Task 2 konsumiert `extractProducts` + `ExtractedProduct`.

- [ ] **Step 1: Failing tests (pure Teile) schreiben**

```typescript
// tests/lib/rankings-extract-products.test.ts
import { describe, it, expect } from 'vitest'
import { buildExtractPrompt, parseExtractResponse } from '@/lib/rankings/extract-products'

describe('buildExtractPrompt', () => {
  it('enthält Titel und Inhalt', () => {
    const p = buildExtractPrompt('OpenAI ships GPT-5.6', 'GPT-5.6 is faster ...')
    expect(p).toContain('OpenAI ships GPT-5.6')
    expect(p).toContain('GPT-5.6 is faster')
  })
})

describe('parseExtractResponse', () => {
  it('parst gültige Produktliste', () => {
    const r = parseExtractResponse({ products: [{ name: 'GPT-5.6', vendor: 'OpenAI', excerpt: 'x' }] })
    expect(r).toEqual([{ name: 'GPT-5.6', vendor: 'OpenAI', excerpt: 'x' }])
  })
  it('filtert Einträge ohne name/vendor', () => {
    const r = parseExtractResponse({ products: [{ name: 'GPT-5.6', vendor: 'OpenAI' }, { name: '' }, { vendor: 'x' }] })
    expect(r).toHaveLength(1)
  })
  it('toleriert Müll/leeren Output → leere Liste', () => {
    expect(parseExtractResponse(null)).toEqual([])
    expect(parseExtractResponse({})).toEqual([])
    expect(parseExtractResponse({ products: 'nope' })).toEqual([])
  })
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag** → `npm test -- rankings-extract-products` → FAIL (import).

- [ ] **Step 3: Implementierung**

Zuerst use-case in `lib/ai/model-config.ts` ergänzen — den `UseCase`-Union-Typ um `'ranking_extract'` erweitern UND in `USE_CASE_DEFINITIONS` eintragen:

```typescript
  ranking_extract: {
    label: 'Rankings — Produkt-Extraktion',
    description: 'AI-Produkte aus News-Items extrahieren (hochvolumig)',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
```

Dann `lib/rankings/extract-products.ts`:

```typescript
import { z } from 'zod'

export interface ExtractedProduct { name: string; vendor: string; excerpt?: string }

const ProductSchema = z.object({
  name: z.string().min(1),
  vendor: z.string().min(1),
  excerpt: z.string().optional(),
})
const ResponseSchema = z.object({ products: z.array(z.unknown()) })

/** Baut den Extraktions-Prompt (pure). */
export function buildExtractPrompt(title: string, content: string): string {
  return `Extrahiere ALLE konkret benannten AI-PRODUKTE aus dieser Tech-News. Nur echte Produkte/Modelle/Tools (z.B. "GPT-5.6", "Cursor", "Cdance 2.5"), KEINE Firmen ohne Produkt, keine generischen Begriffe. Pro Produkt: exakter Name inkl. Version, der Vendor/Hersteller, und ein kurzer wörtlicher Beleg-Ausschnitt (excerpt) aus dem Text.

TITEL: ${title}

INHALT:
${content.slice(0, 8000)}`
}

/** Validiert/filtert den (tool-use-)Output robust. Müll ⇒ []. */
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

/** LLM-Extraktion via Anthropic tool-use (erzwingt strukturiertes JSON). */
export async function extractProducts(title: string, content: string): Promise<ExtractedProduct[]> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { getModelForUseCase } = await import('@/lib/ai/model-config')
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
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, vendor: { type: 'string' }, excerpt: { type: 'string' } },
            required: ['name', 'vendor'],
          },
        },
      },
      required: ['products'],
    },
  }
  try {
    const resp = await client.messages.create({
      model, max_tokens: 4096, tools: [tool],
      tool_choice: { type: 'tool', name: 'report_products' },
      messages: [{ role: 'user', content: buildExtractPrompt(title, content) }],
    })
    const block = resp.content.find((b) => b.type === 'tool_use')
    return parseExtractResponse(block && 'input' in block ? block.input : null)
  } catch (err) {
    console.error('[Rankings/extract] LLM failed:', err)
    return []
  }
}
```

- [ ] **Step 4: Test laufen lassen** → `npm test -- rankings-extract-products` → PASS. **Typecheck:** `npx tsc --noEmit` → keine Fehler.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/model-config.ts lib/rankings/extract-products.ts tests/lib/rankings-extract-products.test.ts
git commit -m "feat(rankings): extractProducts (LLM tool-use) + ranking_extract use-case

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `createRankingJob` + extract-Phase-Body

**Files:**
- Modify: `lib/rankings/jobs.ts`
- Create: `lib/rankings/mention.ts`
- Create: `tests/lib/rankings-mention.test.ts`

**Interfaces:**
- Produces: `createRankingJob(opts?: { mode?: 'daily'|'backfill' }): Promise<{ created: boolean; reason?: string }>`; pure `excerptHash(productId: string, excerpt: string): string` + `buildMentionRow(...)` in `mention.ts`; gefüllter `extract`-case in `advanceRankingJob`.
- Consumes: `extractProducts`/`ExtractedProduct` (Task 1); `resolveProduct` (1a); `createAdminClient`.

- [ ] **Step 1: Failing test (pure mention-Helper) schreiben**

```typescript
// tests/lib/rankings-mention.test.ts
import { describe, it, expect } from 'vitest'
import { excerptHash } from '@/lib/rankings/mention'

describe('excerptHash', () => {
  it('deterministisch + stabil pro (productId, excerpt)', () => {
    expect(excerptHash('p1', 'hello')).toBe(excerptHash('p1', 'hello'))
  })
  it('verschiedene Excerpts → verschiedene Hashes', () => {
    expect(excerptHash('p1', 'a')).not.toBe(excerptHash('p1', 'b'))
  })
  it('leerer Excerpt ist stabil', () => {
    expect(excerptHash('p1', '')).toBe(excerptHash('p1', ''))
  })
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag** → `npm test -- rankings-mention` → FAIL (import).

- [ ] **Step 3: `mention.ts` implementieren**

```typescript
// lib/rankings/mention.ts
import { createHash } from 'node:crypto'

/** Stabiler Hash für UNIQUE(product_id, daily_repo_id, excerpt_hash). */
export function excerptHash(productId: string, excerpt: string): string {
  return createHash('sha1').update(`${productId} ${excerpt}`).digest('hex')
}
```

- [ ] **Step 4: Test laufen lassen** → `npm test -- rankings-mention` → PASS.

- [ ] **Step 5: `createRankingJob` + extract-Phase in `jobs.ts` implementieren**

`createRankingJob` (am Ende von `jobs.ts` ergänzen): idempotent — kein neuer Job, wenn schon ein offener (`pending`/`processing`) Job desselben `mode` existiert.

```typescript
export async function createRankingJob(opts: { mode?: 'daily' | 'backfill' } = {}): Promise<{ created: boolean; reason?: string }> {
  const mode = opts.mode ?? 'daily'
  const supabase = createAdminClient()
  const { data: open } = await supabase
    .from('ranking_jobs').select('id').eq('mode', mode).in('status', ['pending', 'processing']).maybeSingle()
  if (open) return { created: false, reason: 'job_exists' }
  const { error } = await supabase.from('ranking_jobs').insert({ mode, phase: 'extract', status: 'pending' })
  if (error) return { created: false, reason: `insert_failed: ${error.message}` }
  return { created: true }
}
```

Den `extract`-case im `switch` durch einen echten Body ersetzen (Signatur von `advanceRankingJob` bleibt; `job` enthält `id`, `cursor`). Konstanten oben in der Datei: `const EXTRACT_BATCH = 5`, `const EXTRACT_BUDGET_MS = 180_000`, `const MAX_ITEM_ATTEMPTS = 3`, `const EXTRACT_VERSION = '1b-i'`.

```typescript
    case 'extract': {
      const startedAt = Date.now()
      const { extractProducts } = await import('@/lib/rankings/extract-products')
      const { resolveProduct } = await import('@/lib/rankings/resolve-product')
      const { excerptHash } = await import('@/lib/rankings/mention')
      const model = (await import('@/lib/ai/model-config')).getModelForUseCase
        ? await (await import('@/lib/ai/model-config')).getModelForUseCase('ranking_extract')
        : 'unknown'

      let processedAny = false
      while (Date.now() - startedAt < EXTRACT_BUDGET_MS) {
        const { data: items } = await supabase
          .from('daily_repo')
          .select('id, title, content, newsletter_date, product_processing_attempts')
          .is('processed_for_products_at', null)
          .lt('product_processing_attempts', MAX_ITEM_ATTEMPTS)
          .order('newsletter_date', { ascending: false })
          .limit(EXTRACT_BATCH)
        if (!items || items.length === 0) {
          // Keine offenen Items mehr → Phase abgeschlossen
          await supabase.from('ranking_jobs').update({ phase: 'enrich', cursor: 0 }).eq('id', job.id)
          return processedAny ? 'extract_done' : 'extract_empty'
        }
        for (const item of items) {
          try {
            const products = await extractProducts(item.title ?? '', item.content ?? '')
            for (const prod of products) {
              const { productId } = await resolveProduct({
                vendor: prod.vendor, detectedName: prod.name,
                evidence: `daily_repo:${item.id}`,
              })
              const excerpt = (prod.excerpt ?? '').slice(0, 2000)
              const { error: mErr } = await supabase.from('product_mentions').insert({
                product_id: productId, daily_repo_id: item.id,
                excerpt, excerpt_hash: excerptHash(productId, excerpt),
                mention_date: item.newsletter_date, model,
              })
              if (mErr && mErr.code !== '23505') throw mErr // 23505 = schon erfasst (idempotent)
            }
            await supabase.from('daily_repo').update({
              processed_for_products_at: new Date().toISOString(),
              processed_for_products_version: EXTRACT_VERSION,
              processed_for_products_model: model,
            }).eq('id', item.id)
            processedAny = true
          } catch (itemErr) {
            const msg = itemErr instanceof Error ? itemErr.message : String(itemErr)
            await supabase.from('daily_repo').update({
              product_processing_attempts: (item.product_processing_attempts ?? 0) + 1,
              product_processing_error: msg.slice(0, 500),
            }).eq('id', item.id)
          }
          await supabase.from('ranking_jobs').update({ last_advanced_at: new Date().toISOString() }).eq('id', job.id)
          if (Date.now() - startedAt >= EXTRACT_BUDGET_MS) break
        }
      }
      return 'extract_progress'
    }
```

(Die übrigen cases enrich/research/aggregate/assets bleiben `noop_phase` bis 1b-ii+.)

- [ ] **Step 6: Typecheck** → `npm run build` (bis „Compiled successfully") oder `npx tsc --noEmit` → keine Fehler in `jobs.ts`/`mention.ts`. Bestehende Tests grün: `npm test -- rankings`.

- [ ] **Step 7: Commit**

```bash
git add lib/rankings/jobs.ts lib/rankings/mention.ts tests/lib/rankings-mention.test.ts
git commit -m "feat(rankings): createRankingJob + extract-Phase (News→Produkte→mentions)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Cron-Verdrahtung + tägliches Enqueue

**Files:**
- Modify: `app/api/cron/scheduled-tasks/route.ts`

**Interfaces:**
- Consumes: `advanceRankingJob`, `createRankingJob` (Task 2).

- [ ] **Step 1: Cron-Block ergänzen** (nach dem bestehenden `advanceArticleJob`-Block, vor dem heartbeat-Upsert)

```typescript
  // Rankings: ein tägliches extract-Enqueue + jeden Tick eine Phase weiter.
  // Läuft NACH dem Article-Job (dessen Morgenfenster Vorrang hat), nutzt die
  // idle Tages-Ticks. advanceRankingJob ist Lease-/Claim-geschützt (FOR UPDATE
  // SKIP LOCKED) und jede Phase bleibt unter ~200s.
  try {
    const { advanceRankingJob, createRankingJob } = await import('@/lib/rankings/jobs')
    // Einmal täglich (z.B. ab 06:00 MEZ, nach dem Auto-Post-Fenster) enqueuen:
    if (currentHour >= 6) {
      results.rankingEnqueue = (await createRankingJob({ mode: 'daily' })).created ? 'enqueued' : 'skipped'
    }
    results.rankingJob = await advanceRankingJob()
  } catch (error) {
    console.error('[Scheduler] Ranking job error:', error)
    results.rankingJob = 'error'
  }
```

Und im heartbeat-`value`-Objekt `rankingJob: results.rankingJob ?? null` ergänzen.

- [ ] **Step 2: Typecheck** → `npm run build` (bis „Compiled successfully").

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/scheduled-tasks/route.ts
git commit -m "feat(rankings): Cron-Verdrahtung — tägliches extract-Enqueue + advanceRankingJob pro Tick

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Controller-Prod-Verifikation (nach Task 3)

`vercel env pull --environment=production` ins Scratchpad. Wegwerf-Skript (tsx): (1) `createRankingJob({mode:'daily'})` → `{created:true}`; (2) `advanceRankingJob()` ein paar Mal aufrufen, bis `extract_done`/`extract_empty`; (3) REST-Query: einige `daily_repo` haben jetzt `processed_for_products_at` gesetzt, `products` + `product_mentions` enthalten plausible AI-Produkte (Stichprobe manuell sichten — Extraktionsqualität); (4) zweiter advance-Lauf erzeugt keine doppelten Mentions (Idempotenz). Job danach auf `done` setzen oder löschen. **Kostenhinweis:** echte LLM-Calls pro News-Item — Batch klein halten / nur wenige Ticks für die Verifikation.

## Self-Review

**Spec-Coverage (§7 extract):** batched daily_repo-Lesen (processed_for_products_at IS NULL) ✓, resolveProduct pro Produkt ✓, product_mentions idempotent (UNIQUE + 23505) ✓, processed-Markierung + versioniert ✓, Poison-Item-Skip (attempts) ✓, Budget + per-Item-Fortschritt (resumable) ✓, Phase→enrich-Übergang ✓, Cron jeden Tick + tägliches Enqueue + heartbeat ✓.

**TDD-Grenze:** Pure Teile (Prompt, zod-Parse, excerptHash) unit-getestet. LLM-/DB-Phase = Controller-Prod-verifiziert (LLM-Output nicht deterministisch unit-testbar; ehrlich dokumentiert statt Schein-Tests).

**Placeholder-Scan:** keine TODO/TBD. Der `getModelForUseCase`-Doppel-Import in Task 2 Step 5 ist umständlich — der Implementer darf ihn zu einem sauberen `const { getModelForUseCase } = await import('@/lib/ai/model-config')` vereinfachen (gleiches Verhalten).

**Konsistenz:** `ExtractedProduct`/`extractProducts` (Task 1) → extract-Phase (Task 2). `excerptHash` (Task 2) → mention-Insert. `createRankingJob`/`advanceRankingJob` (Task 2) → Cron (Task 3).

## Nicht in 1b-i (→ 1b-ii/iii/iv, 1c)

Taxonomie-Resolve + `product_mention_categories` (1b-ii); Sentiment + `product_feature_observations` (enrich, 1b-iii); Fuzzy-/Embedding-Disambiguierung + RPCs (1b-iv); Score/Aggregation (1c). Diese Phasen bleiben vorerst `noop_phase`/leer.
