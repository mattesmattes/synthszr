/**
 * Data loader for the monthly A2 print poster:
 * "SYNTHSZR MOMENTUM MAP · <MONTH YYYY>" (16 categories × Top 5 = 80 products,
 * plus Global Top 12 90-day rank-flow hero & vendor gravity strip).
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { toDisplayScore } from '@/lib/rankings/score'

export interface HistoryPoint {
  t: number
  value: number
}

export interface PosterHeroProduct {
  id: string
  rank: number
  name: string
  vendor: string
  slug: string
  categorySlug: string
  categoryName: string
  score: number
  momentum: number
  mentionCount: number
  trend: 'up' | 'down' | 'flat'
  /** 13 weekly ranks (1..12) across the 90-day window for the bump/ribbon hero. */
  weeklyRanks: number[]
  /** 13 weekly raw momentum values across the 90-day window. */
  weeklyValues: number[]
  /** Percentage growth between first 30d avg and last 30d avg. */
  velocityPct: number
  isBreakout: boolean
}

export interface PosterCategoryProduct {
  id: string
  catRank: number
  name: string
  vendor: string
  slug: string
  catScore: number
  momentum: number
  trend: 'up' | 'down' | 'flat'
  /** 30 evenly-spaced points from the 90-day history (normalized 0..1 within product). */
  sparkline: number[]
  peakIndex: number
}

export interface PosterCategoryTile {
  index: number
  slug: string
  name: string
  productCount: number
  peakMomentum: number
  /** Category peak relative to global #1 category peak (0..100). */
  heatPct: number
  products: PosterCategoryProduct[]
}

export interface VendorGravityItem {
  vendor: string
  label: string
  momentum: number
  pct: number
  productCount: number
}

export interface EditorialCallout {
  tag: string
  title: string
  detail: string
}

export interface MomentumMapData {
  issueNumber: number
  monthLabel: string
  issueCode: string
  windowLabel: string
  generatedAt: string
  totalMentions90d: number
  totalTrackedProducts: number
  thematicDeck: string
  heroTop12: PosterHeroProduct[]
  weekLabels: string[]
  categories: PosterCategoryTile[]
  vendorGravity: VendorGravityItem[]
  callouts: EditorialCallout[]
}

const CATEGORY_EN_NAMES: Record<string, string> = {
  'coding-agents': 'Coding Agents',
  'frontier-llms': 'Frontier LLMs',
  'text-to-image': 'Text-to-Image',
  'ai-ides': 'AI IDEs & Editors',
  'automation-workflow': 'Automation & Workflows',
  'consumer-assistants': 'Consumer Assistants',
  'multimodal-models': 'Multimodal Models',
  'ai-search': 'AI Search & Research',
  'knowledge-management': 'Knowledge Management',
  'agent-frameworks': 'Agent Frameworks',
  'small-language-models': 'Small & Edge Models',
  'open-source-llms': 'Open-Source LLMs',
  'enterprise-copilots': 'Enterprise Copilots',
  'code-review': 'Code Review & QA',
  'science-bio': 'Science & Bio AI',
  'browser-desktop-agents': 'Browser & Desktop Agents',
  'reasoning-models': 'Reasoning Models',
  'voice-agents': 'Voice Agents',
  'text-to-video': 'Text-to-Video',
  'enterprise-agent-platforms': 'Enterprise Agents',
  'marketing-sales': 'Marketing & Sales AI',
  'chatbots': 'Conversational AI',
  'learning-productivity': 'Productivity & Learning',
  'robotics': 'Robotics & Embodied AI',
  'video-editing': 'AI Video Editing',
  'inference-chips': 'Inference Hardware',
  'training-chips': 'Training Hardware',
  'inference-serving': 'Inference & Serving',
  'cloud-mlops': 'Cloud AI & MLOps',
  'cli-tools': 'CLI & Terminal Tools',
  'ide-extensions': 'IDE Extensions',
  'image-editing': 'AI Image Editing',
  'music-generation': 'AI Music',
  'text-to-speech': 'Text-to-Speech',
  'speech-to-text': 'Speech-to-Text',
  'no-code-builders': 'No-Code Builders',
  'observability-evals': 'Observability & Evals',
  'presentation-design': 'Presentation & Design',
  'prompt-dev-tools': 'Prompt & Dev Tools',
  'local-runtimes': 'Local LLM Runtimes',
  'llm-gateways': 'LLM APIs & Gateways',
  'embeddings-vector': 'Embeddings & Vector DBs',
  'legal-compliance': 'Legal & Compliance',
  'healthcare': 'Healthcare AI',
  'customer-service': 'Customer Service AI',
  'autonomous-driving': 'Autonomous Driving',
  'world-generation': '3D & World Models',
  'ai-detection': 'AI Detection',
  'translation': 'AI Translation',
  'web-development': 'AI Web Dev',
}

