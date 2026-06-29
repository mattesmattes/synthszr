import { createAdminClient } from '@/lib/supabase/admin'
import { staleBeforeIso } from '@/lib/rankings/jobs-lease'

interface RankingJob {
  id: string; phase: string; cursor: number
  attempts: number; max_attempts: number; status: string; mode: string
  spend_tokens: number
}

const EXTRACT_BATCH = 5
const EXTRACT_BUDGET_MS = 180_000
const EXTRACT_TAIL_MS = 45_000
const MAX_ITEM_ATTEMPTS = 3
const DAILY_WINDOW_DAYS = 1
const EXTRACT_VERSION = '1b-i'

/** Legt einen Ranking-Job an. Täglich idempotent via UNIQUE(mode, run_date) WHERE mode='daily'.
 *  Bei 23505 (Duplikat) → {created:false, reason:'already_created_today'}.
 */
export async function createRankingJob(opts: { mode?: 'daily' | 'backfill' } = {}): Promise<{ created: boolean; reason?: string }> {
  const mode = opts.mode ?? 'daily'
  const supabase = createAdminClient()
  // run_date default current_date → Unique(mode, run_date) WHERE mode='daily' verhindert Mehrfach/Tag.
  const { error } = await supabase.from('ranking_jobs').insert({ mode, phase: 'extract', status: 'pending' })
  if (error?.code === '23505') return { created: false, reason: 'already_created_today' }
  if (error) return { created: false, reason: `insert_failed: ${error.message}` }
  return { created: true }
}

/**
 * Advance-Skelett. Atomarer Claim via claim_ranking_job-RPC (FOR UPDATE SKIP LOCKED)
 * statt Select-then-Update → kein Race zwischen Cron und Browser-Treiber.
 * Phase 0: Claim + Dispatch-Stub. Phase 1+ füllt die case-Bodies.
 */
