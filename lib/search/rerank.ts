/**
 * LLM re-ranker for search candidates.
 *
 * Takes the raw post hits (already merged from embedding + substring
 * search) and asks Claude Haiku to reorder them by relevance to the
 * query. Returns the same hits permuted; never adds, never drops.
 *
 * Falls back to the input order if the LLM call fails or the response
 * can't be parsed — search must keep working even when the re-ranker
 * is offline.
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
Sortiere die Treffer nach Relevanz zur Anfrage. Treffer, die das gemeinte Konzept
direkt adressieren, kommen zuerst; reine Wortübereinstimmungen ohne thematische
Nähe nach hinten.

Antworte AUSSCHLIESSLICH mit einem JSON-Array der ursprünglichen Nummern in der
neuen Reihenfolge, z.B. [3, 1, 5, 2, 4]. Keine Erklärung, kein Markdown.

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

    const match = text.match(/\[[\d,\s]+\]/)
    if (!match) return hits

    const order = JSON.parse(match[0]) as number[]
    if (!Array.isArray(order)) return hits

    const seen = new Set<number>()
    const reordered: T[] = []
    for (const oneBased of order) {
      const idx = oneBased - 1
      if (idx >= 0 && idx < candidates.length && !seen.has(idx)) {
        reordered.push(candidates[idx])
        seen.add(idx)
      }
    }
    // Append any candidates the LLM forgot to keep parity
    for (let i = 0; i < candidates.length; i++) {
      if (!seen.has(i)) reordered.push(candidates[i])
    }
    return reordered
  } catch (err) {
    console.warn('[Search] Rerank failed, using original order:', err)
    return hits
  }
}
