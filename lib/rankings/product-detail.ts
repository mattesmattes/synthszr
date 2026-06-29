import { createAdminClient } from '@/lib/supabase/admin'
import { momentumScore, momentumHistory } from '@/lib/rankings/score'
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
  sentiment: { label: string; score: number | null } | null
  features: Array<{ dimension: string; value: string }>
  history: Array<{ t: number; value: number }>
  mentions: ProductMentionView[]
}

const SENTIMENT_DIM = '__sentiment'

/** Supabase typisiert den daily_repo-Join je nach FK-Erkennung als Objekt ODER
 *  Array — beide Formen auf den title herunterbrechen. */
function joinedTitle(dr: unknown): string | null {
  if (!dr) return null
  const obj = Array.isArray(dr) ? dr[0] : dr
  return (obj as { title?: string | null } | undefined)?.title ?? null
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

  // Rang/Score konsistent zum öffentlichen Leaderboard (≥2 Erwähnungen).
  const ranked = await getRankedProducts({ limit: 10_000, minMentions: 2 })
  const entry = ranked.find((r) => r.slug === slug)

  // Sentiment + Features (enrich, 1b-iii)
  const { data: feats } = await supabase
    .from('product_features_current')
    .select('dimension_key, value_text, value_numeric')
    .eq('product_id', product.id)
  const sentimentRow = (feats ?? []).find((f) => f.dimension_key === SENTIMENT_DIM)
  const sentiment = sentimentRow
    ? { label: (sentimentRow.value_text as string) ?? 'neutral', score: sentimentRow.value_numeric as number | null }
    : null
  const features = (feats ?? [])
    .filter((f) => f.dimension_key !== SENTIMENT_DIM)
    .map((f) => ({ dimension: f.dimension_key as string, value: f.value_text as string }))

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
    sentiment,
    features,
    history: momentumHistory(dates, new Date(), 21, 24),
    mentions: rows.map((m) => ({
      excerpt: m.excerpt as string | null,
      mentionDate: m.mention_date as string | null,
      sentiment: m.sentiment as number | null,
      sourceTitle: cleanTitle(joinedTitle(m.daily_repo)),
    })),
  }
}