export async function advanceRankingJob(_jobId?: string): Promise<string> {
  const supabase = createAdminClient()
  const { data: job, error } = await supabase
    .rpc('claim_ranking_job', { stale_before: staleBeforeIso(Date.now()) })
    .maybeSingle()
  if (error) { console.error('[RankingJobs] claim failed:', error); return 'claim_error' }
  // claim_ranking_job (RETURNS ranking_jobs) liefert bei kein-Match eine All-NULL-Row,
  // nicht 0 Zeilen → über job.id prüfen, sonst würde noop_phase statt no_job zurückkommen.
  if (!job || (job as RankingJob).id == null) return 'no_job'

  const j = job as RankingJob
  switch (j.phase) {
    case 'extract': {
      const startedAt = Date.now()
      const { extractProducts } = await import('@/lib/rankings/extract-products')
      const { resolveProduct } = await import('@/lib/rankings/resolve-product')
      const { mentionHash } = await import('@/lib/rankings/mention')
      const { looksAiProductRelevant } = await import('@/lib/rankings/prefilter')
      const { getModelForUseCase } = await import('@/lib/ai/model-config')
      const model = await getModelForUseCase('ranking_extract')
      const sinceIso = new Date(Date.now() - DAILY_WINDOW_DAYS * 86_400_000).toISOString()

      let processedAny = false
      let spentTokens = j.spend_tokens ?? 0 // kumulativ über alle Ticks dieses Jobs
      while (Date.now() - startedAt < EXTRACT_BUDGET_MS - EXTRACT_TAIL_MS) {
        let sel = supabase
          .from('daily_repo')
          .select('id, title, content, newsletter_date, product_processing_attempts')
          .is('processed_for_products_at', null)
          .or(`product_processing_attempts.is.null,product_processing_attempts.lt.${MAX_ITEM_ATTEMPTS}`)
          .order('newsletter_date', { ascending: false })
          .limit(EXTRACT_BATCH)
        if (j.mode === 'daily') sel = sel.gte('newsletter_date', sinceIso) // Daily: nur jüngstes Fenster
        const { data: items, error: selErr } = await sel
        if (selErr) throw new Error(`daily_repo fetch: ${selErr.message}`)
        if (!items || items.length === 0) {
          // 1b-i: KEIN Wechsel zu enrich (noop) → Job sauber abschließen, sonst Hänger.
          const { error: doneErr } = await supabase.from('ranking_jobs')
            .update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', j.id)
          if (doneErr) throw new Error(`job done: ${doneErr.message}`)
          return processedAny ? 'extract_done' : 'extract_empty'
        }
        for (const item of items) {
          try {
            if (looksAiProductRelevant(item.title ?? '', item.content ?? '')) {
              const res = await extractProducts(item.title ?? '', item.content ?? '')
              if (!res.ok) throw new Error(`extract: ${res.error}`) // retrybar: Item NICHT als verarbeitet markieren
              if (res.usage) spentTokens += res.usage.inputTokens + res.usage.outputTokens
              const seen = new Set<string>()
              for (const prod of res.products) {
                const { productId } = await resolveProduct({ vendor: prod.vendor, detectedName: prod.name, evidence: `daily_repo:${item.id}` })
                if (seen.has(productId)) continue // Dedup pro Item
                seen.add(productId)
                const { error: mErr } = await supabase.from('product_mentions').insert({
                  product_id: productId, daily_repo_id: item.id,
                  excerpt: (prod.excerpt ?? '').slice(0, 2000), excerpt_hash: mentionHash(productId),
                  mention_date: item.newsletter_date, model,
                })
                if (mErr && mErr.code !== '23505') throw new Error(`mention insert: ${mErr.message}`)
              }
              const { error: upErr } = await supabase.from('daily_repo').update({
                processed_for_products_at: new Date().toISOString(),
                processed_for_products_version: EXTRACT_VERSION,
                processed_for_products_model: model,
              }).eq('id', item.id)
              if (upErr) throw new Error(`processed update: ${upErr.message}`)
            } else {
              // Vorfilter: kein AI-Indikator → kein (teurer) LLM-Call, als verarbeitet
              // markieren (0 Produkte). model='prefilter-skip' macht Skips auswertbar.
              const { error: skErr } = await supabase.from('daily_repo').update({
                processed_for_products_at: new Date().toISOString(),
                processed_for_products_version: EXTRACT_VERSION,
                processed_for_products_model: 'prefilter-skip',
              }).eq('id', item.id)
              if (skErr) throw new Error(`prefilter skip update: ${skErr.message}`)
            }
            processedAny = true
          } catch (itemErr) {
            const msg = itemErr instanceof Error ? itemErr.message : String(itemErr)
            // Sichtbar machen (eine systematische extract-Störung wäre sonst unsichtbar)
            // und den attempts-Update prüfen, sonst kann ein DB-Teilausfall den
            // Poison-Counter still verschlucken → Item läuft jeden Tick erneut durchs LLM.
            console.error('[RankingJobs] extract item failed', item.id, msg)
            const { error: attErr } = await supabase.from('daily_repo').update({
              product_processing_attempts: (item.product_processing_attempts ?? 0) + 1,
              product_processing_error: msg.slice(0, 500),
            }).eq('id', item.id)
            if (attErr) console.error('[RankingJobs] attempts update failed', item.id, attErr.message)
          }
          await supabase.from('ranking_jobs').update({ last_advanced_at: new Date().toISOString(), spend_tokens: spentTokens }).eq('id', j.id)
          if (Date.now() - startedAt >= EXTRACT_BUDGET_MS - EXTRACT_TAIL_MS) break
        }
      }
      return 'extract_progress'
    }
    case 'enrich':
    case 'research':
    case 'aggregate':
    case 'assets':
    default:
      return 'noop_phase'   // Phase 1+ implementiert die Phasen-Bodies
  }
}

/** Status für die Admin-Anzeige: jüngster Daily-Job (inkl. spend_tokens) +
 *  Fortschritt im aktuellen Fenster + erzeugte Produkte/Mentions. */
export async function getRankingExtractStatus() {
  const supabase = createAdminClient()
  const since = new Date(Date.now() - DAILY_WINDOW_DAYS * 86_400_000).toISOString()
  const head = { count: 'exact' as const, head: true }

  const { data: job } = await supabase
    .from('ranking_jobs')
    .select('id, mode, phase, status, spend_tokens, run_date, last_advanced_at, error_message')
    .eq('mode', 'daily')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const [products, mentions, windowTotal, windowDone, skips] = await Promise.all([
    supabase.from('products').select('id', head),
    supabase.from('product_mentions').select('id', head),
    supabase.from('daily_repo').select('id', head).gte('newsletter_date', since),
    supabase.from('daily_repo').select('id', head).gte('newsletter_date', since).not('processed_for_products_at', 'is', null),
    supabase.from('daily_repo').select('id', head).gte('newsletter_date', since).eq('processed_for_products_model', 'prefilter-skip'),
  ])

  const windowTotalN = windowTotal.count ?? 0
  const windowDoneN = windowDone.count ?? 0
  return {
    job: job ?? null,
    windowDays: DAILY_WINDOW_DAYS,
    products: products.count ?? 0,
    mentions: mentions.count ?? 0,
    windowTotal: windowTotalN,
    windowDone: windowDoneN,
    windowRemaining: Math.max(0, windowTotalN - windowDoneN),
    prefilterSkips: skips.count ?? 0,
  }
}
