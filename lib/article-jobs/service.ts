/**
 * Article-Job service — the resumable state machine that turns a daily digest
 * into a draft post over multiple 15-min cron ticks (instead of one inline
 * 300s function call).
 *
 * Lifecycle (one phase per cron tick, state persisted in `article_jobs`):
 *   planning → writing(×n) → finalizing → done
 *
 * The 05:30 cron enqueues a job (createArticleJob); every tick advances the
 * oldest open job by exactly ONE phase (advanceArticleJob) and persists the
 * result, so a crash/timeout resumes from the stored cursor on the next tick.
 *
 * Selection/vocabulary are shared with the manual /api/ghostwriter-queue flow
 * (selectAndEnrichItems / buildVocabularyContext in queue-article.ts) so the
 * two paths can never drift. Everything runs via createAdminClient() — this is
 * cron context with no session.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { type AIModel } from '@/lib/claude/ghostwriter'
import {
  planArticle,
  buildSectionContext,
  writeSectionsBatch,
  finalizeArticle,
  type ArticlePlan,
  type PipelineItem,
} from '@/lib/claude/ghostwriter-pipeline'
import { selectAndEnrichItems, buildVocabularyContext, toPipelineItem } from '@/lib/claude/queue-article'
import { normalizeArticlePlan } from '@/lib/claude/normalize-plan'
import { getModelForUseCase } from '@/lib/ai/model-config'

// Re-exported so both job-creation paths below (and their tests) reach the
// ONE NewsQueueItem→PipelineItem conversion via lib/claude/queue-article.ts.
export { toPipelineItem }

type AdminClient = ReturnType<typeof createAdminClient>

/** Per-section reasoning effort — must match queue-article / ghostwriter-pipeline. */
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Stored job row (jsonb columns arrive loosely-typed from Supabase). */
interface ArticleJob {
  id: string
  digest_id: string | null
  source: string
  status: string
  phase: string | null
  model: string
  effort: Effort
  max_items: number
  vocabulary_intensity: number
  repo_intensity: number
  selected_items: PipelineItem[]
  used_item_ids: string[]
  plan: ArticlePlan | null
  written_sections: string[]
  cursor: number
  attempts: number
  max_attempts: number
  started_at: string | null
}

/**
 * Mirrors markTaskRun from app/api/cron/scheduled-tasks/route.ts — duplicated
 * locally (not imported from the route) so the service stays standalone.
 */
async function markTaskRun(supabase: AdminClient, taskKey: string) {
  const { error } = await supabase
    .from('settings')
    .upsert({
      key: `last_run_${taskKey}`,
      value: { timestamp: new Date().toISOString() },
    }, { onConflict: 'key' })
  if (error) {
    console.error(`[ArticleJobs] markTaskRun failed for ${taskKey}:`, error)
  }
}

/**
 * Enqueues an article job for a digest. Idempotent: no-op when a post or a
 * non-error job already exists for the digest, or when no items are available.
 */
export async function createArticleJob(opts: {
  digestId: string
  maxItems: number
  model: string
  effort: string
  vocabularyIntensity: number
  repoIntensity: number
}): Promise<{ created: boolean; reason?: string }> {
  const supabase = createAdminClient()

  // Idempotency: a post or a non-error job for this digest already exists?
  const { data: existingPost } = await supabase
    .from('generated_posts')
    .select('id')
    .eq('digest_id', opts.digestId)
    .maybeSingle()
  if (existingPost) return { created: false, reason: 'post_exists' }

  const { data: existingJob } = await supabase
    .from('article_jobs')
    .select('id')
    .eq('digest_id', opts.digestId)
    .neq('status', 'error')
    .maybeSingle()
  if (existingJob) return { created: false, reason: 'job_exists' }

  // Select + enrich items (shared helper — same selection as the manual flow)
  const { pipelineItems, usedItemIds } = await selectAndEnrichItems({ maxItems: opts.maxItems, dedupeTopics: true })
  if (pipelineItems.length === 0) return { created: false, reason: 'no_items' }

  const { error } = await supabase.from('article_jobs').insert({
    digest_id: opts.digestId,
    status: 'pending',
    phase: 'planning',
    model: opts.model,
    effort: opts.effort,
    max_items: opts.maxItems,
    vocabulary_intensity: opts.vocabularyIntensity,
    repo_intensity: opts.repoIntensity,
    selected_items: pipelineItems,
    used_item_ids: usedItemIds,
  })
  if (error) return { created: false, reason: `insert_failed: ${error.message}` }

  return { created: true }
}

/**
 * Enqueues a MANUAL article job (admin "AI Artikel generieren" button). Unlike
 * the auto path this has no digest (source='manual', digest_id=null), uses the
 * human's exact selection (no topic-dedup), and is driven by the browser polling
 * advanceArticleJob(jobId) — the 15-min cron only picks it up as a fallback.
 * Returns the new job id so the client can drive + poll it.
 */