const VENDOR_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  meta: 'Meta',
  xai: 'xAI',
  anysphere: 'Anysphere',
  microsoft: 'Microsoft',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
  alibaba: 'Alibaba',
  bytedance: 'ByteDance',
  amazon: 'Amazon',
  nvidia: 'Nvidia',
  perplexity: 'Perplexity',
  apple: 'Apple',
  cursor: 'Anysphere',
}

function formatVendor(raw: string | null | undefined): string {
  if (!raw || raw === 'unknown') return 'Independent'
  const lower = raw.toLowerCase()
  return VENDOR_LABELS[lower] ?? raw.charAt(0).toUpperCase() + raw.slice(1)
}

function categoryNameEn(slug: string, fallback?: string): string {
  return CATEGORY_EN_NAMES[slug] ?? fallback ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function downsampleSparkline(history: HistoryPoint[], buckets = 30): { values: number[]; peakIndex: number } {
  if (!history.length) return { values: Array(buckets).fill(0), peakIndex: 0 }
  const raw: number[] = []
  const step = history.length / buckets
  for (let i = 0; i < buckets; i++) {
    const start = Math.floor(i * step)
    const end = Math.max(start + 1, Math.floor((i + 1) * step))
    let sum = 0
    for (let j = start; j < end && j < history.length; j++) sum += history[j].value ?? 0
    raw.push(sum / Math.max(1, end - start))
  }
  const max = Math.max(...raw, 0.0001)
  let peakIndex = 0
  let peakVal = -1
  const values = raw.map((v, idx) => {
    if (v >= peakVal) {
      peakVal = v
      peakIndex = idx
    }
    return Math.round((v / max) * 1000) / 1000
  })
  return { values, peakIndex }
}

function weeklyBuckets(history: HistoryPoint[], weeks = 13): number[] {
  if (!history.length) return Array(weeks).fill(0)
  const out: number[] = []
  const step = history.length / weeks
  for (let w = 0; w < weeks; w++) {
    const start = Math.floor(w * step)
    const end = Math.max(start + 1, Math.floor((w + 1) * step))
    let sum = 0
    for (let j = start; j < end && j < history.length; j++) sum += history[j].value ?? 0
    out.push(sum / Math.max(1, end - start))
  }
  return out
}

const MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function fmtShortDate(d: Date): string {
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')}`
}

export async function buildMomentumMapData(now: Date = new Date()): Promise<MomentumMapData> {
  const supabase = createAdminClient()

  // Issue #1 = Nov 2026
  const issueNumber = Math.max(1, (now.getUTCFullYear() - 2026) * 12 + (now.getUTCMonth() - 10) + 1)
  const monthLabel = `${MONTHS_SHORT[now.getUTCMonth()]} ${now.getUTCFullYear()}`
  const issueCode = `ISSUE ${String(issueNumber).padStart(2, '0')}`

  const start90 = new Date(now.getTime() - 89 * 86_400_000)
  const windowLabel = `${fmtShortDate(start90)} – ${fmtShortDate(now)}, ${now.getUTCFullYear()}`

  // 13 weekly axis labels (show month ticks at key weeks)
  const weekLabels: string[] = []
  for (let w = 0; w < 13; w++) {
    const d = new Date(start90.getTime() + Math.round((w * 89) / 12) * 86_400_000)
    weekLabels.push(fmtShortDate(d))
  }

  const sinceIso = start90.toISOString().slice(0, 10)
  const [mentionsRes, catsRes] = await Promise.all([
    supabase
      .from('product_mentions')
      .select('id', { count: 'exact', head: true })
      .gte('mention_date', sinceIso),
    supabase.from('product_categories').select('slug, name'),
  ])

  const totalMentions90d = mentionsRes.count ?? 0
  const catFallback = new Map<string, string>(
    ((catsRes.data ?? []) as Array<{ slug: string; name: string }>).map((c) => [c.slug, c.name])
  )

  // Load top 1200 chartable visible products (2 paginated fetches max)
  type MetricRow = {
    momentum: number
    trend: string | null
    mention_count: number
    primary_category: string | null
    history: HistoryPoint[] | null
    products:
      | { id: string; canonical_name: string; vendor_namespace: string | null; slug: string }
      | Array<{ id: string; canonical_name: string; vendor_namespace: string | null; slug: string }>
  }

  const allRows: MetricRow[] = []
  for (let off = 0; off < 1200; off += 600) {
    const { data, error } = await supabase
      .from('product_metrics')
      .select('momentum, trend, mention_count, primary_category, history, products!inner(id, canonical_name, vendor_namespace, slug)')
      .eq('chartable', true)
      .eq('products.visibility_status', 'visible')
      .gte('mention_count', 2)
      .order('momentum', { ascending: false })
      .order('product_id', { ascending: true })
      .range(off, off + 599)
    if (error) throw new Error(`momentum-map metrics: ${error.message}`)
    const batch = (data ?? []) as unknown as MetricRow[]
    allRows.push(...batch)
    if (batch.length < 600) break
  }

  const normalized = allRows.map((r) => {
    const p = Array.isArray(r.products) ? r.products[0] : r.products
    return {
      id: p.id,
      name: p.canonical_name,
      vendorRaw: (p.vendor_namespace ?? 'unknown').toLowerCase(),
      vendor: formatVendor(p.vendor_namespace),
      slug: p.slug,
      categorySlug: r.primary_category ?? 'other',
      momentum: Number(r.momentum) || 0,
      mentionCount: Number(r.mention_count) || 0,
      trend: (r.trend === 'up' || r.trend === 'down' ? r.trend : 'flat') as 'up' | 'down' | 'flat',
      history: Array.isArray(r.history) ? r.history : [],
    }
  })

  // --- HERO: Global Top 12 with 13-week rank flow ---
  const top12Raw = normalized.slice(0, 12)
  const globalMax = top12Raw[0]?.momentum || 1
  const weeklyMatrix = top12Raw.map((p) => weeklyBuckets(p.history, 13))

  // Compute rank 1..12 per week (ties broken by overall rank)
  const weeklyRanksByProduct: number[][] = top12Raw.map(() => Array(13).fill(12))
  for (let w = 0; w < 13; w++) {
    const order = top12Raw
      .map((_, idx) => ({ idx, val: weeklyMatrix[idx][w] }))
      .sort((a, b) => b.val - a.val || a.idx - b.idx)
    order.forEach((entry, rankIdx) => {
      weeklyRanksByProduct[entry.idx][w] = rankIdx + 1
    })
  }
  // Ensure final week (w=12) reflects current official global rank cleanly
  top12Raw.forEach((_, idx) => {
    weeklyRanksByProduct[idx][12] = idx + 1
  })

  const heroTop12: PosterHeroProduct[] = top12Raw.map((p, idx) => {
    const wv = weeklyMatrix[idx]
    const earlyAvg = (wv[0] + wv[1] + wv[2] + wv[3]) / 4
    const lateAvg = (wv[9] + wv[10] + wv[11] + wv[12]) / 4
    const velocityPct = earlyAvg > 0.5 ? Math.round(((lateAvg - earlyAvg) / earlyAvg) * 100) : lateAvg > 2 ? 100 : 0
    return {
      id: p.id,
      rank: idx + 1,
      name: p.name,
      vendor: p.vendor,
      slug: p.slug,
      categorySlug: p.categorySlug,
      categoryName: categoryNameEn(p.categorySlug, catFallback.get(p.categorySlug)),
      score: toDisplayScore(p.momentum, globalMax),
      momentum: Math.round(p.momentum * 10) / 10,
      mentionCount: p.mentionCount,
      trend: p.trend,
      weeklyRanks: weeklyRanksByProduct[idx],
      weeklyValues: wv,
      velocityPct,
      isBreakout: p.trend === 'up' || velocityPct >= 60,
    }
  })

  // --- 16 CATEGORIES × TOP 5 = 80 PRODUCTS ---
  const byCategory = new Map<string, typeof normalized>()
  for (const item of normalized) {
    if (!item.categorySlug || item.categorySlug === 'other') continue
    const list = byCategory.get(item.categorySlug) ?? []
    list.push(item)
    byCategory.set(item.categorySlug, list)
  }

  const rankedCats = [...byCategory.entries()]
    .filter(([, list]) => list.length >= 3)
    .map(([slug, list]) => ({
      slug,
      name: categoryNameEn(slug, catFallback.get(slug)),
      productCount: list.length,
      peakMomentum: list[0]?.momentum ?? 0,
      top5: list.slice(0, 5),
    }))
    .sort((a, b) => b.peakMomentum - a.peakMomentum)
    .slice(0, 16)

  const maxCatPeak = rankedCats[0]?.peakMomentum || 1
  const categories: PosterCategoryTile[] = rankedCats.map((cat, idx) => ({
    index: idx + 1,
    slug: cat.slug,
    name: cat.name,
    productCount: cat.productCount,
    peakMomentum: Math.round(cat.peakMomentum * 10) / 10,
    heatPct: Math.max(4, Math.round((cat.peakMomentum / maxCatPeak) * 100)),
    products: cat.top5.map((p, pIdx) => {
      const sp = downsampleSparkline(p.history, 30)
      return {
        id: p.id,
        catRank: pIdx + 1,
        name: p.name,
        vendor: p.vendor,
        slug: p.slug,
        catScore: toDisplayScore(p.momentum, cat.peakMomentum),
        momentum: Math.round(p.momentum * 10) / 10,
        trend: p.trend,
        sparkline: sp.values,
        peakIndex: sp.peakIndex,
      }
    }),
  }))

  // --- VENDOR GRAVITY STRIP ---
  const vendorTotals = new Map<string, { label: string; momentum: number; count: number }>()
  let totalMomentumAll = 0
  for (const p of normalized.slice(0, 200)) {
    totalMomentumAll += p.momentum
    const key = p.vendorRaw === 'unknown' ? 'other' : p.vendorRaw
    const prev = vendorTotals.get(key) ?? { label: key === 'other' ? 'Independent & Others' : p.vendor, momentum: 0, count: 0 }
    prev.momentum += p.momentum
    prev.count += 1
    vendorTotals.set(key, prev)
  }
  const sortedVendors = [...vendorTotals.entries()]
    .filter(([k]) => k !== 'other')
    .sort((a, b) => b[1].momentum - a[1].momentum)
  const top7 = sortedVendors.slice(0, 7)
  const restMomentum = totalMomentumAll - top7.reduce((s, [, v]) => s + v.momentum, 0)
  const vendorGravity: VendorGravityItem[] = [
    ...top7.map(([vendor, v]) => ({
      vendor,
      label: v.label,
      momentum: Math.round(v.momentum),
      pct: Math.round((v.momentum / Math.max(1, totalMomentumAll)) * 1000) / 10,
      productCount: v.count,
    })),
    {
      vendor: 'others',
      label: 'Others',
      momentum: Math.round(Math.max(0, restMomentum)),
      pct: Math.round((Math.max(0, restMomentum) / Math.max(1, totalMomentumAll)) * 1000) / 10,
      productCount: normalized.slice(0, 200).length - top7.reduce((s, [, v]) => s + v.count, 0),
    },
  ]

  // --- EDITORIAL CALLOUTS ---
  const leader = heroTop12[0]
  const runnerUp = heroTop12[1]
  const breakout = [...heroTop12].sort((a, b) => (b.trend === 'up' ? 1 : 0) - (a.trend === 'up' ? 1 : 0) || b.velocityPct - a.velocityPct)[0]
  const bigTech = new Set(['anthropic', 'openai', 'google', 'meta', 'microsoft', 'amazon', 'apple', 'nvidia', 'xai'])
  const topIndie = normalized.find((p) => !bigTech.has(p.vendorRaw) && p.vendorRaw !== 'unknown')
  const topVendor = vendorGravity[0]

  const callouts: EditorialCallout[] = [
    {
      tag: '01 · CATEGORY KING',
      title: `${leader?.name ?? 'Claude Code'} leads global attention`,
      detail: `${leader?.categoryName ?? 'Coding Agents'} holds #1 & #2 overall (peak ${Math.round(leader?.momentum ?? 0)}).`,
    },
    {
      tag: '02 · BREAKOUT VELOCITY',
      title: `${breakout?.name ?? 'Top Mover'} surging`,
      detail: `${breakout?.vendor ?? ''} (${breakout?.categoryName ?? ''}) at #${breakout?.rank ?? '-'} (${breakout?.velocityPct >= 0 ? '+' : ''}${breakout?.velocityPct ?? 0}% 90d).`,
    },
    {
      tag: '03 · TOP INDEPENDENT',
      title: `${topIndie?.name ?? 'Cursor'} (${topIndie?.vendor ?? 'Anysphere'})`,
      detail: `Top challenger outside Big Tech labs (${Math.round(topIndie?.momentum ?? 0)} momentum).`,
    },
    {
      tag: '04 · LAB CONCENTRATION',
      title: `${topVendor?.label ?? 'Anthropic'} captures ${topVendor?.pct ?? 0}% share`,
      detail: `Top 3 labs hold ${Math.round((vendorGravity[0]?.pct ?? 0) + (vendorGravity[1]?.pct ?? 0) + (vendorGravity[2]?.pct ?? 0))}% of Top-200 attention.`,
    },
  ]

  const thematicDeck =
    leader && runnerUp && leader.categorySlug === runnerUp.categorySlug
      ? `The 90-day map where ${leader.categoryName.toLowerCase()} overtook foundation models as AI's primary battleground.`
      : `90 days of AI product attention — tracking breakouts, category leaders, and lab gravity across 16 markets.`

  return {
    issueNumber,
    monthLabel,
    issueCode,
    windowLabel,
    generatedAt: now.toISOString(),
    totalMentions90d,
    totalTrackedProducts: normalized.length,
    thematicDeck,
    heroTop12,
    weekLabels,
    categories,
    vendorGravity,
    callouts,
  }
}
