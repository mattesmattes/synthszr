/**
 * LLM relevance filter + re-ranker for search candidates.
 *
 * Takes the raw post hits (merged from embedding + substring search) and asks
 * Claude Haiku to (a) DROP hits that don't genuinely match the query and
 * (b) order the rest by relevance. Returns a subset, possibly empty.
 *
 * Why filtering matters: semantic recall returns the nearest neighbours for
 * ANY query, so an off-topic term that appears in no post (e.g. "openrouter")
 * otherwise surfaces the nearest KI posts as false positives. The model's
 * selection is the precision gate.
 *
 * Safety: if the LLM call fails or the response can't be parsed, falls back to
 * the full input order — search keeps working, just unfiltered. An explicit
 * empty array ([]) from the model means "nothing relevant" and is honoured.
 */

import Anthropic from '@anthropic-ai/sdk'

interface RerankableHit {
  id: string
  title: string
  excerpt: string | null
  snippet: string | null
}

const RERANK_MODEL = 'claude-haiku-4-5-20251001'
const MAX_CANDIDATES = 20
const TIMEOUT_MS = 6000

export async function rerankPostHits<T extends RerankableHit>(
  query: string,
  hits: T[]
): Promise<T[]> {
  if (hits.length <= 1) return hits
  if (!process.env.ANTHROPIC_API_KEY) return hits

  const candidates = hits.slice(0, MAX_CANDIDATES)
  const numbered = candidates
    .map((h, i) => {
      const preview = (h.snippet || h.excerpt || '').slice(0, 220)
      return `${i + 1}. ${h.title}\n   ${preview}`
    })
    .join('\n\n')

  const prompt = `Du bekommst eine Suchanfrage und eine Liste nummerierter Treffer.
Wähle NUR die Treffer aus, die die Anfrage thematisch wirklich treffen, und
sortiere sie nach Relevanz (relevantester zuerst). Lass Treffer weg, die nur
oberflächlich passen (z.B. zufällige Wortteile, bloß dasselbe Themengebiet) oder
gar nichts mit der Anfrage zu tun haben.

Wenn KEIN Treffer die Anfrage wirklich trifft, antworte mit einem leeren Array: []

Antworte AUSSCHLIESSLICH mit einem JSON-Array der ursprünglichen Nummern der
relevanten Treffer in neuer Reihenfolge, z.B. [3, 1, 5] oder []. Keine Erklärung,
kein Markdown.

ANFRAGE: "${query}"

TREFFER:
${numbered}`

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const response = await client.messages.create(
      {
        model: RERANK_MODEL,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal }
    )
    clearTimeout(timeout)

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    const match = text.match(/\[[\d,\s]*\]/) // allow [] = nothing relevant
    if (!match) return hits // unparseable → keep all (safety, never nuke results)

    let order: number[]
    try {
      order = JSON.parse(match[0]) as number[]
    } catch {
      return hits
    }
    if (!Array.isArray(order)) return hits

    // The model's selection IS the relevance filter: keep only the chosen hits
    // in the given order and drop the rest. An empty array means nothing
    // genuinely matched (off-topic query) → no blog results.
    const seen = new Set<number>()
    const reordered: T[] = []
    for (const oneBased of order) {
      const idx = oneBased - 1
      if (idx >= 0 && idx < candidates.length && !seen.has(idx)) {
        reordered.push(candidates[idx])
        seen.add(idx)
      }
    }
    return reordered
  } catch (err) {
    console.warn('[Search] Rerank failed, using original order:', err)
    return hits
  }
}
