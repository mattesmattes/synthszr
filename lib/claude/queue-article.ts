/**
 * Queue-based article generation — the canonical orchestration shared by the
 * HTTP route (/api/ghostwriter-queue) and the scheduled cron auto-post.
 *
 * It selects news-queue items (manually-selected first, filled up from the
 * balanced selection), enriches their content, builds the vocabulary context,
 * runs the ghostwriter pipeline (plan → write → proofread) and de-duplicates
 * metaphors. It is an async generator that YIELDS the same SSE-style event
 * objects the route used to build inline:
 *   - { model, started, itemCount, sourceDistribution, pipeline }
 *   - { phase, message, progress? }            (progress, ignored by the cron)
 *   - { text }                                 (append to the article)
 *   - { clear }                                (reset the accumulator)
 *   - { done, model, queueItemIds, pipeline }  (final)
 *
 * Why a generator: the route pipes the events to an SSE stream for the live
 * editor; the cron collects them into the final markdown. ONE implementation
 * means the cron can never drift out of sync with the manual flow — the exact
 * failure that previously left the auto-post silently broken.
 *
 * Why in-process (not an HTTP subrequest from the cron): a fetch from the cron
 * to our own host fails — the cron's request host is the apex (307→www, which
 * drops the Authorization header) or the protected *.vercel.app deployment URL
 * (401 deployment protection), so the subrequest never reaches the route. Same
 * reason processNewsletters/processWebcrawl run in-process.
 *
 * Uses createAdminClient() for all reads so it works in both the request
 * context (route, with session) and the cron context (no session).
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { findDuplicateMetaphors, streamMetaphorDeduplication, type AIModel } from '@/lib/claude/ghostwriter'
import { runGhostwriterPipeline, type PipelineItem } from '@/lib/claude/ghostwriter-pipeline'
import { getBalancedSelection, getSelectedItems, selectItemsForArticle, deriveSourceUrl } from '@/lib/news-queue/service'
import { sanitizeUrl, sanitizeContentUrls } from '@/lib/utils/url-sanitizer'
import { getModelForUseCase } from '@/lib/ai/model-config'

export interface QueueArticleParams {
  queueItemIds?: string[]   // Specific items to use (optional)
  useSelected?: boolean     // Use manually selected items (status='selected'); default true
  maxItems?: number         // Max items if using/​filling balanced selection; default 25
  vocabularyIntensity?: number // 0–100; default 50
}

/** Loosely-typed event — all fields optional so both consumers read directly. */
export interface QueueArticleEvent {
  model?: string
  started?: boolean
  itemCount?: number
  sourceDistribution?: { source: string; count: number; percentage: number }[]
  pipeline?: boolean
  phase?: string
  message?: string
  progress?: { current: number; total: number }
  text?: string
  clear?: boolean
  done?: boolean
  queueItemIds?: string[]
}

