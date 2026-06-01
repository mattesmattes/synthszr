# Assistiertes Lern-Ranking (MVP: Phase 0–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein assistiertes Ranking, das täglich aus ~150 `news_queue`-Items ~10–15 begründete Vorschläge erzeugt, die Mattes bestätigt/korrigiert — und das die Korrekturen persistent als Labels speichert.

**Architecture:** Zweistufig — (1) billiger Recall-Vorfilter via Reciprocal Rank Fusion aus `total_score` + pgvector-Ähnlichkeit zu publizierten „Winnern", (2) LLM-Listwise-Rerank mit Begründung. Feedback landet in `ranking_suggestions` als Label-Store. Eval-Harness (Recall@15/NDCG@15) misst gegen publizierte Items.

**Tech Stack:** Next.js 16 / TypeScript / Supabase (Postgres + pgvector) / Anthropic SDK / Vitest. Spiegelt die Muster aus `lib/search/rerank.ts`, `lib/synthesis/score.ts`, `lib/edit-learning/*`.

**Scope:** Dieser Plan deckt **Phase 0–2** (das MVP) aus dem Spec `docs/superpowers/specs/2026-06-01-assisted-article-ranking-design.md`. **Phase 3** (aktiver Lern-Loop: `ranking_preferences` + Confidence/Decay-Extraktion) ist ein **Folge-Plan** — er braucht erst akkumulierte Labels aus diesem MVP und ist eigenständig shippbar.

**Hinweis zur Spec-Abweichung (Phase-0-Label-Fix):** Die Spec nannte „2h-Auto-Reset in `getSelectedItems()` reparieren". Wir ändern diesen Reset **nicht** (er recycelt verwaiste Ghostwriter-Auswahlen und ist nach Einführung des separaten Label-Stores harmlos). Die geforderte *persistente* Korrektur-Historie entsteht stattdessen sauberer über die neue Tabelle `ranking_suggestions` + den Feedback-Endpoint (Task 13). Das erfüllt die Spec-Anforderung („persistentes accept/reject/add-Logging") ohne den bestehenden Flow zu destabilisieren.

---

## File Structure

**Neu:**
- `supabase/migrations/20260601000000_assisted_ranking.sql` — Tabellen `ranking_runs`, `ranking_suggestions` + RPC `get_winner_similarity`.
- `lib/news-queue/ranking-types.ts` — geteilte TS-Typen.
- `lib/news-queue/metrics.ts` — pure `recallAtK`, `ndcgAtK`.
- `lib/news-queue/rrf.ts` — pure `reciprocalRankFusion`.
- `lib/news-queue/winner-similarity.ts` — RPC-Wrapper `getWinnerSimilarity`.
- `lib/news-queue/reranker-parse.ts` — pure `parseRerankerResponse`.
- `lib/news-queue/few-shot.ts` — pure `buildRerankerPrompt`.
- `lib/news-queue/reranker.ts` — `runReranker` (Anthropic-Call).
- `lib/news-queue/suggestions.ts` — DB-Zugriff auf `ranking_runs`/`ranking_suggestions`.
- `lib/news-queue/ranking-service.ts` — Orchestrierung Stufe 1+2 (`generateRankingSuggestions`).
- `app/api/admin/ranking/route.ts` — POST (generieren) + GET (letzter Lauf).
- `app/api/admin/ranking-feedback/route.ts` — POST (Aktion loggen).
- `components/admin/ranking-suggestions-panel.tsx` — UI-Panel.
- `scripts/eval-ranking.ts` — Eval-Harness-Skript.
- Tests: `tests/lib/ranking-metrics.test.ts`, `tests/lib/ranking-rrf.test.ts`, `tests/lib/ranking-parse.test.ts`, `tests/lib/ranking-fewshot.test.ts`, `tests/api/ranking.test.ts`.

**Modifiziert:**
- `lib/ai/model-config.ts` — neuer `UseCase` `'queue_ranking'`.
- `app/admin/news-queue/page.tsx` — Panel mounten.

---

## PHASE 0 — Foundation & Eval

### Task 1: `queue_ranking` UseCase in model-config

**Files:**
- Modify: `lib/ai/model-config.ts`
- Test: `tests/lib/ranking-modelconfig.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/ranking-modelconfig.test.ts
import { describe, it, expect } from 'vitest'
import { USE_CASE_DEFINITIONS } from '@/lib/ai/model-config'

describe('queue_ranking use case', () => {
  it('is defined with an anthropic default model', () => {
    const def = USE_CASE_DEFINITIONS['queue_ranking']
    expect(def).toBeDefined()
    expect(def.defaultModel).toBe('claude-sonnet-4-6-20260301')
    expect(def.allowedProviders).toContain('anthropic')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/ranking-modelconfig.test.ts`
Expected: FAIL — `def` is undefined (TS may also error on the index type).

- [ ] **Step 3: Add the use case**

In `lib/ai/model-config.ts`, add `'queue_ranking'` to the `UseCase` union (after `'pattern_extraction'`):

```typescript
  | 'pattern_extraction'
  | 'queue_ranking'
  | 'image_generation'
```

And add to `USE_CASE_DEFINITIONS` (after the `pattern_extraction` entry):

```typescript
  queue_ranking: {
    label: 'Queue-Ranking',
    description: 'News-Queue-Artikel nach persönlichem Geschmack vorschlagen',
    defaultModel: 'claude-sonnet-4-6-20260301',
    allowedProviders: ['anthropic', 'google'],
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/ranking-modelconfig.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/ai/model-config.ts tests/lib/ranking-modelconfig.test.ts
git commit -m "feat(ranking): add queue_ranking model use case"
```

---

### Task 2: Migration — tables + winner-similarity RPC

