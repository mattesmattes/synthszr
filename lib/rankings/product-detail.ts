import { createAdminClient } from '@/lib/supabase/admin'
import { momentumScore, momentumHistory } from '@/lib/rankings/score'
import { getRankedProducts } from '@/lib/rankings/leaderboard'

export interface ProductMentionView {
  excerpt: string | null
  mentionDate: string | null
  sentiment: number | null
  sourceTitle: string | null
  sourceMedium: string | null
  sourceUrl: string | null
  sourceContent: string | null
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
  category: { slug: string; name: string } | null
  sentiment: { label: string; score: number | null } | null
  description: string | null
  releasedAt: string | null
  features: Array<{ dimension: string; value: string }>
  history: Array<{ t: number; value: number }>
  mentions: ProductMentionView[]
}

const SENTIMENT_DIM = '__sentiment'
const META_DIMS = new Set([SENTIMENT_DIM, '__description', '__description_en', '__released', '__researched_at'])

/** Supabase typisiert den daily_repo-Join je nach FK-Erkennung als Objekt ODER
 *  Array — beide Formen auf den title herunterbrechen. */
function joinedField(dr: unknown, field: 'title' | 'content' | 'source_email' | 'source_url'): string | null {
  if (!dr) return null
  const obj = Array.isArray(dr) ? dr[0] : dr
  return (obj as Record<string, string | null> | undefined)?.[field] ?? null
}

/** HTML → lesbarer Plain-Text: Block-Tags zu Umbrüchen, restliche Tags entfernt,
 *  Entities dekodiert. Sicher (kein dangerouslySetInnerHTML). */
function htmlToText(html: string | null): string | null {
  if (!html) return null
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr|figure|figcaption)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#x27;/gi, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return text || null
}

/** "DEV Community <yo@dev.to>" → "DEV Community"; Fallback: Domain bzw. ganze Adresse. */
function parseMedium(email: string | null): string | null {
  if (!email) return null
  const strip = (s: string) => s.trim().replace(/^["']+|["']+$/g, '').trim()
  const m = email.match(/^\s*([^<]+?)\s*</)
  if (m) return strip(m[1])
  const dom = email.match(/@([^>\s]+)/)
  return dom ? dom[1] : strip(email)
}

/** Macht Newsletter-Titel anzeigbar: Markdown-Links → Text, getrimmt. */
function cleanTitle(t: string | null): string | null {
  if (!t) return null
  const cleaned = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim()
  return cleaned || null
}

/** Lädt eine sichtbare Produkt-Detailansicht (Header + Belege + Rang/Score). */
export async function getProductDetail(slug: string, locale = 'de'): Promise<ProductDetail | null> {
  const supabase = createAdminClient()

  const { data: product, error: pErr } = await supabase
    .from('products')
    .select('id, canonical_name, vendor_namespace, slug, family, version, qualifier, first_seen, last_seen')
    .eq('slug', slug)
    .eq('visibility_status', 'visible')
    .maybeSingle()
  if (pErr) throw new Error(`product detail: ${pErr.message}`)
  if (!product) return null

  // primäre Kategorie (für Breadcrumb)
  const { data: catRow } = await supabase
    .from('product_category_membership')
    .select('category, product_categories:category(name)')
    .eq('product_id', product.id)
    .eq('is_primary', true)
    .maybeSingle()
  const catName = catRow
    ? (Array.isArray(catRow.product_categories) ? catRow.product_categories[0] : catRow.product_categories)?.name as string | undefined
    : undefined
  const category = catRow ? { slug: catRow.category as string, name: catName ?? (catRow.category as string) } : null

  const { data: mentions, error: mErr } = await supabase
    .from('product_mentions')
    .select('excerpt, mention_date, sentiment, daily_repo:daily_repo_id(title, content, source_email, source_url)')
    .eq('product_id', product.id)
    .order('mention_date', { ascending: false })
    .limit(60)
  if (mErr) throw new Error(`product detail mentions: ${mErr.message}`)

  const rows = mentions ?? []

  // ALLE Mention-Daten für Momentum + 90-Tage-Verlauf laden — die Belege oben sind
  // auf 60 limitiert; den Verlauf daraus zu bauen verzerrt ihn (nur die jüngsten 60
  // Datenpunkte), weshalb Produktseite und Vergleichs-Chart unterschiedliche Kurven
  // zeigten. Der Verlauf muss auf der vollen Mention-Historie basieren.
  const dates: string[] = []
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase.from('product_mentions').select('mention_date').eq('product_id', product.id).range(off, off + 999)
    if (!data?.length) break
    dates.push(...data.map((m) => m.mention_date as string).filter(Boolean))
    if (data.length < 1000) break
  }

  // Rang/Score relativ zur KATEGORIE (Position innerhalb der Kategorie, nicht über alle).
  const ranked = await getRankedProducts({ limit: 10_000, minMentions: 2, category: category?.slug })
  const entry = ranked.find((r) => r.slug === slug)

  // Sentiment + Features (enrich, 1b-iii)
  const { data: feats } = await supabase
    .from('product_features_current')
    .select('dimension_key, dimension_key_en, value_text, value_text_en, value_numeric')
    .eq('product_id', product.id)
  const sentimentRow = (feats ?? []).find((f) => f.dimension_key === SENTIMENT_DIM)
  const sentiment = sentimentRow
    ? { label: (sentimentRow.value_text as string) ?? 'neutral', score: sentimentRow.value_numeric as number | null }
    : null
  // Deutsch nur für 'de', alle anderen Sprachen → englische Beschreibung (Fallback: dt.)
  const descDe = (feats ?? []).find((f) => f.dimension_key === '__description')?.value_text as string | undefined
  const descEn = (feats ?? []).find((f) => f.dimension_key === '__description_en')?.value_text as string | undefined
  const description = locale === 'de' ? descDe : (descEn ?? descDe)
  const releasedAt = (feats ?? []).find((f) => f.dimension_key === '__released')?.value_text as string | undefined
  // Nicht-DE Locales → englische Dimension + Wert (Fallback: deutsch), analog description.
  const en = locale !== 'de'
  const features = (feats ?? [])
    .filter((f) => !META_DIMS.has(f.dimension_key as string))
    .map((f) => ({
      dimension: (en ? (f.dimension_key_en as string) : null) ?? (f.dimension_key as string),
      value: (en ? (f.value_text_en as string) : null) ?? (f.value_text as string),
    }))

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
    category,
    sentiment,
    description: description ?? null,
    releasedAt: releasedAt ?? null,
    features,
    history: momentumHistory(dates, new Date(), 90, 90),
    mentions: rows.map((m) => ({
      excerpt: m.excerpt as string | null,
      mentionDate: m.mention_date as string | null,
      sentiment: m.sentiment as number | null,
      sourceTitle: cleanTitle(joinedField(m.daily_repo, 'title')),
      sourceMedium: parseMedium(joinedField(m.daily_repo, 'source_email')),
      sourceUrl: joinedField(m.daily_repo, 'source_url'),
      sourceContent: htmlToText(joinedField(m.daily_repo, 'content'))?.slice(0, 6000) ?? null,
    })),
  }
}
