/**
 * Retrieval of Mattes-corpus passages for the Synthszr Take ground.
 *
 * - findRelevantMattesPassages(): given a news item (or any query text),
 *   embed it once and ask the match_mattes_chunks RPC for the top-N
 *   semantic neighbours. Returns plain text + provenance.
 * - formatPassagesForPrompt(): turns the list into a compact block the
 *   ghostwriter pipeline can prepend to the section prompt.
 *
 * The Take generator should call this once per news item and pass the
 * formatted block alongside the user prompt. Errors are non-fatal —
 * if Gemini or the RPC fails, generation continues without ground.
 */

import { generateEmbedding } from '@/lib/embeddings/generator'
import { createAdminClient } from '@/lib/supabase/admin'

export interface MattesPassage {
  id: string
  source_file: string
  chunk_index: number
  chunk_text: string
  similarity: number
}

const DEFAULT_TOP_K = 2
const DEFAULT_THRESHOLD = 0.55
const MAX_QUERY_CHARS = 6000

export async function findRelevantMattesPassages(
  query: string,
  options: { limit?: number; threshold?: number } = {}
): Promise<MattesPassage[]> {
  const { limit = DEFAULT_TOP_K, threshold = DEFAULT_THRESHOLD } = options
  const trimmed = query.trim().slice(0, MAX_QUERY_CHARS)
  if (!trimmed) return []

  try {
    const queryVec = await generateEmbedding(trimmed)
    if (queryVec.length === 0) return []

    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('match_mattes_chunks', {
      query_embedding: queryVec as unknown as string,
      match_threshold: threshold,
      match_count: limit,
    })
    if (error) {
      console.warn('[Mattes] match_mattes_chunks RPC failed:', error.message)
      return []
    }
    return (data || []) as MattesPassage[]
  } catch (err) {
    console.warn('[Mattes] retrieval failed:', err)
    return []
  }
}

/**
 * Format retrieved passages as a compact block for prompt injection.
 * Each passage is labelled with its source file so the model can use
 * it as evidence rather than as something to repeat verbatim.
 */
export function formatPassagesForPrompt(passages: MattesPassage[]): string {
  if (passages.length === 0) return ''
  const blocks = passages.map((p, i) => {
    const file = p.source_file.replace(/\.md$/, '')
    return `[Quelle ${i + 1}: ${file}]\n${p.chunk_text.trim()}`
  })
  return [
    'MATTES-KONTEXT (Auszüge aus eigenen Schriften, als Stil- und Argument-Anker):',
    ...blocks,
    'Nutze diese Passagen als Stimm- und Argumentationsreferenz. Zitiere nicht wörtlich. Übernimm das Vokabular (Code Crash, Intent, Hidden Champion, Jevons-Paradoxon, Compute-Disziplin, etc.) nur dort, wo es zur News passt.',
  ].join('\n\n')
}
