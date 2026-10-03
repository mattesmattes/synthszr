/**
 * Daten der Company-Detailseite, im Next-Datencache.
 *
 * WARUM (Egress-Befund 2026-10-03): Jede nicht-deutsche Company-Seite lud den
 * VOLLEN übersetzten Inhalt (content_translations.content, TipTap-JSON) aller
 * Posts, die die Firma erwähnen — gemessen OpenAI/en 8,0 MB, Nvidia/en 5,3 MB,
 * Adobe/en 1,0 MB pro Render. Ein Headless-Crawler rief seit dem 29.09. rund
 * 2.400 Company-Seiten am Tag auf, ~80 % davon nicht-deutsch: der größte Posten
 * im Supabase-Egress (grob 4–6 GB/Tag).
 *
 * Ein Cache pro Seite hilft dabei kaum — der Crawler besucht jede URL selten.
 * Gecacht wird deshalb die TEURE EINHEIT: die extrahierten Artikel (Überschrift
 * + Anriss) je Post und Sprache. Ein Post erwähnt viele Firmen, der Eintrag wird
 * also zwischen allen Company-Seiten geteilt. Die Erwähnungen je Firma sind für
 * alle fünf Sprachen gleich und werden ebenfalls geteilt.
 *
 * Next-Datencache statt Redis: Das Upstash-Kontingent war am 28.08. schon
 * einmal durch einen Crawler erschöpft (shared-cache.ts). Invalidiert wird beim
 * Schreiben: lib/companies/sync.ts (Erwähnungen) und lib/i18n/translation-queue.ts
 * (Übersetzungen), siehe revalidateCompanyCache.
 */
import { revalidateTag, unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseTipTapContent } from '@/lib/companies/extractor'
import { stripLexTags } from '@/lib/glossary/mentions'

export const COMPANY_MENTIONS_TAG = 'company-mentions'
export const CONTENT_TRANSLATIONS_TAG = 'content-translations'

const DAY = 86400
/** Gleichzeitige Cache-Lookups beim Laden der übersetzten Artikel. */
const PARALLEL = 25

interface TipTapNode {
  type?: string
  text?: string
  content?: TipTapNode[]
  attrs?: { level?: number; [key: string]: unknown }
}

export interface CompanyMentionRow {
  company_name: string
  company_slug: string
  company_type: 'public' | 'premarket'
  article_index: number | null
  article_headline: string | null
  article_excerpt: string | null
  post: { id: string; title: string; slug: string | null; created_at: string }
}

export type TranslatedArticle = { headline: string; excerpt: string }

function extractTextFromNode(node: TipTapNode): string {
  if (node.text) return node.text
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromNode).join(' ')
  }
  return ''
}

function extractExcerpt(text: string, maxLength = 150): string {
  // {lex:Begriff}-Direktiven zuerst auflösen, sonst verschwindet der Begriff
  // mitsamt Klammern im generischen {...}-Strip direkt darunter (vierter
  // Strip-Pfad im Repo, Abschluss-Review Befund A2).
  const cleaned = stripLexTags(text).replace(/\{[^}]+\}/g, '').replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  const truncated = cleaned.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  if (lastSpace > maxLength * 0.7) return truncated.slice(0, lastSpace) + '...'
  return truncated + '...'
}

/** Extract H2-delimited articles from TipTap content, same skip rules as extractor.ts */
export function extractArticlesFromContent(content: unknown): TranslatedArticle[] {
  if (!content || typeof content !== 'object') return []
  const root = content as TipTapNode
  if (!root.content || !Array.isArray(root.content)) return []

  const articles: { headline: string; text: string }[] = []
  let current: { headline: string; text: string } | null = null

  for (const node of root.content) {
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const headlineText = extractTextFromNode(node)
      const lower = headlineText.toLowerCase()
      if (
        lower.includes('synthszr take') ||
        lower.includes('synthszr contra') ||
        lower.includes('mattes synthese') ||
        lower.includes("mattes' synthese")
      ) {
        continue
      }
      current = { headline: headlineText, text: headlineText }
      articles.push(current)
    } else if (current) {
      const nodeText = extractTextFromNode(node)
      if (nodeText.trim()) current.text += ' ' + nodeText
    }
  }

  return articles.map((a) => ({ headline: a.headline, excerpt: extractExcerpt(a.text) }))
}

