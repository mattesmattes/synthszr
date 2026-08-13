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
import { isLikelyTruncated } from '@/lib/claude/rewrite-truncation'
import { getBalancedSelection, getSelectedItems, selectItemsForArticle, deriveSourceUrl } from '@/lib/news-queue/service'
import { sanitizeUrl, sanitizeContentUrls } from '@/lib/utils/url-sanitizer'
import { getModelForUseCase } from '@/lib/ai/model-config'
import type { BundleType } from '@/lib/i18n/bundle-labels'

export interface QueueArticleParams {
  queueItemIds?: string[]   // Specific items to use (optional)
  useSelected?: boolean     // Use manually selected items (status='selected'); default true
  maxItems?: number         // Max items if using/​filling balanced selection; default 25
  vocabularyIntensity?: number // 0–100; default 50
  model?: string            // Override the ghostwriter model; defaults to the
                            // 'ghostwriter' use-case (Opus).
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' // Per-section reasoning
                            // effort. The scheduled auto-post passes 'medium'
                            // (faster) so 40 items fit the 300s cron cap; the
                            // manual flow leaves it at the default ('high').
  repoIntensity?: number    // 0–100; default 40. Steuert das Code-Crash-Korpus-Retrieval.
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

/**
 * Maps a raw news_queue row to the PipelineItem shape the ghostwriter pipeline
 * consumes. The ONE conversion site — also re-exported from
 * lib/article-jobs/service.ts so both job-creation paths (auto + manual) go
 * through the same mapping (no drift).
 */
/**
 * Gebündelte von gewöhnlichen Meldungen trennen.
 *
 * Gebündelte Quellen sind ABSICHTLICH mehrfach dasselbe Thema. Jede Regel, die
 * Ähnlichkeit bestraft oder nach Stückzahl kappt, muss sie deshalb gesondert
 * behandeln.
 */
export function splitBundled<T extends { bundle_type?: string | null }>(
  items: T[],
): { bundled: T[]; single: T[] } {
  const bundled: T[] = []
  const single: T[] = []
  for (const item of items) {
    if (item.bundle_type) bundled.push(item)
    else single.push(item)
  }
  return { bundled, single }
}

/**
 * Wie viele Quellen ein gebündelter Abschnitt höchstens verarbeitet.
 *
 * BETREIBER-VORGABE 2026-08-13: „damit die Bündel-Artikel nicht total ausfransen
 * mit sehr vielen Sourcen". Techmeme listet zu großen Meldungen bis zu 41
 * Publikationen; ein Leitartikel aus zwölf Quellen zerfasert, ohne mehr zu
 * sagen — die zwölfte Meldung wiederholt meist die erste.
 *
 * Die Auswahl trifft die Punktzahl, in der Techmemes eigener Rang bereits
 * steckt: Es bleiben die Quellen, die Techmeme vorn platziert hat.
 *
 * In der QUEUE bleiben alle zehn Quellen stehen — die Grenze gilt nur für die
 * Artikel-Erzeugung, damit die Auswahl von Hand weiterhin möglich ist.
 */
export const BUNDLE_SOURCES_MAX = 5

/**
 * Auf `maxUnits` ABSCHNITTE kappen — nicht auf Items.
 *
 * BEFUND 2026-08-13: Nach dem Techmeme-Umbau standen 48 gebündelte Quellen zu
 * fünf Themen zur Auswahl. `slice(0, 25)` hätte sie nach Punktzahl
 * durchgeschnitten: ein Thema mit 8 von 12 Quellen, das schwächste ganz weg.
 *
 * Der Denkfehler war die Einheit. `maxItems` begrenzt, wie viele ABSCHNITTE ein
 * Artikel bekommt — und ein Bündel ist EIN Abschnitt, ganz gleich ob es aus drei
 * oder zwölf Quellen entsteht.
 *
 * Bündel kommen zuerst und immer VOLLSTÄNDIG: Sie sind die gesetzten Themen des
 * Tages, Einzelmeldungen füllen den Rest nach Punktzahl auf.
 */
export function capByUnits<T extends { total_score?: number; bundle_type?: string | null; metadata?: Record<string, unknown> | null }>(
  items: T[],
  maxUnits: number,
): T[] {
  const { bundled, single } = splitBundled(items)

  // Je (Typ, Story) ein Bündel — dieselbe Aufteilung wie in der Schreibphase
  // (computeBundleUnits). Ohne Story-Schlüssel bildet der Typ die Gruppe.
  const gruppen = new Map<string, T[]>()
  for (const item of bundled) {
    const story = item.metadata?.techmeme_story
    const key = `${item.bundle_type}::${typeof story === 'string' ? story : ''}`
    const vorhanden = gruppen.get(key)
    if (vorhanden) vorhanden.push(item)
    else gruppen.set(key, [item])
  }

  const out: T[] = []
  let einheiten = 0
  for (const gruppe of gruppen.values()) {
    if (einheiten >= maxUnits) break
    // Je Bündel die BESTEN Quellen — nicht die ersten. Die Punktzahl trägt
    // Techmemes Rang in sich, es bleiben also die vorn platzierten.
    const beste = [...gruppe]
      .sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0))
      .slice(0, BUNDLE_SOURCES_MAX)
    out.push(...beste)
    einheiten++
  }

  for (const item of [...single].sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0))) {
    if (einheiten >= maxUnits) break
    out.push(item)
    einheiten++
  }
  return out
}