**Files:**
- Create: `supabase/migrations/20260601000000_assisted_ranking.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Assisted Ranking: label store + winner-similarity RPC
-- Spec: docs/superpowers/specs/2026-06-01-assisted-article-ranking-design.md

-- 1) One row per ranking run (one daily invocation)
CREATE TABLE IF NOT EXISTS ranking_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_count INT NOT NULL DEFAULT 0,
  suggested_count INT NOT NULL DEFAULT 0,
  stage1_method TEXT NOT NULL DEFAULT 'rrf',   -- 'rrf' | 'all'
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE ranking_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON ranking_runs FOR ALL USING (true);

-- 2) The label store: one row per suggested (or user-added) item per run
CREATE TABLE IF NOT EXISTS ranking_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES ranking_runs(id) ON DELETE CASCADE,
  queue_item_id UUID NOT NULL REFERENCES news_queue(id) ON DELETE CASCADE,
  suggested_rank INT,                  -- NULL when user-added (not suggested)
  llm_reason TEXT,
  confidence FLOAT,
  user_action TEXT NOT NULL DEFAULT 'pending'
    CHECK (user_action IN ('pending','accepted','rejected','added','reordered')),
  final_rank INT,
  acted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(run_id, queue_item_id)
);
CREATE INDEX idx_ranking_suggestions_run ON ranking_suggestions(run_id);
CREATE INDEX idx_ranking_suggestions_action ON ranking_suggestions(user_action);
ALTER TABLE ranking_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON ranking_suggestions FOR ALL USING (true);

-- 3) Winner-similarity: max cosine similarity of each candidate to the
--    embeddings of items that made it into PUBLISHED posts ("winners").
--    Winner extraction reuses the published-queueItemId query from
--    20260328_optimized_scoring.sql.
CREATE OR REPLACE FUNCTION get_winner_similarity(
  candidate_ids UUID[],
  winner_limit INT DEFAULT 60
)
RETURNS TABLE (queue_item_id UUID, similarity FLOAT)
LANGUAGE sql STABLE
AS $$
  WITH winners AS (
    SELECT dr.embedding
    FROM generated_posts gp
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE jsonb_typeof(gp.content::jsonb)
        WHEN 'object' THEN gp.content::jsonb->'content'
        WHEN 'array'  THEN gp.content::jsonb
        ELSE '[]'::jsonb
      END
    ) AS elem
    JOIN news_queue nq ON nq.id = (elem->'attrs'->>'queueItemId')::uuid
    JOIN daily_repo dr ON dr.id = nq.daily_repo_id
    WHERE gp.status = 'published'
      AND elem->>'type' = 'heading'
      AND elem->'attrs'->>'queueItemId' IS NOT NULL
      AND elem->'attrs'->>'queueItemId' <> 'null'
      AND dr.embedding IS NOT NULL
    ORDER BY gp.created_at DESC
    LIMIT winner_limit
  ),
  cand AS (
    SELECT nq.id AS queue_item_id, dr.embedding
    FROM news_queue nq
    JOIN daily_repo dr ON dr.id = nq.daily_repo_id
    WHERE nq.id = ANY(candidate_ids)
      AND dr.embedding IS NOT NULL
  )
  SELECT c.queue_item_id,
         MAX(1 - (c.embedding <=> w.embedding))::float AS similarity
  FROM cand c CROSS JOIN winners w
  GROUP BY c.queue_item_id;
$$;
```

- [ ] **Step 2: Verify `generated_posts.created_at` exists (the RPC orders by it)**

Run (via Supabase MCP `mcp__plugin_supabase_supabase` apply/SQL, or `psql`):
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'generated_posts' AND column_name = 'created_at';
```
Expected: one row `created_at`. If absent, replace `gp.created_at` with `gp.updated_at` in the migration before applying.

- [ ] **Step 3: Apply the migration**

Run: `npx supabase db push` (applies pending files in `supabase/migrations/`).
Expected: `Applying migration 20260601000000_assisted_ranking.sql...` with no error.
(Alternative: apply the SQL via the Supabase MCP tool against the project.)

- [ ] **Step 4: Verify objects exist**

Run:
```sql
SELECT to_regclass('public.ranking_suggestions') IS NOT NULL AS has_table,
       to_regprocedure('public.get_winner_similarity(uuid[],int)') IS NOT NULL AS has_rpc;
```
Expected: `has_table = true`, `has_rpc = true`.

- [ ] **Step 5: Smoke-test the RPC with real candidates**

Run:
```sql
SELECT * FROM get_winner_similarity(
  ARRAY(SELECT id FROM news_queue WHERE status='pending' LIMIT 5)::uuid[],
  60
);
```
Expected: 0–5 rows with `similarity` between 0 and 1 (candidates whose `daily_repo` has no embedding are simply absent).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260601000000_assisted_ranking.sql
git commit -m "feat(ranking): add ranking_suggestions tables and winner-similarity RPC"
```

---

### Task 3: Shared ranking types

**Files:**
- Create: `lib/news-queue/ranking-types.ts`

- [ ] **Step 1: Write the types**

```typescript
// lib/news-queue/ranking-types.ts

/** A candidate item entering the ranking pipeline. */
export interface RankingCandidate {
  queueItemId: string
  title: string
  excerpt: string | null
  source: string | null
  totalScore: number
  winnerSimilarity: number // 0 when no winner match
}

/** One LLM suggestion produced by the reranker. */
export interface RankedSuggestion {
  queueItemId: string
  rank: number
  reason: string
  confidence: number
}

/** A positive/negative example for the few-shot block. */
export interface LabelExample {
  title: string
  source: string | null
}

export type UserAction = 'pending' | 'accepted' | 'rejected' | 'added' | 'reordered'
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `ranking-types.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/news-queue/ranking-types.ts
git commit -m "feat(ranking): add shared ranking types"
```

---

### Task 4: Eval metrics (pure, TDD)

**Files:**
- Create: `lib/news-queue/metrics.ts`
- Test: `tests/lib/ranking-metrics.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/ranking-metrics.test.ts
import { describe, it, expect } from 'vitest'
import { recallAtK, ndcgAtK } from '@/lib/news-queue/metrics'

describe('recallAtK', () => {
  it('is fraction of relevant items found in top K', () => {
    // relevant = {a,b,c,d}; ranked top-3 = [a,x,b] → 2 of 4 found
    expect(recallAtK(['a', 'x', 'b', 'y'], new Set(['a', 'b', 'c', 'd']), 3)).toBeCloseTo(0.5)
  })
  it('returns 0 when no relevant items exist', () => {
    expect(recallAtK(['a', 'b'], new Set<string>(), 2)).toBe(0)
  })
  it('caps consideration at K', () => {
    expect(recallAtK(['x', 'x', 'a'], new Set(['a']), 2)).toBe(0)
  })
})

