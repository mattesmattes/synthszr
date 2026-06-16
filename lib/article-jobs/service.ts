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
import { selectAndEnrichItems, buildVocabularyContext } from '@/lib/claude/queue-article'
import { getModelForUseCase } from '@/lib/ai/model-config'

type AdminClient = ReturnType<typeof createAdminClient>

/** Per-section reasoning effort — must match queue-article / ghostwriter-pipeline. */
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Stored job row (jsonb columns arrive loosely-typed from Supabase). */
interface ArticleJob {
  id: string
  digest_id: string
  status: string
  phase: string | null
  model: string
  effort: Effort
  max_items: number
  vocabulary_intensity: number
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
  const { pipelineItems, usedItemIds } = await selectAndEnrichItems({ maxItems: opts.maxItems })
  if (pipelineItems.length === 0) return { created: false, reason: 'no_items' }

  const { error } = await supabase.from('article_jobs').insert({
    digest_id: opts.digestId,
    status: 'pending',
    phase: 'planning',
    model: opts.model,
    effort: opts.effort,
    max_items: opts.maxItems,
    vocabulary_intensity: opts.vocabularyIntensity,
    selected_items: pipelineItems,
    used_item_ids: usedItemIds,
  })
  if (error) return { created: false, reason: `insert_failed: ${error.message}` }

  return { created: true }
}

/** Oldest open (pending|processing) job, or null. */
export async function getNextOpenJob(): Promise<ArticleJob | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('article_jobs')
    .select('*')
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as ArticleJob | null) ?? null
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
 * Inserts the assembled markdown as a draft generated_post. Mirrors the manual
 * saveAsDraft flow (parse frontmatter → markdown→TipTap → URL sanitize).
 * Returns the new post id.
 */
async function persistDraftPost(supabase: AdminClient, job: ArticleJob, fullMarkdown: string): Promise<string> {
  const { parseArticleContent, generateSlug } = await import('@/lib/utils/parse-article-content')
  const { markdownToTiptap } = await import('@/lib/utils/markdown-to-tiptap')
  const { sanitizeTiptapUrls } = await import('@/lib/utils/url-verifier')

  const { metadata, body } = parseArticleContent(fullMarkdown)
  const title = metadata.title || `Artikel`

  let tiptap = markdownToTiptap(body)
  const { content, changes } = sanitizeTiptapUrls(tiptap)
  if (changes.length) tiptap = content as typeof tiptap

  const { data: newPost, error } = await supabase
    .from('generated_posts')
    .insert({
      digest_id: job.digest_id,
      title,
      slug: metadata.slug || generateSlug(title),
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
export async function advanceArticleJob(): Promise<string> {
  const supabase = createAdminClient()
  const job = await getNextOpenJob()
  if (!job) return 'no_job'

  if (job.attempts >= job.max_attempts) {
    await markJobError(job.id, 'max_attempts exceeded')
    return 'error_max_attempts'
  }

  const startedAt = Date.now()
  await supabase
    .from('article_jobs')
    .update({
      status: 'processing',
      attempts: job.attempts + 1,
      started_at: job.started_at ?? new Date().toISOString(),
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
      const plan = job.plan
      if (!plan) {
        await markJobError(job.id, 'writing phase without plan')
        return 'error_no_plan'
      }
      const orderedItems = plan.ordering
        .map((idx: number) => job.selected_items[idx - 1])
        .filter(Boolean) as PipelineItem[]
      const { vocabularyContext } = await buildVocabularyContext(job.vocabulary_intensity)
      const ctx = await buildSectionContext(job.selected_items, plan, vocabularyContext)
      const res = await writeSectionsBatch(
        orderedItems,
        plan,
        ctx,
        job.cursor,
        job.model as AIModel,
        job.effort,
        210_000,
        startedAt,
      )
      const written = [...(job.written_sections ?? []), ...res.sections]
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
      const plan = job.plan
      if (!plan) {
        await markJobError(job.id, 'finalizing phase without plan')
        return 'error_no_plan'
      }
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
    console.error('[ArticleJobs] advance error:', err)
    return 'tick_error'
  }
}
