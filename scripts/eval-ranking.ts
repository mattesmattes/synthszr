// scripts/eval-ranking.ts
// Run: npx tsx scripts/eval-ranking.ts [--stage1]
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
// Relative import — metrics.ts is pure (no `@/` imports), safe under tsx.
import { recallAtK, ndcgAtK } from '../lib/news-queue/metrics'
import { reciprocalRankFusion } from '../lib/news-queue/rrf'

const root = resolve(import.meta.dirname || __dirname, '..')
config({ path: [resolve(root, '.env.prod.temp'), resolve(root, '.env.local')] })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Inline RPC call — avoids importing the `@/`-aliased wrapper into a tsx script.
async function winnerSim(ids: string[]): Promise<Map<string, number>> {
  const { data } = await supabase.rpc('get_winner_similarity', { candidate_ids: ids, winner_limit: 60 })
  const m = new Map<string, number>()
  for (const r of (data as { queue_item_id: string; similarity: number }[]) || []) m.set(r.queue_item_id, r.similarity)
  return m
}

async function main() {
  if (process.argv.includes('--stage1')) {
    await benchmarkStage1()
    return
  }

  // 1) Ground truth: published queueItemIds grouped by post.
  const { data: posts, error } = await supabase
    .from('generated_posts')
    .select('id, content, created_at')
    .eq('status', 'published')
  if (error) throw error

  const K = 15
  const recalls: number[] = []
  const ndcgs: number[] = []

  for (const post of posts || []) {
    const relevant = extractQueueItemIds(post.content)
    if (relevant.size === 0) continue

    const dayStart = new Date(new Date(post.created_at).getTime() - 24 * 3600e3).toISOString()
    const dayEnd = new Date(new Date(post.created_at).getTime() + 24 * 3600e3).toISOString()
    const { data: cands } = await supabase
      .from('news_queue')
      .select('id, total_score')
      .gte('queued_at', dayStart)
      .lte('queued_at', dayEnd)
      .order('total_score', { ascending: false })
      .limit(300)

    const ranked = (cands || []).map((c) => c.id as string)
    recalls.push(recallAtK(ranked, relevant, K))
    ndcgs.push(ndcgAtK(ranked, relevant, K))
  }

  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
  console.log(`[eval] posts=${recalls.length} Recall@${K}=${avg(recalls).toFixed(3)} NDCG@${K}=${avg(ndcgs).toFixed(3)}`)
}

function extractQueueItemIds(content: unknown): Set<string> {
  const ids = new Set<string>()
  const root = typeof content === 'string' ? safeParse(content) : content
  const nodes = Array.isArray(root) ? root : (root as { content?: unknown[] })?.content
  if (!Array.isArray(nodes)) return ids
  for (const n of nodes) {
    const node = n as { type?: string; attrs?: { queueItemId?: string } }
    if (node?.type === 'heading' && node.attrs?.queueItemId && node.attrs.queueItemId !== 'null') {
      ids.add(node.attrs.queueItemId)
    }
  }
  return ids
}
function safeParse(s: string): unknown { try { return JSON.parse(s) } catch { return null } }

async function benchmarkStage1() {
  const { data: posts } = await supabase
    .from('generated_posts').select('id, content, created_at').eq('status', 'published')
  const Ks = [40, 60, 80]
  const recallByK: Record<number, number[]> = { 40: [], 60: [], 80: [] }

  for (const post of posts || []) {
    const relevant = extractQueueItemIds(post.content)
    if (relevant.size === 0) continue
    const dayStart = new Date(new Date(post.created_at).getTime() - 24 * 3600e3).toISOString()
    const dayEnd = new Date(new Date(post.created_at).getTime() + 24 * 3600e3).toISOString()
    const { data: cands } = await supabase
      .from('news_queue').select('id, total_score')
      .gte('queued_at', dayStart).lte('queued_at', dayEnd)
      .order('total_score', { ascending: false }).limit(300)
    const ids = (cands || []).map((c) => c.id as string)
    if (ids.length === 0) continue

    const scoreRank = ids // already total_score DESC
    const simMap = await winnerSim(ids)
    const simRank = [...ids].sort((a, b) => (simMap.get(b) ?? 0) - (simMap.get(a) ?? 0))
    const fused = reciprocalRankFusion([scoreRank, simRank], 60)

    for (const K of Ks) {
      const topK = new Set(fused.slice(0, K))
      let hits = 0
      for (const r of relevant) if (topK.has(r)) hits++
      recallByK[K].push(hits / relevant.size)
    }
  }
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
  for (const K of Ks) console.log(`[stage1] RRF Recall@${K} = ${avg(recallByK[K]).toFixed(3)}`)
  console.log('[stage1] Decision rule: if Recall@80 < 0.7, skip stage-1 prefilter and rerank ALL candidates.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