/**
 * Erwähnungen einer Firma in veröffentlichten Posts (Slug case-insensitiv).
 * WIRFT bei Datenbankfehlern: unstable_cache speichert nur erfolgreiche
 * Ergebnisse — eine leere Liste aus einem Fehler hielte eine echte Firma sonst
 * 24 h lang auf 404.
 */
export const getCompanyMentions = unstable_cache(
  async (slugLower: string): Promise<CompanyMentionRow[]> => {
    // post_company_mentions ist RLS-gesperrt → service_role statt anon
    const { data, error } = await createAdminClient()
      .from('post_company_mentions')
      .select(`
        company_name,
        company_slug,
        company_type,
        article_index,
        article_headline,
        article_excerpt,
        post:generated_posts!inner(
          id,
          title,
          slug,
          created_at,
          status
        )
      `)
      .ilike('company_slug', slugLower)
      .eq('post.status', 'published')
      .order('created_at', { ascending: false })
    if (error) throw new Error(`company mentions (${slugLower}): ${error.message}`)
    return (data ?? []) as unknown as CompanyMentionRow[]
  },
  ['company-mentions-v1'],
  { revalidate: DAY, tags: [COMPANY_MENTIONS_TAG] },
)

/** Übersetzte Artikel EINES Posts — wirft bei Datenbankfehlern (s. o.). */
const getTranslatedArticles = unstable_cache(
  async (postId: string, locale: string): Promise<TranslatedArticle[]> => {
    const { data, error } = await createAdminClient()
      .from('content_translations')
      .select('content')
      .eq('generated_post_id', postId)
      .eq('language_code', locale)
      .eq('translation_status', 'completed')
      .maybeSingle()
    if (error) throw new Error(`content translation (${postId}/${locale}): ${error.message}`)
    const content = (data as { content?: unknown } | null)?.content
    if (!content) return []
    return extractArticlesFromContent(parseTipTapContent(content as string | object))
  },
  ['company-translated-articles-v1'],
  { revalidate: DAY, tags: [CONTENT_TRANSLATIONS_TAG] },
)

/**
 * Übersetzte Artikel je Post für eine Sprache. Posts ohne Übersetzung oder mit
 * Ladefehler fehlen in der Map — die Seite zeigt dann die deutschen Texte aus
 * post_company_mentions, wie bisher bei fehlender Übersetzung.
 */
export async function getTranslatedArticlesByPost(postIds: string[], locale: string): Promise<Map<string, TranslatedArticle[]>> {
  const map = new Map<string, TranslatedArticle[]>()
  for (let i = 0; i < postIds.length; i += PARALLEL) {
    const chunk = postIds.slice(i, i + PARALLEL)
    const results = await Promise.allSettled(chunk.map((id) => getTranslatedArticles(id, locale)))
    results.forEach((r, j) => {
      if (r.status === 'fulfilled') {
        if (r.value.length > 0) map.set(chunk[j], r.value)
      } else {
        console.warn('[companies] Übersetzung nicht ladbar:', r.reason instanceof Error ? r.reason.message : r.reason)
      }
    })
  }
  return map
}

/**
 * Nach dem Schreiben von Erwähnungen bzw. Übersetzungen aufrufen. Außerhalb
 * eines Next-Requests (Skripte) wirft revalidateTag — dann greift die TTL.
 */
export function revalidateCompanyCache(tag: typeof COMPANY_MENTIONS_TAG | typeof CONTENT_TRANSLATIONS_TAG): void {
  try {
    revalidateTag(tag, 'max')
  } catch {
    // Kein Request-Kontext — der Cache läuft spätestens nach 24 h ab.
  }
}