describe('ndcgAtK', () => {
  it('is 1.0 for a perfect ranking', () => {
    expect(ndcgAtK(['a', 'b'], new Set(['a', 'b']), 2)).toBeCloseTo(1.0)
  })
  it('is lower when relevant items rank late', () => {
    const perfect = ndcgAtK(['a', 'b'], new Set(['a', 'b']), 2)
    const worse = ndcgAtK(['x', 'a'], new Set(['a']), 2)
    expect(worse).toBeLessThan(perfect)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/ranking-metrics.test.ts`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Implement the metrics**

```typescript
// lib/news-queue/metrics.ts

/** Recall@K: fraction of the relevant set that appears in the top-K ranking. */
export function recallAtK(ranked: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0
  const topK = ranked.slice(0, k)
  let hits = 0
  for (const id of topK) if (relevant.has(id)) hits++
  return hits / relevant.size
}

/** NDCG@K with binary relevance. */
export function ndcgAtK(ranked: string[], relevant: Set<string>, k: number): number {
  const topK = ranked.slice(0, k)
  let dcg = 0
  topK.forEach((id, i) => {
    if (relevant.has(id)) dcg += 1 / Math.log2(i + 2)
  })
  const idealHits = Math.min(relevant.size, k)
  let idcg = 0
  for (let i = 0; i < idealHits; i++) idcg += 1 / Math.log2(i + 2)
  return idcg === 0 ? 0 : dcg / idcg
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/ranking-metrics.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/news-queue/metrics.ts tests/lib/ranking-metrics.test.ts
git commit -m "feat(ranking): add recall@k and ndcg@k metrics"
```

---

### Task 5: Eval harness script (baseline)

**Files:**
- Create: `scripts/eval-ranking.ts`

- [ ] **Step 1: Write the script**

Computes the published "ground truth" per post and reports baseline Recall@15/NDCG@15 of the existing `total_score` ordering. Reuses the published-queueItemId extraction.

**Convention note:** standalone `tsx` scripts in this repo do NOT use the `@/` alias (tsx doesn't resolve tsconfig paths reliably here) and load env via `dotenv` — mirror `scripts/analyze-queue-scoring.ts`. Import only pure lib modules by relative path; call DB/RPC directly via the script's own client (never import `@/lib/supabase/admin` transitively).

```typescript
// scripts/eval-ranking.ts
// Run: npx tsx scripts/eval-ranking.ts [--stage1]
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
// Relative import — metrics.ts is pure (no `@/` imports), safe under tsx.
import { recallAtK, ndcgAtK } from '../lib/news-queue/metrics'

const root = resolve(import.meta.dirname || __dirname, '..')
config({ path: [resolve(root, '.env.prod.temp'), resolve(root, '.env.local')] })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  // 1) Ground truth: published queueItemIds grouped by post.
  const { data: posts, error } = await supabase
    .from('generated_posts')
    .select('id, content, created_at')
    .eq('status', 'published')
  if (error) throw error

  const K = 15
  const recalls: number[] = []
  const ndcgs: number[] = []

  for (const post of posts || []) {
    const relevant = extractQueueItemIds(post.content)
    if (relevant.size === 0) continue

    // Candidate pool for that day: pending+used+selected items queued within
    // +/- 1 day of the post, ranked by the current total_score.
    const dayStart = new Date(new Date(post.created_at).getTime() - 24 * 3600e3).toISOString()
    const dayEnd = new Date(new Date(post.created_at).getTime() + 24 * 3600e3).toISOString()
    const { data: cands } = await supabase
      .from('news_queue')
      .select('id, total_score')
      .gte('queued_at', dayStart)
      .lte('queued_at', dayEnd)
      .order('total_score', { ascending: false })
      .limit(300)

    const ranked = (cands || []).map((c) => c.id as string)
    recalls.push(recallAtK(ranked, relevant, K))
    ndcgs.push(ndcgAtK(ranked, relevant, K))
  }

  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
  console.log(`[eval] posts=${recalls.length} Recall@${K}=${avg(recalls).toFixed(3)} NDCG@${K}=${avg(ndcgs).toFixed(3)}`)
}

function extractQueueItemIds(content: unknown): Set<string> {
  const ids = new Set<string>()
  const root = typeof content === 'string' ? safeParse(content) : content
  const nodes = Array.isArray(root) ? root : (root as { content?: unknown[] })?.content
  if (!Array.isArray(nodes)) return ids
  for (const n of nodes) {
    const node = n as { type?: string; attrs?: { queueItemId?: string } }
    if (node?.type === 'heading' && node.attrs?.queueItemId && node.attrs.queueItemId !== 'null') {
      ids.add(node.attrs.queueItemId)
    }
  }
  return ids
}
function safeParse(s: string): unknown { try { return JSON.parse(s) } catch { return null } }

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run it against the database**

Run: `npx tsx scripts/eval-ranking.ts`
Expected: a line like `[eval] posts=44 Recall@15=0.2xx NDCG@15=0.xxx`. This reproduces the spec's ~0.275 baseline and is the yardstick for later stages.

- [ ] **Step 3: Commit**

```bash
git add scripts/eval-ranking.ts
git commit -m "feat(ranking): add eval harness with published-items ground truth"
```

---

## PHASE 1 — Stage-1 Recall Spike

### Task 6: Reciprocal Rank Fusion (pure, TDD)

**Files:**
- Create: `lib/news-queue/rrf.ts`
- Test: `tests/lib/ranking-rrf.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/ranking-rrf.test.ts
import { describe, it, expect } from 'vitest'
import { reciprocalRankFusion } from '@/lib/news-queue/rrf'

describe('reciprocalRankFusion', () => {
  it('ranks an item high when both lists rank it high', () => {
    const fused = reciprocalRankFusion([['a', 'b', 'c'], ['a', 'c', 'b']], 60)
    expect(fused[0]).toBe('a')
  })
  it('includes items present in only one list', () => {
    const fused = reciprocalRankFusion([['a', 'b'], ['c']], 60)
    expect(new Set(fused)).toEqual(new Set(['a', 'b', 'c']))
  })
  it('uses k to dampen rank weight', () => {
    // With k=0, rank-1 weight is 1/1; item topping both lists must win.
    const fused = reciprocalRankFusion([['x', 'a'], ['x', 'b']], 0)
    expect(fused[0]).toBe('x')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/ranking-rrf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement RRF**

```typescript
// lib/news-queue/rrf.ts

/**
 * Reciprocal Rank Fusion. Each input list is an ordered array of ids (best first).
 * Score(id) = Σ 1/(k + rank_i), rank starting at 1. Returns ids sorted by score desc.
 */
export function reciprocalRankFusion(rankings: string[][], k = 60): string[] {
  const scores = new Map<string, number>()
  for (const list of rankings) {
    list.forEach((id, idx) => {
      const rank = idx + 1
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank))
    })
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/ranking-rrf.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/news-queue/rrf.ts tests/lib/ranking-rrf.test.ts
git commit -m "feat(ranking): add reciprocal rank fusion"
```

---

### Task 7: Winner-similarity RPC wrapper

**Files:**
- Create: `lib/news-queue/winner-similarity.ts`

- [ ] **Step 1: Write the wrapper**

```typescript
// lib/news-queue/winner-similarity.ts
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Returns a map queueItemId -> max cosine similarity to recent published winners.
 * Items without a winner match (or without an embedding) are absent from the map.
 */
export async function getWinnerSimilarity(
  candidateIds: string[],
  winnerLimit = 60
): Promise<Map<string, number>> {
  if (candidateIds.length === 0) return new Map()
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('get_winner_similarity', {
    candidate_ids: candidateIds,
    winner_limit: winnerLimit,
  })
  if (error) {
    console.error('[Ranking] get_winner_similarity failed:', error)
    return new Map()
  }
  const map = new Map<string, number>()
  for (const row of (data as { queue_item_id: string; similarity: number }[]) || []) {
    map.set(row.queue_item_id, row.similarity)
  }
  return map
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `winner-similarity.ts`.

(The RPC itself was already smoke-tested with real candidates in Task 2 Step 5; this thin wrapper is exercised end-to-end by the eval benchmark in Task 8 and the API route in Task 14. We deliberately do NOT run it via a standalone `tsx` snippet — it imports `@/lib/supabase/admin`, which only resolves under Next, not tsx.)

- [ ] **Step 3: Commit**

```bash
git add lib/news-queue/winner-similarity.ts
git commit -m "feat(ranking): add winner-similarity RPC wrapper"
```

---

### Task 8: Stage-1 benchmark mode in eval harness

**Files:**
- Modify: `scripts/eval-ranking.ts`

- [ ] **Step 1: Add a `--stage1` benchmark that compares recall of RRF top-K vs. the full candidate pool**

Append a second exported function and a CLI switch. Add at the top of `main()`:

```typescript
  if (process.argv.includes('--stage1')) {
    await benchmarkStage1()
    return
  }
```

Add the relative import at the top of the file (rrf.ts is pure — safe under tsx). Do NOT import `winner-similarity.ts` (it pulls in `@/lib/supabase/admin`); call the RPC directly with the script's own client instead.

```typescript
import { reciprocalRankFusion } from '../lib/news-queue/rrf'

// Inline RPC call — avoids importing the `@/`-aliased wrapper into a tsx script.
async function winnerSim(ids: string[]): Promise<Map<string, number>> {
  const { data } = await supabase.rpc('get_winner_similarity', { candidate_ids: ids, winner_limit: 60 })
  const m = new Map<string, number>()
  for (const r of (data as { queue_item_id: string; similarity: number }[]) || []) m.set(r.queue_item_id, r.similarity)
  return m
}

async function benchmarkStage1() {
  const { data: posts } = await supabase
    .from('generated_posts').select('id, content, created_at').eq('status', 'published')
  const Ks = [40, 60, 80]
  const recallByK: Record<number, number[]> = { 40: [], 60: [], 80: [] }

  for (const post of posts || []) {
    const relevant = extractQueueItemIds(post.content)
    if (relevant.size === 0) continue
    const dayStart = new Date(new Date(post.created_at).getTime() - 24 * 3600e3).toISOString()
    const dayEnd = new Date(new Date(post.created_at).getTime() + 24 * 3600e3).toISOString()
    const { data: cands } = await supabase
      .from('news_queue').select('id, total_score')
      .gte('queued_at', dayStart).lte('queued_at', dayEnd)
      .order('total_score', { ascending: false }).limit(300)
    const ids = (cands || []).map((c) => c.id as string)
    if (ids.length === 0) continue

    const scoreRank = ids // already total_score DESC
    const simMap = await winnerSim(ids)
    const simRank = [...ids].sort((a, b) => (simMap.get(b) ?? 0) - (simMap.get(a) ?? 0))
    const fused = reciprocalRankFusion([scoreRank, simRank], 60)

    for (const K of Ks) {
      const topK = new Set(fused.slice(0, K))
      let hits = 0
      for (const r of relevant) if (topK.has(r)) hits++
      recallByK[K].push(hits / relevant.size)
    }
  }
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
  for (const K of Ks) console.log(`[stage1] RRF Recall@${K} = ${avg(recallByK[K]).toFixed(3)}`)
  console.log('[stage1] Decision rule: if Recall@80 < 0.7, skip stage-1 prefilter and rerank ALL candidates.')
}
```

- [ ] **Step 2: Run the benchmark**

Run: `npx tsx scripts/eval-ranking.ts --stage1`
Expected: three lines `RRF Recall@40/60/80`. **Record the result in the commit message** — it decides the orchestrator default in Task 11 (`stage1_method` `'rrf'` if Recall@80 ≥ 0.7, else `'all'`).

- [ ] **Step 3: Commit**

```bash
git add scripts/eval-ranking.ts
git commit -m "feat(ranking): benchmark stage-1 RRF recall [Recall@80=<value>]"
```

---

## PHASE 2 — Reranker + UI

### Task 9: Reranker response parser (pure, TDD)

**Files:**
- Create: `lib/news-queue/reranker-parse.ts`
- Test: `tests/lib/ranking-parse.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/ranking-parse.test.ts
import { describe, it, expect } from 'vitest'
import { parseRerankerResponse } from '@/lib/news-queue/reranker-parse'

const valid = new Set(['a', 'b', 'c'])

describe('parseRerankerResponse', () => {
  it('parses a clean JSON array sorted by rank', () => {
    const text = '[{"queueItemId":"b","rank":2,"reason":"r2","confidence":0.6},{"queueItemId":"a","rank":1,"reason":"r1","confidence":0.9}]'
    const out = parseRerankerResponse(text, valid)
    expect(out.map((o) => o.queueItemId)).toEqual(['a', 'b'])
  })
  it('drops hallucinated ids not in the candidate set', () => {
    const text = '[{"queueItemId":"zzz","rank":1,"reason":"x","confidence":0.5},{"queueItemId":"a","rank":2,"reason":"y","confidence":0.5}]'
    const out = parseRerankerResponse(text, valid)
    expect(out.map((o) => o.queueItemId)).toEqual(['a'])
  })
  it('tolerates surrounding prose / markdown fences', () => {
    const text = 'Hier:\n```json\n[{"queueItemId":"c","rank":1,"reason":"r","confidence":0.7}]\n```'
    expect(parseRerankerResponse(text, valid).map((o) => o.queueItemId)).toEqual(['c'])
  })
  it('returns [] on malformed input', () => {
    expect(parseRerankerResponse('not json at all', valid)).toEqual([])
  })
  it('dedupes repeated ids, keeping the first', () => {
    const text = '[{"queueItemId":"a","rank":1,"reason":"r","confidence":0.5},{"queueItemId":"a","rank":2,"reason":"r","confidence":0.5}]'
    expect(parseRerankerResponse(text, valid).length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/ranking-parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

```typescript
// lib/news-queue/reranker-parse.ts
import type { RankedSuggestion } from './ranking-types'

/**
 * Parse the reranker's JSON output. Extracts the first JSON array found,
 * keeps only entries whose queueItemId is in `validIds`, dedupes, and
 * sorts by ascending rank. Never throws — returns [] on any problem.
 */
export function parseRerankerResponse(text: string, validIds: Set<string>): RankedSuggestion[] {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  let raw: unknown
  try {
    raw = JSON.parse(match[0])
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []

  const seen = new Set<string>()
  const out: RankedSuggestion[] = []
  for (const entry of raw) {
    const e = entry as Partial<RankedSuggestion>
    const id = typeof e.queueItemId === 'string' ? e.queueItemId : null
    if (!id || !validIds.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push({
      queueItemId: id,
      rank: typeof e.rank === 'number' ? e.rank : out.length + 1,
      reason: typeof e.reason === 'string' ? e.reason : '',
      confidence: typeof e.confidence === 'number' ? e.confidence : 0.5,
    })
  }
  return out.sort((a, b) => a.rank - b.rank)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/ranking-parse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/news-queue/reranker-parse.ts tests/lib/ranking-parse.test.ts
git commit -m "feat(ranking): add reranker response parser with id validation"
```

---

### Task 10: Few-shot prompt builder (pure, TDD)

**Files:**
- Create: `lib/news-queue/few-shot.ts`
- Test: `tests/lib/ranking-fewshot.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/ranking-fewshot.test.ts
import { describe, it, expect } from 'vitest'
import { buildRerankerPrompt } from '@/lib/news-queue/few-shot'
import type { RankingCandidate, LabelExample } from '@/lib/news-queue/ranking-types'

const candidates: RankingCandidate[] = [
  { queueItemId: 'a', title: 'Nvidia earnings', excerpt: 'chips', source: 'reuters.com', totalScore: 5, winnerSimilarity: 0.8 },
  { queueItemId: 'b', title: 'Crossword puzzle', excerpt: null, source: 'nyt.com', totalScore: 1, winnerSimilarity: 0.1 },
]
const positives: LabelExample[] = [{ title: 'OpenAI ships model', source: 'theverge.com' }]
const negatives: LabelExample[] = [{ title: 'Daily horoscope', source: 'x.com' }]

describe('buildRerankerPrompt', () => {
  it('includes every candidate id and title', () => {
    const p = buildRerankerPrompt(candidates, positives, negatives, 15)
    expect(p).toContain('a')
    expect(p).toContain('Nvidia earnings')
    expect(p).toContain('Crossword puzzle')
  })
  it('includes positive and negative example titles', () => {
    const p = buildRerankerPrompt(candidates, positives, negatives, 15)
    expect(p).toContain('OpenAI ships model')
    expect(p).toContain('Daily horoscope')
  })
  it('states the target count and required JSON shape', () => {
    const p = buildRerankerPrompt(candidates, positives, negatives, 12)
    expect(p).toContain('12')
    expect(p).toContain('queueItemId')
  })
  it('omits the examples sections when none are given', () => {
    const p = buildRerankerPrompt(candidates, [], [], 15)
    expect(p).not.toContain('FRÜHER AUSGEWÄHLT')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/ranking-fewshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder**

```typescript
// lib/news-queue/few-shot.ts
import type { RankingCandidate, LabelExample } from './ranking-types'

/**
 * Build the listwise reranker prompt. Candidates are presented with their
 * raw stage-1 signals (InsertRank trick). Positive/negative examples teach
 * Mattes' taste few-shot. The caller is expected to SHUFFLE `candidates`
 * before calling to mitigate positional bias.
 */
export function buildRerankerPrompt(
  candidates: RankingCandidate[],
  positives: LabelExample[],
  negatives: LabelExample[],
  targetCount: number
): string {
  const parts: string[] = []

  parts.push(
    `Du bist Mattes' redaktioneller Co-Pilot für einen Tech-/Business-Newsletter.`,
    `Wähle aus den KANDIDATEN die ${targetCount} relevantesten Artikel nach Mattes' Geschmack aus und ordne sie.`,
    `Bevorzuge substanzielle, originelle Tech-/Business-Themen; meide Werbung, Rätsel, Listicles, Geraune.`,
    ``
  )

  if (positives.length > 0 || negatives.length > 0) {
    parts.push(`## FRÜHER AUSGEWÄHLT (positiv — solche Themen will Mattes):`)
    for (const ex of positives) parts.push(`- ${ex.title}${ex.source ? ` (${ex.source})` : ''}`)
    parts.push(``, `## FRÜHER IGNORIERT (negativ — solche Themen will Mattes NICHT):`)
    for (const ex of negatives) parts.push(`- ${ex.title}${ex.source ? ` (${ex.source})` : ''}`)
    parts.push(``)
  }

  parts.push(`## KANDIDATEN:`)
  for (const c of candidates) {
    const preview = (c.excerpt || '').slice(0, 200)
    parts.push(
      `- id=${c.queueItemId} | score=${c.totalScore.toFixed(1)} sim=${c.winnerSimilarity.toFixed(2)}` +
        ` | ${c.title}${c.source ? ` [${c.source}]` : ''}${preview ? `\n    ${preview}` : ''}`
    )
  }

  parts.push(
    ``,
    `Antworte AUSSCHLIESSLICH mit einem JSON-Array von genau den ${targetCount} besten,`,
    `Form: [{"queueItemId":"<id>","rank":1,"reason":"<kurze Begründung>","confidence":0.0-1.0}, ...].`,
    `Nur ids aus der Kandidatenliste. Keine Erklärung außerhalb des JSON, kein Markdown.`
  )

  return parts.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/ranking-fewshot.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/news-queue/few-shot.ts tests/lib/ranking-fewshot.test.ts
git commit -m "feat(ranking): add few-shot reranker prompt builder"
```

---

### Task 11: Reranker LLM call

**Files:**
- Create: `lib/news-queue/reranker.ts`

Structural template: `lib/search/rerank.ts` (Anthropic client + timeout + graceful fallback) and `lib/synthesis/score.ts` (uses `getModelForUseCase`).

**Note (intentional omission):** The spec mentioned prompt-caching the few-shot block. At one reranker call per day, the 5-minute cache TTL never hits — caching adds complexity for zero benefit here. Deliberately skipped for the MVP; revisit only if generation frequency rises.

- [ ] **Step 1: Implement `runReranker`**

```typescript
// lib/news-queue/reranker.ts
import Anthropic from '@anthropic-ai/sdk'
import { getModelForUseCase } from '@/lib/ai/model-config'
import { buildRerankerPrompt } from './few-shot'
import { parseRerankerResponse } from './reranker-parse'
import type { RankingCandidate, RankedSuggestion, LabelExample } from './ranking-types'

const TIMEOUT_MS = 45000

/** Fisher–Yates shuffle (deterministic seed not needed; mitigates positional bias). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Run the listwise reranker over candidates. Returns up to `targetCount`
 * suggestions with reasons. On any failure returns the top `targetCount`
 * candidates by totalScore (graceful degradation — UI keeps working).
 */
export async function runReranker(
  candidates: RankingCandidate[],
  positives: LabelExample[],
  negatives: LabelExample[],
  targetCount = 15
): Promise<RankedSuggestion[]> {
  const fallback = (): RankedSuggestion[] =>
    [...candidates]
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, targetCount)
      .map((c, i) => ({ queueItemId: c.queueItemId, rank: i + 1, reason: '(Fallback: Score)', confidence: 0.3 }))

  if (candidates.length === 0) return []
  if (!process.env.ANTHROPIC_API_KEY) return fallback()

  const validIds = new Set(candidates.map((c) => c.queueItemId))
  const prompt = buildRerankerPrompt(shuffle(candidates), positives, negatives, targetCount)

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const model = await getModelForUseCase('queue_ranking')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const response = await client.messages.create(
      { model, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] },
      { signal: controller.signal }
    )
    clearTimeout(timeout)
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    const parsed = parseRerankerResponse(text, validIds)
    return parsed.length > 0 ? parsed.slice(0, targetCount) : fallback()
  } catch (err) {
    console.warn('[Ranking] reranker failed, using score fallback:', err)
    return fallback()
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `reranker.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/news-queue/reranker.ts
git commit -m "feat(ranking): add listwise reranker LLM call with shuffle + fallback"
```

---

### Task 12: Suggestions DB access + recent labels

**Files:**
- Create: `lib/news-queue/suggestions.ts`

- [ ] **Step 1: Implement the DB layer**

```typescript
// lib/news-queue/suggestions.ts
import { createAdminClient } from '@/lib/supabase/admin'
import type { RankedSuggestion, LabelExample, UserAction } from './ranking-types'

/** Create a run row, returning its id. */
export async function createRun(meta: {
  candidateCount: number
  suggestedCount: number
  stage1Method: string
  model: string
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('ranking_runs')
    .insert({
      candidate_count: meta.candidateCount,
      suggested_count: meta.suggestedCount,
      stage1_method: meta.stage1Method,
      model: meta.model,
    })
    .select('id')
    .single()
  if (error) throw new Error(`createRun failed: ${error.message}`)
  return data!.id as string
}

/** Persist the LLM suggestions for a run. */
export async function recordSuggestions(runId: string, suggestions: RankedSuggestion[]): Promise<void> {
  if (suggestions.length === 0) return
  const supabase = createAdminClient()
  const rows = suggestions.map((s) => ({
    run_id: runId,
    queue_item_id: s.queueItemId,
    suggested_rank: s.rank,
    llm_reason: s.reason,
    confidence: s.confidence,
    user_action: 'pending' as UserAction,
  }))
  const { error } = await supabase.from('ranking_suggestions').insert(rows)
  if (error) throw new Error(`recordSuggestions failed: ${error.message}`)
}

/** Record a user action on one suggestion (the learning label). */
export async function recordFeedback(
  runId: string,
  queueItemId: string,
  action: UserAction,
  finalRank: number | null
): Promise<void> {
  const supabase = createAdminClient()
  // upsert handles 'added' items that were never suggested
  const { error } = await supabase.from('ranking_suggestions').upsert(
    {
      run_id: runId,
      queue_item_id: queueItemId,
      user_action: action,
      final_rank: finalRank,
      acted_at: new Date().toISOString(),
    },
    { onConflict: 'run_id,queue_item_id' }
  )
  if (error) throw new Error(`recordFeedback failed: ${error.message}`)
}

/**
 * Recent taste labels for the few-shot block.
 * Positives = items that made it into published posts (strongest signal).
 * Negatives = items explicitly rejected in past ranking runs.
 */
export async function getRecentLabels(limit = 15): Promise<{ positives: LabelExample[]; negatives: LabelExample[] }> {
  const supabase = createAdminClient()

  const { data: pos } = await supabase
    .from('ranking_suggestions')
    .select('queue_item_id, news_queue(title, source_display_name)')
    .eq('user_action', 'accepted')
    .order('acted_at', { ascending: false })
    .limit(limit)

  const { data: neg } = await supabase
    .from('ranking_suggestions')
    .select('queue_item_id, news_queue(title, source_display_name)')
    .eq('user_action', 'rejected')
    .order('acted_at', { ascending: false })
    .limit(limit)

  const toExample = (rows: unknown[]): LabelExample[] =>
    (rows as { news_queue: { title: string; source_display_name: string | null } | null }[])
      .filter((r) => r.news_queue)
      .map((r) => ({ title: r.news_queue!.title, source: r.news_queue!.source_display_name }))

  return { positives: toExample(pos || []), negatives: toExample(neg || []) }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `suggestions.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/news-queue/suggestions.ts
git commit -m "feat(ranking): add suggestions persistence and recent-labels retrieval"
```

---

### Task 13: Orchestration service

**Files:**
- Create: `lib/news-queue/ranking-service.ts`

- [ ] **Step 1: Implement `generateRankingSuggestions`**

Set `DEFAULT_STAGE1` from the Task 8 benchmark: `'rrf'` if Recall@80 ≥ 0.7, otherwise `'all'`.

**Note (intentional omission):** The spec marked the source-diversity cap (30 %, applied *after* RRF) as optional ("falls überhaupt"). It is deliberately left out of the MVP — the reranker's taste judgement already spreads sources, and a hard cap can fight learned preferences. Add it later only if one source visibly dominates the suggestions.

```typescript
// lib/news-queue/ranking-service.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { isJunkTitle } from './service'
import { reciprocalRankFusion } from './rrf'
import { getWinnerSimilarity } from './winner-similarity'
import { runReranker } from './reranker'
import { getModelForUseCase } from '@/lib/ai/model-config'
import { createRun, recordSuggestions, getRecentLabels } from './suggestions'
import type { RankingCandidate, RankedSuggestion } from './ranking-types'

// Decided by `npx tsx scripts/eval-ranking.ts --stage1` (Task 8).
const DEFAULT_STAGE1: 'rrf' | 'all' = 'rrf'
const STAGE1_TOPK = 80
const MAX_FOR_ALL = 150
const TARGET = 15

export interface RankingResult {
  runId: string
  suggestions: Array<RankedSuggestion & { title: string; source: string | null }>
}

export async function generateRankingSuggestions(
  stage1: 'rrf' | 'all' = DEFAULT_STAGE1
): Promise<RankingResult> {
  const supabase = createAdminClient()

  // Load pending candidates (cap generously).
  const { data: rows } = await supabase
    .from('news_queue')
    .select('id, title, excerpt, source_display_name, total_score')
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('total_score', { ascending: false })
    .limit(300)

  const cleaned = (rows || []).filter((r) => !isJunkTitle(r.title))
  const candidateIds = cleaned.map((r) => r.id as string)
  const simMap = await getWinnerSimilarity(candidateIds)

  const byId = new Map<string, RankingCandidate>()
  for (const r of cleaned) {
    byId.set(r.id, {
      queueItemId: r.id,
      title: r.title,
      excerpt: r.excerpt,
      source: r.source_display_name,
      totalScore: Number(r.total_score) || 0,
      winnerSimilarity: simMap.get(r.id) ?? 0,
    })
  }

  // Stage 1: select the candidate pool the reranker sees.
  let pool: RankingCandidate[]
  if (stage1 === 'all') {
    pool = cleaned.slice(0, MAX_FOR_ALL).map((r) => byId.get(r.id)!)
  } else {
    const scoreRank = candidateIds // total_score DESC already
    const simRank = [...candidateIds].sort((a, b) => (simMap.get(b) ?? 0) - (simMap.get(a) ?? 0))
    const fused = reciprocalRankFusion([scoreRank, simRank], 60).slice(0, STAGE1_TOPK)
    pool = fused.map((id) => byId.get(id)!).filter(Boolean)
  }

  // Stage 2: rerank.
  const { positives, negatives } = await getRecentLabels(15)
  const suggestions = await runReranker(pool, positives, negatives, TARGET)

  // Persist.
  const model = await getModelForUseCase('queue_ranking')
  const runId = await createRun({
    candidateCount: pool.length,
    suggestedCount: suggestions.length,
    stage1Method: stage1,
    model,
  })
  await recordSuggestions(runId, suggestions)

  return {
    runId,
    suggestions: suggestions.map((s) => {
      const c = byId.get(s.queueItemId)
      return { ...s, title: c?.title ?? '', source: c?.source ?? null }
    }),
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `ranking-service.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/news-queue/ranking-service.ts
git commit -m "feat(ranking): add stage-1+2 orchestration service"
```

---

### Task 14: Ranking API route

**Files:**
- Create: `app/api/admin/ranking/route.ts`
- Test: `tests/api/ranking.test.ts`

- [ ] **Step 1: Write the failing integration test**

```typescript
// tests/api/ranking.test.ts
import { describe, it, expect } from 'vitest'

const API_BASE = process.env.TEST_API_URL || 'https://synthszr.vercel.app'

describe('Ranking API', () => {
  it('GET returns the latest run shape (or empty)', async () => {
    const res = await fetch(`${API_BASE}/api/admin/ranking`)
    expect([200, 401]).toContain(res.status)
    if (res.status === 200) {
      const data = await res.json()
      expect(data).toHaveProperty('suggestions')
      expect(Array.isArray(data.suggestions)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/ranking.test.ts`
Expected: FAIL — route 404 (returns neither 200 nor 401) until deployed. (Pre-deploy this asserts the endpoint isn't live yet.)

- [ ] **Step 3: Implement the route**

```typescript
// app/api/admin/ranking/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateRankingSuggestions } from '@/lib/news-queue/ranking-service'

export const maxDuration = 120

// POST: generate a fresh ranking run.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const stage1 = body.stage1 === 'all' ? 'all' : undefined // undefined → service default
    const result = await generateRankingSuggestions(stage1)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[API/ranking] POST failed:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

// GET: latest run + its suggestions joined with item titles.
export async function GET() {
  const supabase = createAdminClient()
  const { data: run } = await supabase
    .from('ranking_runs')
    .select('id, created_at, stage1_method')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!run) return NextResponse.json({ runId: null, suggestions: [] })

  const { data: sugg } = await supabase
    .from('ranking_suggestions')
    .select('queue_item_id, suggested_rank, llm_reason, confidence, user_action, news_queue(title, source_display_name)')
    .eq('run_id', run.id)
    .order('suggested_rank', { ascending: true })

  const suggestions = (sugg || []).map((s) => {
    const nq = s.news_queue as { title: string; source_display_name: string | null } | null
    return {
      queueItemId: s.queue_item_id,
      rank: s.suggested_rank,
      reason: s.llm_reason,
      confidence: s.confidence,
      userAction: s.user_action,
      title: nq?.title ?? '',
      source: nq?.source_display_name ?? null,
    }
  })

  return NextResponse.json({ runId: run.id, stage1Method: run.stage1_method, suggestions })
}
```

- [ ] **Step 4: Deploy, then run the test against production**

Deploy to production (the project runs on Vercel; per Mattes' convention, verify on production). Then:
Run: `npx vitest run tests/api/ranking.test.ts`
Expected: PASS — GET returns 200 (or 401 if admin-gated) with a `suggestions` array.

- [ ] **Step 5: Manually trigger one generation and confirm rows land**

```bash
curl -s -X POST "$TEST_API_URL/api/admin/ranking" -H 'Content-Type: application/json' -d '{}' | head -c 400
```
Then verify in SQL: `SELECT count(*) FROM ranking_suggestions;` is > 0.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/ranking/route.ts tests/api/ranking.test.ts
git commit -m "feat(ranking): add ranking generation API route"
```

---

### Task 15: Feedback API route

**Files:**
- Create: `app/api/admin/ranking-feedback/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
// app/api/admin/ranking-feedback/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { recordFeedback } from '@/lib/news-queue/suggestions'
import type { UserAction } from '@/lib/news-queue/ranking-types'

const VALID: UserAction[] = ['accepted', 'rejected', 'added', 'reordered']

export async function POST(req: NextRequest) {
  try {
    const { runId, queueItemId, action, finalRank } = await req.json()
    if (!runId || !queueItemId || !VALID.includes(action)) {
      return NextResponse.json({ ok: false, error: 'invalid payload' }, { status: 400 })
    }
    await recordFeedback(runId, queueItemId, action as UserAction, finalRank ?? null)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[API/ranking-feedback] failed:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
```

- [ ] **Step 2: Deploy and smoke-test**

```bash
curl -s -X POST "$TEST_API_URL/api/admin/ranking-feedback" -H 'Content-Type: application/json' \
  -d '{"runId":"<run>","queueItemId":"<item>","action":"accepted"}'
```
Expected: `{"ok":true}`; then `SELECT user_action FROM ranking_suggestions WHERE queue_item_id='<item>'` shows `accepted`.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/ranking-feedback/route.ts
git commit -m "feat(ranking): add ranking feedback (label logging) route"
```

---

### Task 16: Suggestions UI panel

**Files:**
- Create: `components/admin/ranking-suggestions-panel.tsx`

- [ ] **Step 1: Implement the panel**

```tsx
// components/admin/ranking-suggestions-panel.tsx
'use client'
import { useEffect, useState } from 'react'

interface Suggestion {
  queueItemId: string
  rank: number | null
  reason: string | null
  confidence: number | null
  userAction?: string
  title: string
  source: string | null
}

export function RankingSuggestionsPanel() {
  const [runId, setRunId] = useState<string | null>(null)
  const [items, setItems] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)

  async function loadLatest() {
    const res = await fetch('/api/admin/ranking')
    if (res.ok) {
      const data = await res.json()
      setRunId(data.runId)
      setItems(data.suggestions || [])
    }
  }
  useEffect(() => { loadLatest() }, [])

  async function generate() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/ranking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json()
      if (data.ok) { setRunId(data.runId); setItems(data.suggestions || []) }
    } finally { setLoading(false) }
  }

  async function feedback(queueItemId: string, action: 'accepted' | 'rejected') {
    if (!runId) return
    await fetch('/api/admin/ranking-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, queueItemId, action }),
    })
    setItems((prev) => prev.map((s) => (s.queueItemId === queueItemId ? { ...s, userAction: action } : s)))
  }

  return (
    <div className="rounded-lg border border-neutral-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Vorschläge (assistiertes Ranking)</h3>
        <button onClick={generate} disabled={loading}
          className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {loading ? 'Generiere…' : 'Vorschläge generieren'}
        </button>
      </div>
      {items.length === 0 && <p className="text-sm text-neutral-500">Noch keine Vorschläge.</p>}
      <ol className="space-y-2">
        {items.map((s) => (
          <li key={s.queueItemId}
            className={`rounded border p-2 text-sm ${s.userAction === 'rejected' ? 'opacity-40' : ''} ${s.userAction === 'accepted' ? 'border-lime-400 bg-lime-50' : 'border-neutral-200'}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="mr-2 font-mono text-xs text-neutral-400">#{s.rank}</span>
                <span className="font-medium">{s.title}</span>
                {s.source && <span className="ml-1 text-xs text-neutral-500">[{s.source}]</span>}
                {s.reason && <p className="mt-0.5 text-xs text-neutral-600">{s.reason}</p>}
              </div>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => feedback(s.queueItemId, 'accepted')} className="rounded bg-lime-500 px-2 py-0.5 text-xs text-white">Behalten</button>
                <button onClick={() => feedback(s.queueItemId, 'rejected')} className="rounded bg-neutral-300 px-2 py-0.5 text-xs">Verwerfen</button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
```

- [ ] **Step 2: Verify it type-checks / lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors referencing the panel.

- [ ] **Step 3: Commit**

```bash
git add components/admin/ranking-suggestions-panel.tsx
git commit -m "feat(ranking): add suggestions UI panel"
```

---

### Task 17: Mount the panel in the news-queue admin page

**Files:**
- Modify: `app/admin/news-queue/page.tsx`

- [ ] **Step 1: Import and render the panel near the top of the queue view**

Add the import with the other component imports at the top of the file:

```tsx
import { RankingSuggestionsPanel } from '@/components/admin/ranking-suggestions-panel'
```

Then render it just inside the main content container, above the existing pending-items list (place after the stats/toolbar block, before the item table). Insert:

```tsx
<div className="mb-6">
  <RankingSuggestionsPanel />
</div>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds (the page compiles with the new panel).

- [ ] **Step 3: Manual verification on production**

After deploy: open `/admin/news-queue`, click **Vorschläge generieren**, confirm ~15 items appear with reasons, click **Behalten/Verwerfen**, then check `SELECT user_action, count(*) FROM ranking_suggestions GROUP BY 1;` reflects the clicks.

- [ ] **Step 4: Commit**

```bash
git add app/admin/news-queue/page.tsx
git commit -m "feat(ranking): mount suggestions panel in news-queue admin"
```

---

## Final Verification

- [ ] **All unit tests pass:** `npx vitest run tests/lib/ranking-*.test.ts` → all green.
- [ ] **Eval baseline reproducible:** `npx tsx scripts/eval-ranking.ts` prints Recall@15 ≈ 0.2–0.3.
- [ ] **Stage-1 decision recorded:** Task 8 benchmark value is in the commit history and `DEFAULT_STAGE1` matches it.
- [ ] **End-to-end on production:** generate → suggestions with reasons appear → Behalten/Verwerfen writes `ranking_suggestions` rows.
- [ ] **Labels accumulate:** after a few days of use, `getRecentLabels()` returns non-empty positives/negatives that flow into the next run's few-shot block.

## Out of Scope (Folge-Plan: Phase 3)
Aktiver Lern-Loop: `ranking_preferences`-Tabelle (gespiegelt an `learned_patterns`), Extraktions-Cron `app/api/cron/extract-ranking-preferences` (analog `extract-patterns`), Confidence/Decay (`handle_pattern_feedback`-Kopie: Accept +0.02, Reject −0.1, Auto-Deaktivierung <0.3, Decay 0.95/Woche), Exploration-Slot. Starten, sobald genügend `ranking_suggestions`-Labels existieren.
