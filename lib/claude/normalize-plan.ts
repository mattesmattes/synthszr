import type { ArticlePlan } from './ghostwriter-pipeline'

/**
 * Normalizes an LLM-produced article plan onto the ArticlePlan contract:
 *   ordering: number[]  (1-based item indices, each item exactly once)
 *   headings: Record<string, string>  (item index → heading)
 *
 * The planning model (Gemini) is non-deterministic and occasionally emits a
 * drifted schema — e.g. `ordering` as an array of `{id, headings:string}`
 * objects with no top-level `headings` map (observed 2026-07-07). Consuming
 * that shape directly crashed the writing phase with
 * `Cannot read properties of undefined (reading '[object Object]')` because
 * `plan.headings[String(itemIdx)]` became `undefined["[object Object]"]`.
 *
 * This runs both when a plan is freshly produced (planArticle) and when a
 * previously persisted plan is consumed (article job writing/finalizing), so
 * jobs whose malformed plan is already in the DB are healed on the next tick.
 */
export function normalizeArticlePlan(plan: ArticlePlan, itemCount: number): ArticlePlan {
  const rawOrdering: unknown[] = Array.isArray(plan?.ordering) ? plan.ordering : []

  // Start from any well-formed top-level headings map, then enrich from inline
  // object entries. Guarantees headings is always a plain object.
  const headings: Record<string, string> =
    plan?.headings && typeof plan.headings === 'object' && !Array.isArray(plan.headings)
      ? { ...(plan.headings as Record<string, string>) }
      : {}

  const ordering: number[] = []
  const seen = new Set<number>()

  const consider = (idx: number, heading?: unknown) => {
    if (!Number.isInteger(idx) || idx < 1 || idx > itemCount) return
    if (typeof heading === 'string' && heading.trim() && !(String(idx) in headings)) {
      headings[String(idx)] = heading
    }
    if (!seen.has(idx)) {
      seen.add(idx)
      ordering.push(idx)
    }
  }

  for (const entry of rawOrdering) {
    if (typeof entry === 'number') {
      consider(entry)
    } else if (entry && typeof entry === 'object') {
      const o = entry as { id?: unknown; headings?: unknown; heading?: unknown }
      const idx = typeof o.id === 'number' ? o.id : Number(o.id)
      consider(idx, o.headings ?? o.heading)
    }
  }

  // Ensure every item appears exactly once (mirrors planArticle's old
  // validation loop, but now on properly normalized numeric indices).
  for (let i = 1; i <= itemCount; i++) {
    if (!seen.has(i)) {
      seen.add(i)
      ordering.push(i)
    }
  }

  return { ...plan, ordering, headings }
}