export function toPipelineItem(item: {
  id: string
  title: string
  content: string | null
  source_display_name: string | null
  source_url: string | null
  source_identifier: string
  bundle_type?: BundleType | null
  metadata?: Record<string, unknown> | null
}): PipelineItem {
  return {
    id: item.id,
    title: item.title,
    content: item.content ? sanitizeContentUrls(item.content) : null,
    source_display_name: item.source_display_name,
    source_url: sanitizeUrl(item.source_url) || deriveSourceUrl(null, item.source_identifier),
    source_identifier: item.source_identifier,
    bundle_type: item.bundle_type ?? null,
    bundle_key: bundleKeyOf(item.metadata),
  }
}

/**
 * Woran erkennt die Pipeline, dass zwei gebündelte News DASSELBE Thema
 * behandeln?
 *
 * An der Techmeme-Story. Sie steht bereits in den Metadaten — ein eigenes Feld
 * daneben könnte davon abweichen und wäre eine zweite Wahrheit über dieselbe
 * Sache.
 *
 * Ohne Schlüssel (händisch markierte News) bleibt es beim bisherigen Verhalten:
 * alle Items eines Typs bilden EIN Bündel.
 */
export function bundleKeyOf(metadata: Record<string, unknown> | null | undefined): string | null {
  const key = metadata?.techmeme_story
  return typeof key === 'string' && key.length > 0 ? key : null
}

/**
 * Selects news-queue items (specific IDs → manually-selected → balanced fill),
 * enriches them with full daily_repo content, and maps them to PipelineItems.
 *
 * Extracted from generateQueueArticle so the resumable article-job path and the
 * manual /api/ghostwriter-queue flow share ONE selection/enrichment — no drift.
 */
