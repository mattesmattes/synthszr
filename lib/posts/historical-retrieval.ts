/**
 * Historical-context retrieval for Synthszr Takes.
 *
 * Finds previously published Synthszr posts that are semantically close to
 * the current news item, so the Ghostwriter can make grounded callbacks
 * ("wie wir am … schrieben") instead of treating every topic as brand new.
 *
 * Reuses the exact same query embedding (gemini-embedding-001 via embedQuery)
 * and match_generated_posts RPC as the site search, so recall is identical to
 * what the search box already returns in production.
 */

import { embedQuery } from '@/lib/search/embeddings'
import { createAdminClient } from '@/lib/supabase/admin'

export interface PastPost {
  id: string
  title: string
  slug: string
  excerpt: string | null
  created_at: string
  similarity: number
}

const DEFAULT_TOP_K = 3
// Higher than the search threshold (0.35): a callback should only appear when a
// past post is clearly on the same topic, otherwise it reads as a forced reference.
const DEFAULT_THRESHOLD = 0.45

export async function findRelevantPastPosts(
  query: string,
  options: { limit?: number; threshold?: number } = {}
): Promise<PastPost[]> {
  const { limit = DEFAULT_TOP_K, threshold = DEFAULT_THRESHOLD } = options
  try {
    const queryVec = await embedQuery(query)
    if (queryVec.length === 0) return []

    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('match_generated_posts', {
      query_embedding: queryVec as unknown as string,
      match_threshold: threshold,
      match_count: limit,
    })
    if (error) {
      console.warn('[History] match_generated_posts RPC failed:', error.message)
      return []
    }
    return (data || []) as PastPost[]
  } catch (err) {
    console.warn('[History] retrieval failed:', err)
    return []
  }
}

/**
 * Build a compact prompt block from past posts. Gives the model real titles
 * and dates so any callback it makes is accurate — never invented.
 */
export function formatPastPostsForPrompt(posts: PastPost[]): string {
  if (posts.length === 0) return ''

  const fmtDate = (iso: string): string => {
    try {
      return new Date(iso).toLocaleDateString('de-DE', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    } catch {
      return iso.slice(0, 10)
    }
  }

  const blocks = posts.map((p, i) => {
    const excerpt = (p.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 220)
    return `[${i + 1}] „${p.title}" (${fmtDate(p.created_at)})${excerpt ? `: ${excerpt}` : ''}`
  })

  return [
    'HISTORISCHER KONTEXT (frühere Synthszr-Beiträge zum selben Thema, als mögliche Rückbezüge):',
    ...blocks,
    'Wenn ein früherer Beitrag klar zum aktuellen Thema passt, darfst du einen kurzen Rückbezug machen (z.B. „wie wir Mitte Mai schrieben" oder „im Mai war die Bewertung noch X"). Nutze nur die angegebenen Titel und Daten, erfinde nichts. Erzwinge keinen Rückbezug — nur wenn er den Take schärft. Wiederhole alte Aussagen nicht wörtlich.',
  ].join('\n\n')
}
