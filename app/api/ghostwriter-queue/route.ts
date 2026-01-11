/**
 * Queue-based Ghostwriter API
 * Generates articles from news queue items instead of digests
 * Enforces 30% source diversity limit
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { streamGhostwriter, findDuplicateMetaphors, streamMetaphorDeduplication, type AIModel } from '@/lib/claude/ghostwriter'
import { getBalancedSelection, selectItemsForArticle } from '@/lib/news-queue/service'

const VALID_MODELS: AIModel[] = ['claude-opus-4', 'claude-sonnet-4', 'gemini-2.5-pro', 'gemini-3-pro-preview']

export async function POST(request: NextRequest) {
  const session = await getSession()
  const authHeader = request.headers.get('authorization')
  const cronSecretValid = authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!session && !cronSecretValid) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await request.json()
    const {
      queueItemIds,        // Specific items to use (optional)
      maxItems = 10,       // Max items if using balanced selection
      promptId,
      vocabularyIntensity = 50,
      model: requestedModel
    } = body

    const model: AIModel = VALID_MODELS.includes(requestedModel) ? requestedModel : 'gemini-2.5-pro'
    console.log(`[Ghostwriter-Queue] Model: ${model}, Items: ${queueItemIds?.length || 'auto-select'}`)

    const supabase = await createClient()

    // Get queue items - either specified or balanced selection
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
    } else {
      // Use balanced selection
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
    const itemsWithDailyRepoId = selectedItems.filter(i => i.daily_repo_id)
    if (itemsWithDailyRepoId.length > 0) {
      const dailyRepoIds = itemsWithDailyRepoId.map(i => i.daily_repo_id as string)
      const { data: repoContent } = await supabase
        .from('daily_repo')
        .select('id, content')
        .in('id', dailyRepoIds)

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
      if (item.source_url) {
        sourceReference += `${i + 1}. "${item.title}" → ${item.source_url} [QUELLE: ${sourceName}]\n`
      } else {
        sourceReference += `${i + 1}. "${item.title}" [QUELLE: ${sourceName}]\n`
      }
    }

    // Add diversity info
    sourceReference += '\n\n**QUELLEN-VERTEILUNG:**\n'
    for (const d of distribution) {
      sourceReference += `- ${d.source}: ${d.count} News (${d.percentage}%)\n`
    }

    // Get ghostwriter prompt
    let promptText: string
    if (promptId) {
      const { data: prompt } = await supabase
        .from('ghostwriter_prompts')
        .select('prompt_text')
        .eq('id', promptId)
        .single()
      promptText = prompt?.prompt_text || getDefaultPrompt()
    } else {
      const { data: activePrompt } = await supabase
        .from('ghostwriter_prompts')
        .select('prompt_text')
        .eq('is_active', true)
        .single()
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
