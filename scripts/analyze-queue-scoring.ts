/**
 * News Queue Scoring Analysis
 * Analyzes scoring patterns to validate improvement hypotheses.
 * Run: npx tsx scripts/analyze-queue-scoring.ts
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load env files from project root (later files override earlier ones)
const root = resolve(import.meta.dirname || __dirname, '..')
config({ path: [resolve(root, '.env.prod.temp'), resolve(root, '.env.local')] })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.log('Missing env vars'); process.exit(1) }
const supabase = createClient(url, key)

// ── Helpers ──────────────────────────────────────────────────────

function stats(values: number[]) {
  if (values.length === 0) return { n: 0, min: 0, max: 0, mean: 0, median: 0, stddev: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const mean = sorted.reduce((a, b) => a + b, 0) / n
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)]
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n
  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    mean: +mean.toFixed(2),
    median: +median.toFixed(2),
    stddev: +Math.sqrt(variance).toFixed(2),
  }
}

function fmtStats(s: ReturnType<typeof stats>) {
  return `n=${s.n}  min=${s.min}  max=${s.max}  mean=${s.mean}  median=${s.median}  stddev=${s.stddev}`
}

function titleBigrams(title: string): Set<string> {
  const words = title.toLowerCase().replace(/[^a-zäöüß0-9\s]/g, '').split(/\s+/).filter(w => w.length > 1)
  const bigrams = new Set<string>()
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i + 1]}`)
  }
  return bigrams
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

// ── Data Fetching ────────────────────────────────────────────────

interface QueueItem {
  id: string
  title: string
  source_identifier: string
  source_bonus: number
  synthesis_score: number
  relevance_score: number
  uniqueness_score: number
  total_score: number
  status: string
  queued_at: string
  selected_at: string | null
  email_received_at: string | null
}

async function fetchAllItems(): Promise<QueueItem[]> {
  const allItems: QueueItem[] = []
  let offset = 0
  const limit = 1000

  while (true) {
    const { data, error } = await supabase
      .from('news_queue')
      .select('id, title, source_identifier, source_bonus, synthesis_score, relevance_score, uniqueness_score, total_score, status, queued_at, selected_at, email_received_at')
      .range(offset, offset + limit - 1)
      .order('queued_at', { ascending: false })

    if (error) { console.error('Fetch error:', error.message); break }
    if (!data || data.length === 0) break
    allItems.push(...data)
    if (data.length < limit) break
    offset += limit
  }

  return allItems
}

// ── Analysis Functions ───────────────────────────────────────────

function analyzeScoreDistributions(items: QueueItem[]) {
  console.log('\n' + '='.repeat(70))
  console.log('1. SCORE-VERTEILUNGEN NACH STATUS')
  console.log('='.repeat(70))

  const byStatus = new Map<string, QueueItem[]>()
  for (const item of items) {
    const list = byStatus.get(item.status) || []
    list.push(item)
    byStatus.set(item.status, list)
  }

  for (const [status, statusItems] of byStatus) {
    console.log(`\n  Status: ${status} (${statusItems.length} items)`)
    console.log(`    total_score:     ${fmtStats(stats(statusItems.map(i => i.total_score)))}`)
    console.log(`    synthesis_score: ${fmtStats(stats(statusItems.map(i => i.synthesis_score)))}`)
    console.log(`    relevance_score: ${fmtStats(stats(statusItems.map(i => i.relevance_score)))}`)
    console.log(`    uniqueness_score:${fmtStats(stats(statusItems.map(i => i.uniqueness_score)))}`)
    console.log(`    source_bonus:    ${fmtStats(stats(statusItems.map(i => i.source_bonus)))}`)
  }
}

function analyzeSourceBonusImpact(items: QueueItem[]) {
  console.log('\n' + '='.repeat(70))
  console.log('2. SOURCE-BONUS IMPACT')
  console.log('='.repeat(70))

  // Compare ranking with and without bonus
  const pendingItems = items.filter(i => i.status === 'used' || i.status === 'selected' || i.status === 'pending')

  const withBonus = [...pendingItems].sort((a, b) => b.total_score - a.total_score)
  const baseScore = (i: QueueItem) => i.synthesis_score * 0.4 + i.relevance_score * 0.3 + i.uniqueness_score * 0.3
  const withoutBonus = [...pendingItems].sort((a, b) => baseScore(b) - baseScore(a))

  const rankWith = new Map<string, number>()
  const rankWithout = new Map<string, number>()
  withBonus.forEach((item, idx) => rankWith.set(item.id, idx + 1))
  withoutBonus.forEach((item, idx) => rankWithout.set(item.id, idx + 1))

  let rankChanges = 0
  let bonusOverrides = 0  // Tier-Artikel mit niedrigem Base-Score überholt besseren No-Tier-Artikel

  for (const item of pendingItems) {
    const rW = rankWith.get(item.id)!
    const rWO = rankWithout.get(item.id)!
    if (rW !== rWO) rankChanges++
  }

  // Count cases where a tiered article (with lower base score) outranks a non-tiered one
  for (let i = 0; i < withBonus.length; i++) {
    const item = withBonus[i]
    if (item.source_bonus === 0) continue
    const itemBase = baseScore(item)

    // Check items ranked below this one (with bonus) that have higher base score
    for (let j = i + 1; j < Math.min(i + 50, withBonus.length); j++) {
      const other = withBonus[j]
      if (other.source_bonus > 0) continue
      if (baseScore(other) > itemBase) {
        bonusOverrides++
        break  // Count once per overriding item
      }
    }
  }

  console.log(`\n  Total items analyzed: ${pendingItems.length}`)
  console.log(`  Items with source_bonus > 0: ${pendingItems.filter(i => i.source_bonus > 0).length}`)
  console.log(`  Rank changes with/without bonus: ${rankChanges} (${(rankChanges / pendingItems.length * 100).toFixed(1)}%)`)
  console.log(`  Bonus overrides (premium outranks better no-tier): ${bonusOverrides}`)

  // Show top 10 with vs without bonus
  console.log('\n  Top 20 MIT Bonus:')
  for (let i = 0; i < Math.min(20, withBonus.length); i++) {
    const item = withBonus[i]
    const base = baseScore(item).toFixed(1)
    const bonus = item.source_bonus > 0 ? ` +${item.source_bonus}` : ''
    console.log(`    ${String(i + 1).padStart(3)}. [${item.total_score.toFixed(1)}] base=${base}${bonus}  "${item.title.slice(0, 60)}"`)
  }

  console.log('\n  Top 20 OHNE Bonus (rein nach Content-Score):')
  for (let i = 0; i < Math.min(20, withoutBonus.length); i++) {
    const item = withoutBonus[i]
    const base = baseScore(item).toFixed(1)
    const bonus = item.source_bonus > 0 ? ` (bonus=${item.source_bonus})` : ''
    console.log(`    ${String(i + 1).padStart(3)}. [${base}]${bonus}  "${item.title.slice(0, 60)}"`)
  }
}

function analyzeScoreCorrelation(items: QueueItem[]) {
  console.log('\n' + '='.repeat(70))
  console.log('3. SCORE-KORRELATION MIT AUSWAHL')
  console.log('='.repeat(70))

  const usedItems = items.filter(i => i.status === 'used')
  const otherItems = items.filter(i => i.status !== 'used' && i.status !== 'selected')

  if (usedItems.length === 0 || otherItems.length === 0) {
    console.log('  Nicht genug Daten für Korrelationsanalyse (benötigt used + andere Items)')
    return
  }

  console.log(`\n  Used items: ${usedItems.length}, Other: ${otherItems.length}`)

  // Compare means
  const dimensions = ['synthesis_score', 'relevance_score', 'uniqueness_score'] as const
  for (const dim of dimensions) {
    const usedMean = usedItems.reduce((s, i) => s + i[dim], 0) / usedItems.length
    const otherMean = otherItems.reduce((s, i) => s + i[dim], 0) / otherItems.length
    const diff = usedMean - otherMean
    console.log(`  ${dim.padEnd(18)}: used=${usedMean.toFixed(2)}  other=${otherMean.toFixed(2)}  diff=${diff > 0 ? '+' : ''}${diff.toFixed(2)}`)
  }

  // Which score best separates used from non-used?
  console.log('\n  Separation power (higher = better predictor of selection):')
  for (const dim of dimensions) {
    const usedVals = usedItems.map(i => i[dim])
    const otherVals = otherItems.map(i => i[dim])
    const usedStats = stats(usedVals)
    const otherStats = stats(otherVals)
    const pooledStd = Math.sqrt((usedStats.stddev ** 2 + otherStats.stddev ** 2) / 2) || 1
    const cohensD = (usedStats.mean - otherStats.mean) / pooledStd
    console.log(`    ${dim.padEnd(18)}: Cohen's d = ${cohensD.toFixed(2)}`)
  }
}

function analyzeTopicClustering(items: QueueItem[]) {
  console.log('\n' + '='.repeat(70))
  console.log('4. TOPIC-CLUSTERING (Titel-Bigram Jaccard)')
  console.log('='.repeat(70))

  // Focus on used items (those that actually made it to articles)
  const usedItems = items.filter(i => i.status === 'used')
  const pendingItems = items.filter(i => i.status === 'pending')

  for (const [label, subset] of [['Used', usedItems], ['Pending (latest 200)', pendingItems.slice(0, 200)]] as const) {
    const itemsToCheck = Array.isArray(subset) ? subset : []
    if (itemsToCheck.length < 2) continue

    const bigrams = itemsToCheck.map(i => ({ id: i.id, title: i.title, bg: titleBigrams(i.title) }))
    const duplicatePairs: Array<{ a: string; b: string; sim: number }> = []

    for (let i = 0; i < bigrams.length; i++) {
      for (let j = i + 1; j < bigrams.length; j++) {
        const sim = jaccardSimilarity(bigrams[i].bg, bigrams[j].bg)
        if (sim > 0.5) {
          duplicatePairs.push({
            a: bigrams[i].title.slice(0, 50),
            b: bigrams[j].title.slice(0, 50),
            sim,
          })
        }
      }
    }

    console.log(`\n  ${label}: ${itemsToCheck.length} items, ${duplicatePairs.length} duplicate pairs (Jaccard > 0.5)`)
    for (const pair of duplicatePairs.slice(0, 10)) {
      console.log(`    [${pair.sim.toFixed(2)}] "${pair.a}" ↔ "${pair.b}"`)
    }
    if (duplicatePairs.length > 10) {
      console.log(`    ... und ${duplicatePairs.length - 10} weitere Paare`)
    }
  }
}

function analyzeRecencyPatterns(items: QueueItem[]) {
  console.log('\n' + '='.repeat(70))
  console.log('5. RECENCY-MUSTER')
  console.log('='.repeat(70))

  const usedItems = items.filter(i => i.status === 'used' && i.selected_at && i.email_received_at)
  const pendingItems = items.filter(i => i.status === 'pending' && i.email_received_at)

  if (usedItems.length === 0) {
    console.log('  Keine used Items mit selected_at und email_received_at gefunden')
    return
  }

  // Time between email_received_at and selected_at for used items
  const delays = usedItems.map(i => {
    const received = new Date(i.email_received_at!).getTime()
    const selected = new Date(i.selected_at!).getTime()
    return (selected - received) / (1000 * 60 * 60) // hours
  }).filter(d => d >= 0 && d < 200) // Filter outliers

  console.log(`\n  Used items with timing data: ${delays.length}`)
  console.log(`  Delay email→selected: ${fmtStats(stats(delays))} (hours)`)

  // Age distribution of pending items
  if (pendingItems.length > 0) {
    const ages = pendingItems.map(i => {
      const received = new Date(i.email_received_at!).getTime()
      return (Date.now() - received) / (1000 * 60 * 60) // hours
    })
    console.log(`\n  Pending items age: ${fmtStats(stats(ages))} (hours since email_received_at)`)

    // Buckets
    const buckets = [
      { label: '0-6h', count: ages.filter(a => a < 6).length },
      { label: '6-12h', count: ages.filter(a => a >= 6 && a < 12).length },
      { label: '12-24h', count: ages.filter(a => a >= 12 && a < 24).length },
      { label: '24-48h', count: ages.filter(a => a >= 24 && a < 48).length },
      { label: '48h+', count: ages.filter(a => a >= 48).length },
    ]
    console.log('  Age distribution:')
    for (const b of buckets) {
      const pct = (b.count / ages.length * 100).toFixed(1)
      const bar = '█'.repeat(Math.round(b.count / ages.length * 40))
      console.log(`    ${b.label.padEnd(8)} ${String(b.count).padStart(4)} (${pct.padStart(5)}%) ${bar}`)
    }
  }
}

function analyzeScoreCompression(items: QueueItem[]) {
  console.log('\n' + '='.repeat(70))
  console.log('6. HAIKU SCORE-COMPRESSION')
  console.log('='.repeat(70))

  const allItems = items.filter(i => i.synthesis_score > 0)
  if (allItems.length === 0) return

  const dimensions = [
    { name: 'synthesis_score', getter: (i: QueueItem) => i.synthesis_score },
    { name: 'relevance_score', getter: (i: QueueItem) => i.relevance_score },
    { name: 'uniqueness_score', getter: (i: QueueItem) => i.uniqueness_score },
  ]

  for (const dim of dimensions) {
    const values = allItems.map(dim.getter)
    const inRange = values.filter(v => v >= 5 && v <= 8).length
    const pct = (inRange / values.length * 100).toFixed(1)
    console.log(`\n  ${dim.name}:`)
    console.log(`    ${fmtStats(stats(values))}`)
    console.log(`    In 5-8 range: ${inRange}/${values.length} (${pct}%)`)

    // Histogram
    const buckets = Array.from({ length: 11 }, (_, i) => i)
    console.log('    Distribution:')
    for (const bucket of buckets) {
      const count = values.filter(v => Math.round(v) === bucket).length
      const pct = (count / values.length * 100).toFixed(1)
      const bar = '█'.repeat(Math.round(count / values.length * 50))
      console.log(`      ${String(bucket).padStart(2)} : ${String(count).padStart(5)} (${pct.padStart(5)}%) ${bar}`)
    }
  }

  // Cross-dimension correlation
  console.log('\n  Cross-Dimension Korrelation (Pearson r):')
  for (let i = 0; i < dimensions.length; i++) {
    for (let j = i + 1; j < dimensions.length; j++) {
      const xVals = allItems.map(dimensions[i].getter)
      const yVals = allItems.map(dimensions[j].getter)
      const n = xVals.length
      const xMean = xVals.reduce((a, b) => a + b, 0) / n
      const yMean = yVals.reduce((a, b) => a + b, 0) / n
      let num = 0, denX = 0, denY = 0
      for (let k = 0; k < n; k++) {
        const dx = xVals[k] - xMean
        const dy = yVals[k] - yMean
        num += dx * dy
        denX += dx * dx
        denY += dy * dy
      }
      const r = denX > 0 && denY > 0 ? num / Math.sqrt(denX * denY) : 0
      console.log(`    ${dimensions[i].name} ↔ ${dimensions[j].name}: r=${r.toFixed(3)}`)
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('News Queue Scoring Analysis')
  console.log('Fetching data...')

  const items = await fetchAllItems()
  console.log(`Loaded ${items.length} queue items`)

  analyzeScoreDistributions(items)
  analyzeSourceBonusImpact(items)
  analyzeScoreCorrelation(items)
  analyzeTopicClustering(items)
  analyzeRecencyPatterns(items)
  analyzeScoreCompression(items)

  console.log('\n' + '='.repeat(70))
  console.log('ANALYSE ABGESCHLOSSEN')
  console.log('='.repeat(70))
}

main().catch(console.error)