export async function selectAndEnrichItems(opts: {
  queueItemIds?: string[]
  useSelected?: boolean
  maxItems?: number
  dedupeTopics?: boolean   // Drop same-event-different-source near-duplicates
                           // (semantic embedding dedup). Used by the unattended
                           // auto-post; the manual flow leaves it off.
}): Promise<{
  pipelineItems: PipelineItem[]
  usedItemIds: string[]
  sourceDistribution: { source: string; count: number; percentage: number }[]
}> {
  const { queueItemIds, useSelected = true, maxItems = 25, dedupeTopics = false } = opts

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
    bundle_type?: BundleType | null
    // Trägt die Techmeme-Story, aus der bundleKeyOf den Gruppierungsschlüssel
    // liest — ohne sie fielen fünf Themen wieder zu einem Abschnitt zusammen.
    metadata?: Record<string, unknown> | null
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
      // Auf maxItems ABSCHNITTE kappen, nicht auf Items: Ein Bündel ist EIN
      // Abschnitt, ganz gleich ob es aus drei oder zwölf Quellen entsteht. Ein
      // schlichtes slice() schnitte mitten durch die Themen des Tages.
      selectedItems = capByUnits(manuallySelected, maxItems)
      if (selectedItems.length < manuallySelected.length) {
        console.log(`[Ghostwriter-Queue] Capped from ${manuallySelected.length} to ${selectedItems.length} items (${maxItems} Abschnitte)`)
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

  // Semantic topic dedup (auto-post path only): the same news event is reported
  // by several sources with completely different headlines, which the title-bigram
  // dedup in the synthesis pipeline misses. Embedding cosine similarity catches
  // them; we keep the highest-scored item per topic. Skipped for explicit
  // queueItemIds (a deliberate exact set chosen by a human). Best-effort — a
  // failure inside dedupeByTopic returns the input unchanged.
  if (dedupeTopics && !queueItemIds?.length && selectedItems.length > 1) {
    const { dedupeByTopic } = await import('@/lib/news-queue/semantic-dedup')
    // GEBÜNDELTE QUELLEN BLEIBEN AUSSEN VOR. Der Dedup verwirft Meldungen mit
    // Ähnlichkeit ≥ 0,8 — und zwölf Quellen zur selben Meldung sind maximal
    // ähnlich. Ohne diese Trennung überlebte von jedem Thema des Tages GENAU
    // EINE Quelle, und die Bündelung wäre wirkungslos. Im Log stünde dazu nur
    // „dropped 43 items (batch-dupe)": kein Fehler, nur ein leiser Verlust.
    const { bundled: gebuendelt, single: einzeln } = splitBundled(selectedItems)
    const { kept, dropped } = await dedupeByTopic(
      einzeln.map(i => ({
        id: i.id,
        title: i.title,
        content: i.content,
        source_identifier: i.source_identifier,
        total_score: (i as { total_score?: number }).total_score,
      })),
      // Also drop news already covered in posts published in the last 3 days.
      { recentCoverageDays: 3 }
    )
    if (dropped.length > 0) {
      const batchN = dropped.filter(d => d.reason === 'batch').length
      const coverN = dropped.filter(d => d.reason === 'recent_coverage').length
      console.log(`[Ghostwriter-Queue] Semantic dedup: dropped ${dropped.length} items (${batchN} batch-dupe, ${coverN} already-covered), ${kept.length} unique remain`)
      for (const d of dropped) {
        console.log(`[Ghostwriter-Queue]   drop[${d.reason}] "${d.title.slice(0, 50)}" (sim=${d.similarity.toFixed(2)} → ${d.similarTo})`)
      }
      const keptIds = new Set(kept.map(k => k.id))
      // Nur aus den EINZELMELDUNGEN: Die gebündelten waren nie Teil der
      // Prüfung, sie hier als verworfen zu behandeln setzte die Themen des
      // Tages auf 'pending' zurück.
      const droppedIds = einzeln.filter(i => !keptIds.has(i.id)).map(i => i.id)
      // Release dropped items back to 'pending' — selectItemsForArticle already
      // marked them 'selected'; leaving them stuck would hide them for 24h.
      await supabase
        .from('news_queue')
        .update({ status: 'pending', selected_at: null })
        .in('id', droppedIds)
      // Auf die behaltenen reduzieren — die gebündelten unangetastet davor.
      const byId = new Map(einzeln.map(i => [i.id, i]))
      selectedItems = [
        ...gebuendelt,
        ...kept.map(k => byId.get(k.id)).filter(Boolean),
      ] as typeof selectedItems
    }
  }

  // Analyze source distribution for the selected items
  const sourceCount: Record<string, number> = {}
  for (const item of selectedItems) {
    sourceCount[item.source_identifier] = (sourceCount[item.source_identifier] || 0) + 1
  }

  const sourceDistribution = Object.entries(sourceCount)
    .map(([source, count]) => ({
      source,
      count,
      percentage: Math.round((count / selectedItems.length) * 100)
    }))
    .sort((a, b) => b.count - a.count)

  console.log(`[Ghostwriter-Queue] Source distribution:`, sourceDistribution)

  // Track item IDs for marking as used
  const usedItemIds = selectedItems.map(i => i.id)

  const pipelineItems: PipelineItem[] = selectedItems.map(toPipelineItem)

  return { pipelineItems, usedItemIds, sourceDistribution }
}

/**
 * Fetches the vocabulary dictionary and builds the vocabulary-guidelines block.
 * Returns the prompt context plus the (slim) vocabulary list used by metaphor
 * de-duplication. Extracted from generateQueueArticle for the article-job path.
 */
export async function buildVocabularyContext(vocabularyIntensity: number): Promise<{
  vocabularyContext: string
  vocabulary: Array<{ term: string }> | null
}> {
  const supabase = createAdminClient()

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

  return { vocabularyContext, vocabulary: vocabulary ?? null }
}

export async function* generateQueueArticle(params: QueueArticleParams): AsyncGenerator<QueueArticleEvent> {
  const {
    queueItemIds,
    useSelected = true,
    maxItems = 25,
    vocabularyIntensity = 50,
    model: modelOverride,
    effort,
    repoIntensity = 40,
  } = params

  // Model: explicit override (e.g. cron auto-post) wins; otherwise central
  // settings (admin/settings → KI-Modelle tab, 'ghostwriter' use-case).
  const configModel = modelOverride ?? (await getModelForUseCase('ghostwriter'))
  const model = configModel as AIModel
  console.log(`[Ghostwriter-Queue] Model: ${model} (from settings), Items: ${queueItemIds?.length || 'auto-select'}, useSelected: ${useSelected}, maxItems: ${maxItems}`)

  // Select + enrich items (shared with the resumable article-job path)
  const { pipelineItems, usedItemIds, sourceDistribution: distribution } =
    await selectAndEnrichItems({ queueItemIds, useSelected, maxItems })

  // Build vocabulary context (shared with the article-job path)
  const { vocabularyContext, vocabulary } = await buildVocabularyContext(vocabularyIntensity)

  console.log(`[Ghostwriter-Queue] Running pipeline with ${pipelineItems.length} items, model: ${model}`)

  yield { model, started: true, itemCount: pipelineItems.length, sourceDistribution: distribution, pipeline: true }

  let fullText = ''

  for await (const event of runGhostwriterPipeline(pipelineItems, model, { vocabularyContext, effort, repoIntensity })) {
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
      // Replace entire text with the proofread version — but ONLY if it wasn't
      // truncated at max_tokens. A cut-off proofread would otherwise replace the
      // complete article with a version that ends mid-sentence.
      if (!isLikelyTruncated(fullText, event.text)) {
        yield { clear: true }
        yield { text: event.text }
        fullText = event.text
      } else {
        console.warn(`[Ghostwriter-Queue] Proofread truncated (${event.text.length}/${fullText.length} chars) — keeping original`)
      }
    }
  }

  // Check for duplicate metaphors in assembled text
  const duplicates = findDuplicateMetaphors(fullText, vocabulary || undefined)
  if (duplicates.size > 0) {
    const duplicateList = Array.from(duplicates.entries())
      .map(([m, p]) => `${m} (${p.length}x)`)
      .join(', ')
    yield { phase: 'deduplication', message: `Prüfe auf wiederholte Metaphern: ${duplicateList}...` }
    // Accumulate the full rewrite first, then swap it in atomically — only if it
    // wasn't truncated. Streaming chunks live would commit a cut-off rewrite to
    // the editor before we could detect the truncation. Best-effort: any failure
    // keeps the (complete) pre-dedup text.
    try {
      let deduped = ''
      for await (const chunk of streamMetaphorDeduplication(fullText, duplicates, model)) {
        deduped += chunk
      }
      if (deduped.trim().length > 0 && !isLikelyTruncated(fullText, deduped)) {
        yield { clear: true }
        yield { text: deduped }
        fullText = deduped
      } else {
        console.warn(`[Ghostwriter-Queue] Metaphor dedup truncated (${deduped.length}/${fullText.length} chars) — keeping original`)
      }
    } catch (err) {
      console.error('[Ghostwriter-Queue] Metaphor dedup failed, keeping original:', err)
    }
  }

  yield { done: true, model, queueItemIds: usedItemIds, pipeline: true }
}
