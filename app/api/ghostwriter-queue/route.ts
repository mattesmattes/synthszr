/**
 * Queue-based Ghostwriter API
 * Generates articles from news queue items instead of digests
 * Enforces 30% source diversity limit
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { streamGhostwriter, findDuplicateMetaphors, streamMetaphorDeduplication, getDefaultGhostwriterPrompt, type AIModel } from '@/lib/claude/ghostwriter'
import { runGhostwriterPipeline, type PipelineItem } from '@/lib/claude/ghostwriter-pipeline'
import { getBalancedSelection, getSelectedItems, selectItemsForArticle, domainFromUrl, deriveSourceUrl } from '@/lib/news-queue/service'
import { sanitizeUrl, sanitizeContentUrls } from '@/lib/utils/url-sanitizer'
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'
import { getModelForUseCase } from '@/lib/ai/model-config'

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
      useSelected = true,  // Use manually selected items (status='selected')
      maxItems = 25,       // Max items if using balanced selection (fallback)
      promptId,
      vocabularyIntensity = 50,
      pipeline = true,     // Two-pass pipeline (default) vs single-pass
    } = body

    // Model comes from central settings (admin/settings → KI-Modelle tab)
    const configModel = await getModelForUseCase('ghostwriter')
    const model = configModel as AIModel
    console.log(`[Ghostwriter-Queue] Model: ${model} (from settings), Items: ${queueItemIds?.length || 'auto-select'}, useSelected: ${useSelected}, pipeline: ${pipeline}`)

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

    // Get vocabulary (used by both pipeline and single-pass)
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
    const encoder = new TextEncoder()

    // ── TWO-PASS PIPELINE (default) ──────────────────────────────────────────
    if (pipeline) {
      const pipelineItems: PipelineItem[] = selectedItems.map(item => ({
        id: item.id,
        title: item.title,
        content: item.content ? sanitizeContentUrls(item.content) : null,
        source_display_name: item.source_display_name,
        source_url: sanitizeUrl(item.source_url) || deriveSourceUrl(null, item.source_identifier),
        source_identifier: item.source_identifier,
      }))

      console.log(`[Ghostwriter-Queue] Running TWO-PASS PIPELINE with ${pipelineItems.length} items, model: ${model}`)

      const stream = new ReadableStream({
        async start(controller) {
          const send = (data: unknown) =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

          try {
            send({ model, started: true, itemCount: selectedItems.length, sourceDistribution: distribution, pipeline: true })

            let fullText = ''

            for await (const event of runGhostwriterPipeline(pipelineItems, model, { vocabularyContext })) {
              if (event.type === 'planning') {
                send({ phase: 'pipeline', message: event.message })
              } else if (event.type === 'planned') {
                send({ phase: 'pipeline', message: `Struktur fertig. Schreibe ${event.itemCount} Abschnitte...` })
              } else if (event.type === 'writing') {
                send({ phase: 'pipeline', message: `Abschnitt ${event.current} von ${event.total}: ${event.title.slice(0, 60)}...`, progress: { current: event.current, total: event.total } })
              } else if (event.type === 'metadata' || event.type === 'section') {
                fullText += event.text
                send({ text: event.text })
              } else if (event.type === 'assembling') {
                send({ phase: 'pipeline', message: 'Artikel fertiggestellt.' })
              }
            }

            // Check for duplicate metaphors in assembled text
            const duplicates = findDuplicateMetaphors(fullText, vocabulary || undefined)
            if (duplicates.size > 0) {
              const duplicateList = Array.from(duplicates.entries())
                .map(([m, p]) => `${m} (${p.length}x)`)
                .join(', ')
              send({ phase: 'deduplication', message: `Prüfe auf wiederholte Metaphern: ${duplicateList}...` })
              send({ clear: true })
              for await (const chunk of streamMetaphorDeduplication(fullText, duplicates, model)) {
                send({ text: chunk })
              }
            }

            send({ done: true, model, queueItemIds: usedItemIds, pipeline: true })
          } catch (error) {
            console.error('[Ghostwriter-Queue] Pipeline error:', error)
            send({ error: error instanceof Error ? error.message : 'Pipeline fehlgeschlagen' })
          }
          controller.close()
        },
      })

      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
      })
    }

    // ── SINGLE-PASS FALLBACK (pipeline=false) ────────────────────────────────
    // Build content only needed for single-pass mode (pipeline handles this internally)
    let digestContent = '## Ausgewählte News für diesen Artikel\n\n'
    for (const item of selectedItems) {
      digestContent += `### ${item.title}\n`
      const rawSourceName = item.source_display_name || item.source_identifier
      const hasValidSource = rawSourceName && rawSourceName !== 'unknown'
      const cleanUrl = sanitizeUrl(item.source_url)
      const sourceName = hasValidSource ? rawSourceName : (cleanUrl ? domainFromUrl(cleanUrl) : null)
      const effectiveUrl = cleanUrl || deriveSourceUrl(null, item.source_identifier)
      if (sourceName || effectiveUrl) {
        digestContent += `(Quelleninfo: ${sourceName || 'unbekannte Quelle'}${effectiveUrl ? ` | URL: ${effectiveUrl}` : ''})\n`
      }
      if (item.content) digestContent += `${sanitizeContentUrls(item.content)}\n`
      digestContent += '\n---\n\n'
    }

    // Load prompt + stylistic rules (only needed for single-pass)
    let promptText: string
    if (promptId) {
      const { data: prompt } = await supabase.from('ghostwriter_prompts').select('prompt_text').eq('id', promptId).single()
      promptText = prompt?.prompt_text || getDefaultGhostwriterPrompt()
    } else {
      const { data: activePrompt } = await supabase.from('ghostwriter_prompts').select('prompt_text').eq('is_active', true).single()
      promptText = activePrompt?.prompt_text || getDefaultGhostwriterPrompt()
    }

    const { data: stylisticRules } = await supabase
      .from('stylistic_rules')
      .select('rule_type, name, description, examples, priority')
      .eq('is_active', true)
      .order('priority', { ascending: false })

    let stylisticContext = ''
    if (stylisticRules && stylisticRules.length > 0) {
      stylisticContext = '\n\n---\n\nSTILISTISCHE RICHTLINIEN (Matthias Schrader Stil):\n'
      const rulesByType = stylisticRules.reduce((acc, r) => {
        if (!acc[r.rule_type]) acc[r.rule_type] = []
        acc[r.rule_type].push(r)
        return acc
      }, {} as Record<string, typeof stylisticRules>)
      if (rulesByType['sprachregister']) stylisticContext += `\n**SPRACHREGISTER:** ${rulesByType['sprachregister'][0].description}\n`
      if (rulesByType['personalpronomina']) stylisticContext += `\n**PERSPEKTIVE:** ${rulesByType['personalpronomina'][0].description}\n`
      if (rulesByType['interpunktion']) stylisticContext += `\n**INTERPUNKTION:** ${rulesByType['interpunktion'][0].description}\n`
      if (rulesByType['textlaenge']) stylisticContext += `\n**SATZSTRUKTUR:** ${rulesByType['textlaenge'][0].description}\n`
      if (rulesByType['metapherntyp']?.length) {
        stylisticContext += `\n**BEVORZUGTE METAPHERN-BEREICHE:**\n` + rulesByType['metapherntyp'].map(r => `- ${r.description}`).join('\n')
      }
      if (rulesByType['autorenzitat']?.length) {
        stylisticContext += `\n\n**HÄUFIG ZITIERTE AUTOREN:** ${rulesByType['autorenzitat'].map(r => r.name).join(', ')}\n`
      }
      if (rulesByType['stilregel']) {
        stylisticContext += `\n**WEITERE STILREGELN:**\n` + rulesByType['stilregel'].map(r => `- ${r.description}`).join('\n')
      }
    }

    const fullPrompt = promptText + vocabularyContext + stylisticContext
    const publicCompanyList = Object.keys(KNOWN_COMPANIES).join(', ')
    const premarketCompanyList = Object.keys(KNOWN_PREMARKET_COMPANIES).join(', ')

    const enforcementRules = `

---

## QUALITÄTS-CHECKLISTE (MUSS EINGEHALTEN WERDEN):

1. **ANZAHL NEWS:** Verarbeite ALLE ${selectedItems.length} News — keine weglassen!
   - Jede News bekommt eine eigene Zwischenüberschrift (##)
   - Jeder News-Artikel MUSS exakt 5-7 Sätze haben

2. **SYNTHSZR TAKE:** Jeder "Synthszr Take:" MUSS MINDESTENS 6 Sätze haben (Ziel: 6-7 Sätze).
   - Schreibe als erfahrener Tech-Stratege — keine Dramatik, kein Überzeugungsversuch
   - Der LETZTE Satz MUSS knackig und zitierfähig sein: klar positiv ODER negativ.
   - VERBOTEN: Kontrastpaare, Abwarte-Formeln, Potenzial-Phrasen, Reframing, rhetorische Fragen, "Doch"-Satzanfang, Gedankenstriche (—)
   - FATAL: "Nicht X. Y.", "Vergiss X.", "Weniger X, mehr Y." → DIREKT POSITIV.

3. **COMPANY TAGGING:** {Company1} {Company2} → [Quellenname](URL)
   **VERFÜGBARE PUBLIC COMPANIES:** ${publicCompanyList}
   **VERFÜGBARE PREMARKET COMPANIES:** ${premarketCompanyList}
   Max 3 Company-Tags. Quelle NUR in dieser Zeile.

4. **EXCERPT:** Exakt 3 Bullet Points (•), max 65 Zeichen pro Bullet.

**WICHTIG:** ALLE ${selectedItems.length} News MÜSSEN im Artikel erscheinen.
`

    const fullContent = digestContent + enforcementRules
    console.log(`[Ghostwriter-Queue] Single-pass, content: ${fullContent.length} chars`)

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        try {
          send({ model, started: true, itemCount: selectedItems.length, sourceDistribution: distribution })

          let generatedText = ''
          for await (const chunk of streamGhostwriter(fullContent, fullPrompt, model)) {
            generatedText += chunk
            send({ text: chunk })
          }

          // Check for duplicate metaphors
          const duplicates = findDuplicateMetaphors(generatedText, vocabulary || undefined)
          if (duplicates.size > 0) {
            const duplicateList = Array.from(duplicates.entries())
              .map(([m, p]) => `${m} (${p.length}x)`)
              .join(', ')
            send({ phase: 'deduplication', message: `Prüfe auf wiederholte Metaphern: ${duplicateList}...` })
            send({ clear: true })
            for await (const chunk of streamMetaphorDeduplication(generatedText, duplicates, model)) {
              send({ text: chunk })
            }
          }

          send({ done: true, model, queueItemIds: usedItemIds })
        } catch (error) {
          send({ error: error instanceof Error ? error.message : 'Ghostwriter fehlgeschlagen' })
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

// Default prompt is now imported from '@/lib/claude/ghostwriter' as getDefaultGhostwriterPrompt
