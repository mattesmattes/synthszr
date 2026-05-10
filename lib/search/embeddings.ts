/**
 * Search-side embedding helpers.
 *
 * - tiptapToPlain(): same flattener used by the search API; reused here
 *   so the embedding text and the substring-search text stay aligned.
 * - embedPostText(): truncate + embed via gemini-embedding-001.
 * - embedQuery(): same model for queries — symmetry matters with cosine.
 * - upsertPostEmbedding(): write the vector back to generated_posts.
 */

import { generateEmbedding } from '@/lib/embeddings/generator'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_INPUT_CHARS = 8000

export function tiptapToPlain(content: unknown): string {
  if (!content) return ''
  if (typeof content === 'string') {
    try {
      return tiptapToPlain(JSON.parse(content))
    } catch {
      return content
    }
  }
  let plain = ''
  const collect = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as Record<string, unknown>
    if (typeof n.text === 'string') plain += n.text + ' '
    if (Array.isArray(n.content)) n.content.forEach(collect)
  }
  collect(content)
  return plain
}

/**
 * Build the canonical embedding text for a post: title + excerpt +
 * plain-text body, truncated to fit Gemini's 2048-token soft limit.
 */
export function buildEmbedText(post: {
  title?: string | null
  excerpt?: string | null
  content?: unknown
}): string {
  const head = [post.title, post.excerpt].filter(Boolean).join('\n\n')
  const body = tiptapToPlain(post.content)
  const combined = head ? `${head}\n\n${body}` : body
  return combined.slice(0, MAX_INPUT_CHARS).trim()
}

export async function embedPostContent(post: {
  title?: string | null
  excerpt?: string | null
  content?: unknown
}): Promise<number[]> {
  const text = buildEmbedText(post)
  if (!text) return []
  return generateEmbedding(text)
}

export async function embedQuery(query: string): Promise<number[]> {
  const trimmed = query.trim().slice(0, MAX_INPUT_CHARS)
  if (!trimmed) return []
  return generateEmbedding(trimmed)
}

/**
 * Persist an embedding for a post. Uses the admin client because the
 * column is not exposed via row-level RLS to public clients.
 */
export async function upsertPostEmbedding(
  postId: string,
  embedding: number[]
): Promise<void> {
  if (embedding.length === 0) return
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('generated_posts')
    .update({ content_embedding: embedding as unknown as string })
    .eq('id', postId)
  if (error) throw error
}
