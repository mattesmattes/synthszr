import { describe, it, expect, vi, beforeEach } from 'vitest'

// writeSectionsBatch calls the module-internal writeSection, which (for an
// Anthropic model with thinking:true) goes through anthropic.messages.stream().
// vi.mock does NOT intercept intra-module calls in ESM, so we mock the SDK
// layer instead: each stream yields a single text delta after a fixed delay so
// the budget logic has a measurable per-section cost.
//
// writeSection also performs two retrieval imports (Mattes corpus + past
// posts). Those are non-fatal: with no API key/DB in the test env they reject
// fast and writeSection swallows the error, so they don't affect the result —
// only the deterministic SECTION_MS delay drives the budget timing.

const SECTION_MS = 100
let sectionCounter = 0

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: () => {
        const n = ++sectionCounter
        return (async function* () {
          // Fixed per-section cost. Body does NOT start with "##" so
          // writeSection prepends the real plan heading → the returned section
          // reflects plan order, not call order.
          await new Promise(r => setTimeout(r, SECTION_MS))
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: `Body for call ${n}` },
          }
        })()
      },
    }
  }
  return { default: MockAnthropic }
})

import {
  writeSectionsBatch,
  type SectionContext,
  type PipelineItem,
  type ArticlePlan,
} from '@/lib/claude/ghostwriter-pipeline'

function makeItems(n: number): PipelineItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${i + 1}`,
    title: `Title ${i + 1}`,
    content: `Content ${i + 1}`,
    source_display_name: `Source ${i + 1}`,
    source_url: null,
    source_identifier: `src-${i + 1}`,
  }))
}

function makePlan(n: number): ArticlePlan {
  return {
    thesis: 'thesis',
    ordering: Array.from({ length: n }, (_, i) => i + 1),
    headings: Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), `Heading ${i + 1}`])),
    takeAngles: {},
    retrievalHints: {},
    articleTitle: 'Title',
    excerptBullets: ['a', 'b', 'c'],
    category: 'AI & Tech',
    introParagraph: 'intro',
  }
}

function makeCtx(): SectionContext {
  return {
    cacheableUserPrefix: 'prefix',
    companiesPerItem: new Map(),
    metadataBlock: 'meta',
    loadedPatterns: [],
  }
}

const MODEL = 'claude-opus-4-8' as never

describe('writeSectionsBatch', () => {
  beforeEach(() => {
    sectionCounter = 0
  })

  it('stops at the budget and returns the correct nextCursor (done=false)', async () => {
    const total = 18
    const items = makeItems(total)
    const plan = makePlan(total)
    // concurrency 6 → one batch of 6 takes ~SECTION_MS (100ms). budgetMs=50:
    // after the first batch elapsed (~100ms) > 50ms → break. So exactly 6
    // sections, fewer than the 18 total. Robust against retrieval overhead,
    // which only increases elapsed time (still > budget).
    const startedAt = Date.now()
    const res = await writeSectionsBatch(items, plan, makeCtx(), 0, MODEL, 'medium', 50, startedAt)

    expect(res.done).toBe(false)
    expect(res.nextCursor).toBeGreaterThan(0)
    expect(res.nextCursor).toBeLessThan(total)
    // nextCursor must land on a batch boundary (multiple of 6)
    expect(res.nextCursor % 6).toBe(0)
    // sections returned match the cursor advance
    expect(res.sections.length).toBe(res.nextCursor)
  })

  it('writes all items in order when budget is unlimited (done=true)', async () => {
    const total = 8
    const items = makeItems(total)
    const plan = makePlan(total)
    const res = await writeSectionsBatch(items, plan, makeCtx(), 0, MODEL, 'medium', Infinity, Date.now())

    expect(res.done).toBe(true)
    expect(res.nextCursor).toBe(total)
    expect(res.sections.length).toBe(total)
    // Sections are returned in plan order: each ends with the trailing "\n\n"
    // and contains its heading. The heading text is taken from plan.headings.
    res.sections.forEach((section, idx) => {
      expect(section.endsWith('\n\n')).toBe(true)
      expect(section).toContain(`## Heading ${idx + 1}`)
    })
  })

  it('resumes from a non-zero cursor and reports done at the end', async () => {
    const total = 8
    const items = makeItems(total)
    const plan = makePlan(total)
    const res = await writeSectionsBatch(items, plan, makeCtx(), 6, MODEL, 'medium', Infinity, Date.now())

    expect(res.done).toBe(true)
    expect(res.nextCursor).toBe(total)
    // only the remaining 2 sections are returned (cursor=6 → items 7,8)
    expect(res.sections.length).toBe(total - 6)
  })
})