export async function createManualArticleJob(opts: {
  queueItemIds?: string[]
  useSelected?: boolean
  maxItems: number
  model: string
  effort: string
  vocabularyIntensity: number
  repoIntensity: number
}): Promise<{ jobId: string; itemCount: number } | { error: string }> {
  const supabase = createAdminClient()

  const { pipelineItems, usedItemIds } = await selectAndEnrichItems({
    queueItemIds: opts.queueItemIds,
    useSelected: opts.useSelected ?? true,
    maxItems: opts.maxItems,
  })
  if (pipelineItems.length === 0) return { error: 'no_items' }

  const { data, error } = await supabase
    .from('article_jobs')
    .insert({
      digest_id: null,
      source: 'manual',
      status: 'pending',
      phase: 'planning',
      model: opts.model,
      effort: opts.effort,
      max_items: opts.maxItems,
      vocabulary_intensity: opts.vocabularyIntensity,
      repo_intensity: opts.repoIntensity,
      selected_items: pipelineItems,
      used_item_ids: usedItemIds,
    })
    .select('id')
    .single()
  if (error) return { error: `insert_failed: ${error.message}` }

  return { jobId: data.id, itemCount: pipelineItems.length }
}

/** A job counts as browser-driven (and off-limits to the cron) if it was
 *  advanced within this window. Longer than any single advance (≤300s) + poll
 *  gap, so an in-flight phase never looks idle. */
const LEASE_STALE_MS = 6 * 60 * 1000

/**
 * Oldest open (pending|processing) job the cron may advance — EXCLUDING jobs a
 * browser is actively driving (last_advanced_at within LEASE_STALE_MS). Without
 * this the cron raced the manual browser polling on the same row (double work,
 * inconsistent phase, undefined-field crashes). Tab closed → stamp goes stale →
 * the job becomes eligible here and the cron resumes it as a fallback.
 */
export async function getNextOpenJob(): Promise<ArticleJob | null> {
  const supabase = createAdminClient()
  const staleBefore = new Date(Date.now() - LEASE_STALE_MS).toISOString()
  const { data } = await supabase
    .from('article_jobs')
    .select('*')
    .in('status', ['pending', 'processing'])
    .or(`last_advanced_at.is.null,last_advanced_at.lt.${staleBefore}`)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as ArticleJob | null) ?? null
}

/** A specific job by id (for browser-driven manual advance + status polling). */
async function getJobById(id: string): Promise<ArticleJob | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('article_jobs').select('*').eq('id', id).maybeSingle()
  return (data as ArticleJob | null) ?? null
}

/**
 * Lightweight status for client polling: phase, progress, and the resulting
 * draft id once done. `total` is the section count, `cursor` how many are written.
 */
export async function getArticleJobStatus(jobId: string): Promise<{
  status: string
  phase: string | null
  cursor: number
  total: number
  generatedPostId: string | null
  error: string | null
} | null> {
  const job = await getJobById(jobId)
  if (!job) return null
  const supabase = createAdminClient()
  const { data: row } = await supabase
    .from('article_jobs')
    .select('generated_post_id')
    .eq('id', jobId)
    .maybeSingle()
  return {
    status: job.status,
    phase: job.phase,
    cursor: job.cursor ?? 0,
    total: job.selected_items?.length ?? 0,
    generatedPostId: (row?.generated_post_id as string | null) ?? null,
    error: job.status === 'error' ? (job as unknown as { error_message?: string }).error_message ?? 'unknown' : null,
  }
}