export async function* generateQueueArticle(params: QueueArticleParams): AsyncGenerator<QueueArticleEvent> {
  const {
    queueItemIds,
    useSelected = true,
    maxItems = 25,
    vocabularyIntensity = 50,
  } = params

  // Model comes from central settings (admin/settings → KI-Modelle tab)
  const configModel = await getModelForUseCase('ghostwriter')
  const model = configModel as AIModel
  console.log(`[Ghostwriter-Queue] Model: ${model} (from settings), Items: ${queueItemIds?.length || 'auto-select'}, useSelected: ${useSelected}, maxItems: ${maxItems}`)

  const supabase = createAdminClient()

  // Get queue items - priority order:
  // 1. Specific IDs if provided
  // 2. Manually selected items (status='selected') if useSelected=true
  // 3. Balanced selection from pending items (fallback)
  let selectedItems: Array<{
    id: string
    daily_repo_id: string | null
    title: string
    content: string | null
    source_display_name: string | null
    source_url: string | null
    source_identifier: string
  }>

  if (queueItemIds && queueItemIds.length > 0) {
    // Use specified items
    const result = await selectItemsForArticle(queueItemIds)
    if (result.error) throw new Error(result.error)
    selectedItems = result.items
  } else if (useSelected) {
    // Use manually selected items (status='selected') + fill from balanced if needed
    const manuallySelected = await getSelectedItems()
    console.log(`[Ghostwriter-Queue] getSelectedItems returned ${manuallySelected.length} items (after filtering published)`)

    if (manuallySelected.length > 0) {
      console.log(`[Ghostwriter-Queue] Using ${manuallySelected.length} manually selected items (maxItems=${maxItems})`)
      // Cap manually selected items to maxItems
      selectedItems = manuallySelected.slice(0, maxItems)
      if (manuallySelected.length > maxItems) {
        console.log(`[Ghostwriter-Queue] Capped from ${manuallySelected.length} to ${maxItems} items`)
      }

      // Fill up with balanced items if selected < maxItems
      if (selectedItems.length < maxItems) {
        const neededCount = maxItems - manuallySelected.length
        console.log(`[Ghostwriter-Queue] Need ${neededCount} more items from balanced selection to reach ${maxItems}`)

        const balancedSelection = await getBalancedSelection(neededCount)
        console.log(`[Ghostwriter-Queue] getBalancedSelection(${neededCount}) returned ${balancedSelection.length} items`)

        if (balancedSelection.length > 0) {
          // Filter out items that are already in manuallySelected
          const selectedIds = new Set(manuallySelected.map(i => i.id))
          const additionalItems = balancedSelection.filter(s => !selectedIds.has(s.id))
          console.log(`[Ghostwriter-Queue] After filtering duplicates: ${additionalItems.length} additional items`)

          if (additionalItems.length > 0) {
            const itemIds = additionalItems.map(s => s.id)
            const result = await selectItemsForArticle(itemIds)
            console.log(`[Ghostwriter-Queue] selectItemsForArticle returned ${result.items.length} items (error: ${result.error || 'none'})`)

            if (!result.error && result.items.length > 0) {
              console.log(`[Ghostwriter-Queue] Added ${result.items.length} items from balanced selection`)
              selectedItems = [...manuallySelected, ...result.items]
            }
          }
        }
      } else {
        console.log(`[Ghostwriter-Queue] SKIPPED fill: manuallySelected (${manuallySelected.length}) >= maxItems (${maxItems})`)
      }

      console.log(`[Ghostwriter-Queue] Total items after fill: ${selectedItems.length}`)
    } else {
      // Fallback to balanced selection if no items manually selected
      console.log(`[Ghostwriter-Queue] No manually selected items (all filtered or none exist), using balanced selection for ${maxItems} items`)
      const balancedSelection = await getBalancedSelection(maxItems)
      console.log(`[Ghostwriter-Queue] getBalancedSelection(${maxItems}) returned ${balancedSelection.length} items`)

      if (balancedSelection.length === 0) {
        throw new Error('No items available in queue. Select items first or add items to the pending queue.')
      }

      const itemIds = balancedSelection.map(s => s.id)
      console.log(`[Ghostwriter-Queue] Calling selectItemsForArticle with ${itemIds.length} item IDs`)
      const result = await selectItemsForArticle(itemIds)
      console.log(`[Ghostwriter-Queue] selectItemsForArticle returned ${result.items.length} items (error: ${result.error || 'none'})`)

      if (result.error) throw new Error(result.error)

      selectedItems = result.items
      console.log(`[Ghostwriter-Queue] Final selected items count: ${selectedItems.length}`)
    }
  } else {
    // Use balanced selection from pending items
    const balancedSelection = await getBalancedSelection(maxItems)

    if (balancedSelection.length === 0) {
      throw new Error('No items available in queue')
    }

    const itemIds = balancedSelection.map(s => s.id)
    const result = await selectItemsForArticle(itemIds)

    if (result.error) throw new Error(result.error)

    selectedItems = result.items
  }

  console.log(`[Ghostwriter-Queue] Selected ${selectedItems.length} items from queue`)

  // Fetch full content from daily_repo for items that have daily_repo_id.
  // Queue items may not have content stored, so we fetch from source.
  const itemsWithDailyRepoId = selectedItems.filter(i => i.daily_repo_id)
  if (itemsWithDailyRepoId.length > 0) {
    const dailyRepoIds = itemsWithDailyRepoId.map(i => i.daily_repo_id as string)
    console.log(`[Ghostwriter-Queue] Fetching content for ${dailyRepoIds.length} items from daily_repo`)
    const { data: repoContent, error: repoError } = await supabase
      .from('daily_repo')
      .select('id, content, title')
      .in('id', dailyRepoIds)

    if (repoError) {
      console.error(`[Ghostwriter-Queue] Error fetching content:`, repoError)
    } else {
      console.log(`[Ghostwriter-Queue] Fetched content for ${repoContent?.length || 0} items`)
    }

    if (repoContent) {
      const contentMap = new Map(repoContent.map(r => [r.id, r.content]))
      selectedItems = selectedItems.map(item => {
        if (item.daily_repo_id && contentMap.has(item.daily_repo_id)) {
          return { ...item, content: contentMap.get(item.daily_repo_id) || item.content }
        }
        return item
      })
    }
  }

  // Log content status for each item
  for (const item of selectedItems) {
    const contentLength = item.content?.length || 0
    const preview = item.content?.slice(0, 50)?.replace(/\n/g, ' ') || 'NO CONTENT'
    console.log(`[Ghostwriter-Queue] Item "${item.title.slice(0, 30)}...": ${contentLength} chars, preview: "${preview}..."`)
  }

  console.log(`[Ghostwriter-Queue] Enriched ${selectedItems.length} items with content`)

  // Analyze source distribution for the selected items
  const sourceCount: Record<string, number> = {}
  for (const item of selectedItems) {
    sourceCount[item.source_identifier] = (sourceCount[item.source_identifier] || 0) + 1
  }

  const distribution = Object.entries(sourceCount)
    .map(([source, count]) => ({
      source,
      count,
      percentage: Math.round((count / selectedItems.length) * 100)
    }))
    .sort((a, b) => b.count - a.count)

  console.log(`[Ghostwriter-Queue] Source distribution:`, distribution)

  // Get vocabulary (used by both pipeline and dedup)
  const { data: vocabulary } = await supabase
    .from('vocabulary_dictionary')
    .select('term, preferred_usage, avoid_alternatives, context, category')
    .order('category')

  // Build vocabulary context
  let vocabularyContext = ''
  if (vocabulary && vocabulary.length > 0 && vocabularyIntensity > 0) {
    const intensity = Math.min(100, Math.max(0, vocabularyIntensity))
    vocabularyContext = `\n\nVOKABULAR-RICHTLINIEN (Intensität: ${intensity}%):\n`
    vocabularyContext += vocabulary.map(v => `- "${v.term}": ${v.preferred_usage || ''}`).join('\n')
  }

  // Track item IDs for marking as used
  const usedItemIds = selectedItems.map(i => i.id)

  const pipelineItems: PipelineItem[] = selectedItems.map(item => ({
    id: item.id,
    title: item.title,
    content: item.content ? sanitizeContentUrls(item.content) : null,
    source_display_name: item.source_display_name,
    source_url: sanitizeUrl(item.source_url) || deriveSourceUrl(null, item.source_identifier),
    source_identifier: item.source_identifier,
  }))

  console.log(`[Ghostwriter-Queue] Running pipeline with ${pipelineItems.length} items, model: ${model}`)

  yield { model, started: true, itemCount: selectedItems.length, sourceDistribution: distribution, pipeline: true }

  let fullText = ''

  for await (const event of runGhostwriterPipeline(pipelineItems, model, { vocabularyContext })) {
    if (event.type === 'planning') {
      yield { phase: 'pipeline', message: event.message }
    } else if (event.type === 'planned') {
      yield { phase: 'pipeline', message: `Struktur fertig. Schreibe ${event.itemCount} Abschnitte...` }
    } else if (event.type === 'writing') {
      yield { phase: 'pipeline', message: `Abschnitt ${event.current} von ${event.total}: ${event.title.slice(0, 60)}...`, progress: { current: event.current, total: event.total } }
    } else if (event.type === 'metadata' || event.type === 'section') {
      fullText += event.text
      yield { text: event.text }
    } else if (event.type === 'assembling') {
      yield { phase: 'pipeline', message: 'Artikel fertiggestellt.' }
    } else if (event.type === 'proofreading') {
      yield { phase: 'proofreading', message: event.message }
    } else if (event.type === 'proofread') {
      // Replace entire text with proofread version
      yield { clear: true }
      yield { text: event.text }
      fullText = event.text
    }
  }

  // Check for duplicate metaphors in assembled text
  const duplicates = findDuplicateMetaphors(fullText, vocabulary || undefined)
  if (duplicates.size > 0) {
    const duplicateList = Array.from(duplicates.entries())
      .map(([m, p]) => `${m} (${p.length}x)`)
      .join(', ')
    yield { phase: 'deduplication', message: `Prüfe auf wiederholte Metaphern: ${duplicateList}...` }
    yield { clear: true }
    for await (const chunk of streamMetaphorDeduplication(fullText, duplicates, model)) {
      yield { text: chunk }
    }
  }

  yield { done: true, model, queueItemIds: usedItemIds, pipeline: true }
}
