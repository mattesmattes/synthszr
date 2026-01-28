/**
 * Queue-based Ghostwriter API
 * Generates articles from news queue items instead of digests
 * Enforces 30% source diversity limit
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { streamGhostwriter, findDuplicateMetaphors, streamMetaphorDeduplication, type AIModel } from '@/lib/claude/ghostwriter'
import { getBalancedSelection, getSelectedItems, selectItemsForArticle } from '@/lib/news-queue/service'
import { sanitizeUrl } from '@/lib/utils/url-sanitizer'

const VALID_MODELS: AIModel[] = ['claude-opus-4', 'claude-sonnet-4', 'gemini-2.5-pro', 'gemini-3-pro-preview']

export async function POST(request: NextRequest) {
  const session = await getSession()
  const authHeader = request.headers.get('authorization')
  const cronSecretValid = authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!session && !cronSecretValid) {
    return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await request.json()
    const {
      queueItemIds,        // Specific items to use (optional)
      useSelected = true,  // Use manually selected items (status='selected') - NEW DEFAULT
      maxItems = 10,       // Max items if using balanced selection (fallback)
      promptId,
      vocabularyIntensity = 50,
      model: requestedModel
    } = body

    const model: AIModel = VALID_MODELS.includes(requestedModel) ? requestedModel : 'gemini-2.5-pro'
    console.log(`[Ghostwriter-Queue] Model: ${model}, Items: ${queueItemIds?.length || 'auto-select'}, useSelected: ${useSelected}`)

    const supabase = await createClient()

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
      if (result.error) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      selectedItems = result.items
    } else if (useSelected) {
      // Use manually selected items (status='selected') + fill from balanced if needed
      const manuallySelected = await getSelectedItems()
      console.log(`[Ghostwriter-Queue] getSelectedItems returned ${manuallySelected.length} items (after filtering published)`)

      if (manuallySelected.length > 0) {
        console.log(`[Ghostwriter-Queue] Using ${manuallySelected.length} manually selected items (maxItems=${maxItems})`)
        selectedItems = manuallySelected

        // Fill up with balanced items if selected < maxItems
        if (manuallySelected.length < maxItems) {
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
          return new Response(JSON.stringify({ error: 'No items available in queue. Select items first or add items to the pending queue.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const itemIds = balancedSelection.map(s => s.id)
        console.log(`[Ghostwriter-Queue] Calling selectItemsForArticle with ${itemIds.length} item IDs`)
        const result = await selectItemsForArticle(itemIds)
        console.log(`[Ghostwriter-Queue] selectItemsForArticle returned ${result.items.length} items (error: ${result.error || 'none'})`)

        if (result.error) {
          return new Response(JSON.stringify({ error: result.error }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        selectedItems = result.items
        console.log(`[Ghostwriter-Queue] Final selected items count: ${selectedItems.length}`)
      }
    } else {
      // Use balanced selection from pending items
      const balancedSelection = await getBalancedSelection(maxItems)

      if (balancedSelection.length === 0) {
        return new Response(JSON.stringify({ error: 'No items available in queue' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const itemIds = balancedSelection.map(s => s.id)
      const result = await selectItemsForArticle(itemIds)

      if (result.error) {
        return new Response(JSON.stringify({ error: result.error }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      selectedItems = result.items
    }

    console.log(`[Ghostwriter-Queue] Selected ${selectedItems.length} items from queue`)

    // Fetch full content from daily_repo for items that have daily_repo_id
    // Queue items may not have content stored, so we fetch from source
    // Use admin client to bypass RLS
    const adminSupabase = createAdminClient()
    const itemsWithDailyRepoId = selectedItems.filter(i => i.daily_repo_id)
    if (itemsWithDailyRepoId.length > 0) {
      const dailyRepoIds = itemsWithDailyRepoId.map(i => i.daily_repo_id as string)
      console.log(`[Ghostwriter-Queue] Fetching content for ${dailyRepoIds.length} items from daily_repo`)
      const { data: repoContent, error: repoError } = await adminSupabase
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

    // Build content for ghostwriter
    let digestContent = '## Ausgewählte News für diesen Artikel\n\n'

    for (const item of selectedItems) {
      digestContent += `### ${item.title}\n`
      if (item.source_display_name) {
        digestContent += `**Quelle:** ${item.source_display_name}\n`
      }
      if (item.content) {
        digestContent += `${item.content}\n`
      }
      digestContent += '\n---\n\n'
    }

    // Add source reference list
    let sourceReference = '\n\n---\n\nVERFÜGBARE QUELLEN:\n'
    sourceReference += '**WICHTIG:** Verwende den NEWSLETTER-NAMEN als Quellenangabe!\n\n'

    for (let i = 0; i < selectedItems.length; i++) {
      const item = selectedItems[i]
      const sourceName = item.source_display_name || item.source_identifier
      // SECURITY: Sanitize URLs to prevent tracking parameter leaks
      const cleanUrl = sanitizeUrl(item.source_url)
      if (cleanUrl) {
        sourceReference += `${i + 1}. "${item.title}" → ${cleanUrl} [QUELLE: ${sourceName}]\n`
      } else {
        sourceReference += `${i + 1}. "${item.title}" [QUELLE: ${sourceName}]\n`
      }
    }

    // Add diversity info
    sourceReference += '\n\n**QUELLEN-VERTEILUNG:**\n'
    for (const d of distribution) {
      sourceReference += `- ${d.source}: ${d.count} News (${d.percentage}%)\n`
    }

    // Get ghostwriter prompt (with .single() error handling)
    let promptText: string
    if (promptId) {
      const { data: prompt, error: promptError } = await supabase
        .from('ghostwriter_prompts')
        .select('prompt_text')
        .eq('id', promptId)
        .single()
      if (promptError) {
        console.warn(`[Ghostwriter-Queue] Prompt ${promptId} not found, using default`)
      }
      promptText = prompt?.prompt_text || getDefaultPrompt()
    } else {
      const { data: activePrompt, error: activeError } = await supabase
        .from('ghostwriter_prompts')
        .select('prompt_text')
        .eq('is_active', true)
        .single()
      if (activeError) {
        console.warn('[Ghostwriter-Queue] No active prompt found, using default')
      }
      promptText = activePrompt?.prompt_text || getDefaultPrompt()
    }

    // Get vocabulary
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

    const fullPrompt = promptText + vocabularyContext
    const fullContent = digestContent + sourceReference

    console.log(`[Ghostwriter-Queue] Full content length: ${fullContent.length} chars`)
    console.log(`[Ghostwriter-Queue] Content preview (first 500 chars):`, fullContent.slice(0, 500))

    // Track item IDs for marking as used
    const usedItemIds = selectedItems.map(i => i.id)

    // Stream the response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            model,
            started: true,
            itemCount: selectedItems.length,
            sourceDistribution: distribution
          })}\n\n`))

          let generatedText = ''
          for await (const chunk of streamGhostwriter(fullContent, fullPrompt, model)) {
            generatedText += chunk
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
          }

          // Check for duplicate metaphors
          const duplicates = findDuplicateMetaphors(generatedText, vocabulary || undefined)

          if (duplicates.size > 0) {
            const duplicateList = Array.from(duplicates.entries())
              .map(([m, p]) => `${m} (${p.length}x)`)
              .join(', ')
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              phase: 'deduplication',
              message: `Prüfe auf wiederholte Metaphern: ${duplicateList}...`
            })}\n\n`))

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ clear: true })}\n\n`))

            for await (const chunk of streamMetaphorDeduplication(generatedText, duplicates, model)) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
            }
          }

          // Return item IDs for marking as used after save
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            done: true,
            model,
            queueItemIds: usedItemIds
          })}\n\n`))
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Ghostwriter fehlgeschlagen' })}\n\n`
            )
          )
        }
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    console.error('[Ghostwriter-Queue] Error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Ghostwriter fehlgeschlagen' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

function getDefaultPrompt(): string {
  return `Du bist ein erfahrener Tech-Blogger und schreibst für den Synthzr Newsletter.

STIL UND TONALITÄT:
- Schreibe in einem persönlichen, aber professionellen Ton
- Nutze aktive Sprache und direkte Ansprache
- Vermeide Buzzwords und leere Phrasen
- Sei konkret und praxisorientiert

STRUKTUR:
- Beginne mit einem fesselnden Hook
- Gliedere den Artikel in klare Abschnitte
- Nutze Zwischenüberschriften für bessere Lesbarkeit
- Schließe mit einem Call-to-Action oder Ausblick

FORMAT:
- Schreibe auf Deutsch
- Nutze Markdown für Formatierung
- Ziel: 800-1200 Wörter

QUELLEN-DIVERSITÄT:
- Achte darauf, News aus verschiedenen Quellen zu verwenden
- Keine Quelle sollte den Artikel dominieren`
}