/** Marks a job as permanently failed. */
export async function markJobError(id: string, message: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('article_jobs')
    .update({
      status: 'error',
      error_message: message.slice(0, 500),
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
}

/**
 * Server-safe markdown → TipTap JSON.
 *
 * @tiptap's generateJSON() calls elementFromString(), which hard-throws
 * "[tiptap error]: there is no window object". markdown-to-tiptap.ts is also
 * imported by the client (create-article), so Turbopack dead-code-eliminates the
 * runtime `typeof window` guard in the server chunk — a global jsdom shim does
 * NOT help there. We therefore bypass elementFromString entirely: build the HTML
 * with marked, parse it with a jsdom DOM + prosemirror's DOMParser, using the
 * SAME extension schema (via getSchema) as markdownToTiptap. getSchema and
 * prosemirror DOMParser don't touch `window`, so this works in the cron.
 *
 * Marker handling mirrors markdownToTiptap (lib/utils/markdown-to-tiptap.ts):
 * `<!-- data-bundle-type:X -->` on a heading line is stripped before marked()
 * runs (HTML comments don't survive DOM parsing) and re-applied as a
 * `bundleType` attr on the matching heading node afterwards — reusing the
 * same extract/apply helpers since both paths produce an equivalent TipTap
 * JSON tree, just via different parsers.
 */
async function markdownToTiptapServer(markdown: string): Promise<Record<string, unknown>> {
  const { marked } = await import('marked')
  const { getSchema } = await import('@tiptap/core')
  const { DOMParser: PMDOMParser } = await import('@tiptap/pm/model')
  const StarterKit = (await import('@tiptap/starter-kit')).default
  const Link = (await import('@tiptap/extension-link')).default
  const { HeadingWithQueueId } = await import('@/lib/tiptap/heading-with-queue-id')
  const { normalizeQuotes } = await import('@/lib/utils/typography')
  const { JSDOM } = await import('jsdom')
  const { extractBundleMarkers, applyBundleMarkers } = await import('@/lib/utils/markdown-to-tiptap')

  const { cleaned, markers } = extractBundleMarkers(normalizeQuotes(markdown, 'de'))
  const html = marked.parse(cleaned, { async: false }) as string
  const schema = getSchema([
    StarterKit.configure({ heading: false }),
    HeadingWithQueueId.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    Link.configure({ openOnClick: false }),
  ])
  const dom = new JSDOM(`<body>${html}</body>`)
  const json = PMDOMParser.fromSchema(schema).parse(dom.window.document.body).toJSON() as Record<string, unknown>
  applyBundleMarkers(json, markers)
  return json
}

/**
 * Inserts the assembled markdown as a draft generated_post. Mirrors the manual
 * saveAsDraft flow (parse frontmatter → markdown→TipTap → URL sanitize).
 * Returns the new post id.
 */
async function persistDraftPost(supabase: AdminClient, job: ArticleJob, fullMarkdown: string): Promise<string> {
  const { parseArticleContent, generateSlug } = await import('@/lib/utils/parse-article-content')
  const { sanitizeTiptapUrls } = await import('@/lib/utils/url-verifier')
  const { buildUniqueSlug } = await import('@/lib/article-jobs/unique-slug')

  // Idempotency: a previous finalize tick may have inserted the draft and then
  // timed out before persisting status=done, leaving the job 'processing'. On the
  // next tick we'd otherwise insert a SECOND draft and collide on the unique slug.
  // Reuse the existing draft for this digest instead of re-inserting.
  const { data: existingDraft } = await supabase
    .from('generated_posts')
    .select('id')
    .eq('digest_id', job.digest_id)
    .eq('status', 'draft')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (existingDraft) {
    console.log(`[ArticleJobs] persistDraftPost: draft for digest already exists (${existingDraft.id}), reusing`)
    return existingDraft.id
  }

  const { metadata, body } = parseArticleContent(fullMarkdown)
  const title = metadata.title || `Artikel`

  let tiptap = await markdownToTiptapServer(body)

  // Embed queue item IDs into H2 headings for stable thumbnail matching (mirrors
  // the manual saveAsDraft flow). Best-effort — failure must not block the draft.
  if (job.used_item_ids?.length) {
    try {
      const { embedQueueItemIds } = await import('@/lib/utils/embed-queue-ids')
      const { data: queueItems } = await supabase
        .from('news_queue')
        .select('id, title, content')
        .in('id', job.used_item_ids)
      if (queueItems?.length) tiptap = embedQueueItemIds(tiptap, queueItems)
    } catch (err) {
      console.error('[ArticleJobs] embedQueueItemIds failed (non-fatal):', err)
    }
  }

  const { content, changes } = sanitizeTiptapUrls(tiptap)
  if (changes.length) tiptap = content as Record<string, unknown>

  // Unique slug: generateSlug is deterministic, so a duplicate/near-identical
  // title would violate idx_generated_posts_slug_unique and fail the insert.
  const slug = await buildUniqueSlug(
    metadata.slug || generateSlug(title),
    async (s) => {
      const { data } = await supabase.from('generated_posts').select('id').eq('slug', s).maybeSingle()
      return !!data
    },
  )

  const { data: newPost, error } = await supabase
    .from('generated_posts')
    .insert({
      digest_id: job.digest_id,
      title,
      slug,
      excerpt: metadata.excerpt || null,
      category: metadata.category || 'AI & Tech',
      content: JSON.stringify(tiptap),
      word_count: body.split(/\s+/).length,
      status: 'draft',
      ai_model: job.model,
      pending_queue_item_ids: job.used_item_ids?.length ? job.used_item_ids : [],
    })
    .select('id')
    .single()

  if (error) throw new Error(`insert failed: ${error.message}`)
  return newPost.id
}

/**
 * Advances the oldest open job by exactly ONE phase and persists the result.
 * Returns a short status string. Tick-level errors leave the job 'processing'
 * (resumes next tick); only attempts ≥ max_attempts trips it into 'error'.
 */
export async function advanceArticleJob(jobId?: string): Promise<string> {
  const supabase = createAdminClient()
  // With jobId the browser drives one specific (manual) job; without it the cron
  // advances the oldest open job — covers auto-posts and stalled manual jobs.
  const job = jobId ? await getJobById(jobId) : await getNextOpenJob()
  if (!job) return 'no_job'
  if (job.status !== 'pending' && job.status !== 'processing') return job.status

  if (job.attempts >= job.max_attempts) {
    await markJobError(job.id, 'max_attempts exceeded')
    return 'error_max_attempts'
  }

  const startedAt = Date.now()
  // last_advanced_at = lease stamp: marks the job as actively driven so the cron
  // (getNextOpenJob) won't grab it from under a polling browser.
  await supabase
    .from('article_jobs')
    .update({
      status: 'processing',
      attempts: job.attempts + 1,
      started_at: job.started_at ?? new Date().toISOString(),
      last_advanced_at: new Date().toISOString(),
    })
    .eq('id', job.id)

  try {
    if (job.phase === 'planning') {
      const planningModel = (await getModelForUseCase('article_planning')) as AIModel
      const plan = await planArticle(job.selected_items, planningModel)
      await supabase
        .from('article_jobs')
        .update({ plan, phase: 'writing', cursor: 0 })
        .eq('id', job.id)
      return 'planned'
    }

    if (job.phase === 'writing') {
      if (!job.plan) {
        await markJobError(job.id, 'writing phase without plan')
        return 'error_no_plan'
      }
      // Heal a drifted/malformed plan (e.g. ordering as objects, missing
      // headings map) that may already be persisted from the planning phase.
      const plan = normalizeArticlePlan(job.plan, job.selected_items.length)
      const orderedItems = plan.ordering
        .map((idx: number) => job.selected_items[idx - 1])
        .filter(Boolean) as PipelineItem[]
      const { vocabularyContext } = await buildVocabularyContext(job.vocabulary_intensity)
      const ctx = await buildSectionContext(job.selected_items, plan, vocabularyContext)
      // Proofread runs per-section here (resumable) instead of one full-article
      // proofread in finalize that exceeded the 300s limit on long articles.
      const proofreadModel = (await getModelForUseCase('proofreading')) as AIModel
      const prevWritten = job.written_sections ?? []
      const res = await writeSectionsBatch(
        orderedItems,
        plan,
        ctx,
        job.cursor,
        job.model as AIModel,
        job.effort,
        150_000,
        startedAt,
        proofreadModel,
        // Persist after each batch → the client's status poll shows live progress.
        async (nextCursor, newSections) => {
          await supabase
            .from('article_jobs')
            .update({ written_sections: [...prevWritten, ...newSections], cursor: nextCursor })
            .eq('id', job.id)
        },
        job.repo_intensity,
      )
      const written = [...prevWritten, ...res.sections]
      await supabase
        .from('article_jobs')
        .update({
          written_sections: written,
          cursor: res.nextCursor,
          phase: res.done ? 'finalizing' : 'writing',
        })
        .eq('id', job.id)
      return res.done ? 'writing_done' : 'writing_progress'
    }

    if (job.phase === 'finalizing') {
      if (!job.plan) {
        await markJobError(job.id, 'finalizing phase without plan')
        return 'error_no_plan'
      }
      const plan = normalizeArticlePlan(job.plan, job.selected_items.length)
      const { vocabulary } = await buildVocabularyContext(job.vocabulary_intensity)
      // Only metadataBlock is needed here; vocabularyContext is irrelevant for finalize.
      const ctx = await buildSectionContext(job.selected_items, plan, undefined)
      const fullMarkdown = await finalizeArticle(
        ctx.metadataBlock,
        job.written_sections ?? [],
        job.model as AIModel,
        vocabulary,
      )
      const postId = await persistDraftPost(supabase, job, fullMarkdown)
      await markTaskRun(supabase, 'post_generation')
      await supabase
        .from('article_jobs')
        .update({
          status: 'done',
          phase: null,
          generated_post_id: postId,
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      return 'finalized'
    }

    return 'unknown_phase'
  } catch (err) {
    // Tick error: leave the job 'processing' so the next tick resumes from the
    // stored cursor. attempts (incremented above) guards against an infinite
    // loop — the max_attempts check at the top eventually trips it to 'error'.
    // Persist the message (status stays 'processing') for debuggability.
    const msg = err instanceof Error ? (err.stack || err.message) : String(err)
    console.error('[ArticleJobs] advance error:', err)
    await supabase.from('article_jobs').update({ error_message: msg.slice(0, 1000) }).eq('id', job.id)
    return 'tick_error'
  }
}
