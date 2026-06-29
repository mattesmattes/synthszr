import { createAdminClient } from '@/lib/supabase/admin'
import { momentumScore } from '@/lib/rankings/score'
import { getRankedProducts } from '@/lib/rankings/leaderboard'

export interface ProductMentionView {
  excerpt: string | null
  mentionDate: string | null
  sentiment: number | null
  sourceTitle: string | null
}

export interface ProductDetail {
  id: string
  canonicalName: string
  vendor: string
  slug: string
  family: string
  version: string | null
  qualifier: string | null
  firstSeen: string | null
  lastSeen: string | null
  momentum: number
  mentionCount: number
  rank: number | null
  score: number | null
  mentions: ProductMentionView[]
}

/** Macht Newsletter-Titel anzeigbar: Markdown-Links → Text, getrimmt. */
function cleanTitle(t: string | null): string | null {
  if (!t) return null
  const cleaned = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim()
  return cleaned || null
}

/** Lädt eine sichtbare Produkt-Detailansicht (Header + Belege + Rang/Score). */
export async function getProductDetail(slug: string): Promise<ProductDetail | null> {
  const supabase = createAdminClient()

  const { data: product, error: pErr } = await supabase
    .from('products')
    .select('id, canonical_name, vendor_namespace, slug, family, version, qualifier, first_seen, last_seen')
    .eq('slug', slug)
    .eq('visibility_status', 'visible')
    .maybeSingle()
  if (pErr) throw new Error(`product detail: ${pErr.message}`)
  if (!product) return null

  const { data: mentions, error: mErr } = await supabase
    .from('product_mentions')
    .select('excerpt, mention_date, sentiment, daily_repo:daily_repo_id(title)')
    .eq('product_id', product.id)
    .order('mention_date', { ascending: false })
    .limit(100)
  if (mErr) throw new Error(`product detail mentions: ${mErr.message}`)

  const rows = mentions ?? []
  const dates = rows.map((m) => m.mention_date as string).filter(Boolean)

  // Rang/Score konsistent zum Leaderboard (relativ zum Spitzenreiter).
  const ranked = await getRankedProducts(10_000)
  const entry = ranked.find((r) => r.slug === slug)

  return {
    id: product.id,
    canonicalName: product.canonical_name,
    vendor: product.vendor_namespace,
    slug: product.slug,
    family: product.family,
    version: product.version,
    qualifier: product.qualifier,
    firstSeen: product.first_seen,
    lastSeen: product.last_seen,
    momentum: momentumScore(dates, new Date()),
    mentionCount: dates.length,
    rank: entry?.rank ?? null,
    score: entry?.score ?? null,
    mentions: rows.map((m) => ({
      excerpt: m.excerpt as string | null,
      mentionDate: m.mention_date as string | null,
      sentiment: m.sentiment as number | null,
      sourceTitle: cleanTitle((m.daily_repo as { title: string | null } | null)?.title ?? null),
    })),
  }
}
