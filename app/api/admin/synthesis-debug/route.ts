import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminRequest } from '@/lib/auth/session'

export const runtime = 'nodejs'

/**
 * GET: Debug synthesis pipeline for a digest
 * Query params:
 * - digestId: UUID of the digest to analyze
 */
export async function GET(request: NextRequest) {
  // Check admin auth
  if (process.env.NODE_ENV === 'production') {
    const isAdmin = await isAdminRequest(request)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createAdminClient()
  const { searchParams } = new URL(request.url)
  const digestId = searchParams.get('digestId')

  // If no digestId provided, list recent digests
  if (!digestId) {
    const { data: recentDigests, error } = await supabase
      .from('daily_digests')
      .select('id, digest_date, created_at')
      .order('digest_date', { ascending: false })
      .limit(10)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      message: 'Provide ?digestId=<uuid> to debug a specific digest',
      recentDigests: recentDigests?.map(d => ({
        id: d.id,
        date: d.digest_date,
        created: d.created_at,
        debugUrl: `/api/admin/synthesis-debug?digestId=${d.id}`,
      })),
    })
  }

  const debug: Record<string, unknown> = {}

  // 1. Get the digest
  const { data: digest, error: digestError } = await supabase
    .from('daily_digests')
    .select('id, digest_date, sources_used, created_at')
    .eq('id', digestId)
    .single()

  if (digestError || !digest) {
    return NextResponse.json({ error: 'Digest not found', digestError }, { status: 404 })
  }

  debug.digest = {
    id: digest.id,
    digest_date: digest.digest_date,
    sources_used_count: digest.sources_used?.length || 0,
    created_at: digest.created_at,
  }

  // 2. Check if sources_used has items
  if (digest.sources_used && digest.sources_used.length > 0) {
    const { data: sourceItems, error: sourceError } = await supabase
      .from('daily_repo')
      .select('id, title, embedding, collected_at, newsletter_date')
      .in('id', digest.sources_used)

    debug.sourceItems = {
      requested: digest.sources_used.length,
      found: sourceItems?.length || 0,
      withEmbeddings: sourceItems?.filter(i => i.embedding !== null).length || 0,
      withoutEmbeddings: sourceItems?.filter(i => i.embedding === null).length || 0,
      sample: sourceItems?.slice(0, 3).map(i => ({
        id: i.id,
        title: i.title?.slice(0, 50),
        hasEmbedding: i.embedding !== null,
        collected_at: i.collected_at,
        newsletter_date: i.newsletter_date,
      })),
      error: sourceError?.message,
    }
  } else {
    // Fallback: get items by date
    const { data: dateItems, error: dateError } = await supabase
      .from('daily_repo')
      .select('id, title, embedding, collected_at, newsletter_date')
      .eq('newsletter_date', digest.digest_date)

    debug.dateItems = {
      date: digest.digest_date,
      found: dateItems?.length || 0,
      withEmbeddings: dateItems?.filter(i => i.embedding !== null).length || 0,
      withoutEmbeddings: dateItems?.filter(i => i.embedding === null).length || 0,
      sample: dateItems?.slice(0, 3).map(i => ({
        id: i.id,
        title: i.title?.slice(0, 50),
        hasEmbedding: i.embedding !== null,
        collected_at: i.collected_at,
        newsletter_date: i.newsletter_date,
      })),
      error: dateError?.message,
    }
  }

  // 3. Check overall embedding status in daily_repo
  const { count: totalItems } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })

  const { count: itemsWithEmbeddings } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .not('embedding', 'is', null)

  debug.embeddingStatus = {
    totalItems: totalItems || 0,
    withEmbeddings: itemsWithEmbeddings || 0,
    missingEmbeddings: (totalItems || 0) - (itemsWithEmbeddings || 0),
    percentComplete: totalItems ? Math.round((itemsWithEmbeddings || 0) / totalItems * 100) : 0,
  }

  // 4. Check historical items (older than digest date, within 90 days)
  const digestDate = new Date(digest.digest_date)
  const minDate = new Date(digestDate)
  minDate.setDate(minDate.getDate() - 90)

  const { count: historicalTotal } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .lt('newsletter_date', digest.digest_date)
    .gt('newsletter_date', minDate.toISOString().split('T')[0])

  const { count: historicalWithEmbeddings } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .lt('newsletter_date', digest.digest_date)
    .gt('newsletter_date', minDate.toISOString().split('T')[0])
    .not('embedding', 'is', null)

  debug.historicalItems = {
    dateRange: {
      from: minDate.toISOString().split('T')[0],
      to: digest.digest_date,
    },
    total: historicalTotal || 0,
    withEmbeddings: historicalWithEmbeddings || 0,
    missingEmbeddings: (historicalTotal || 0) - (historicalWithEmbeddings || 0),
  }

  // 5. Check existing synthesis candidates for this digest
  const { count: existingCandidates } = await supabase
    .from('synthesis_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('digest_id', digestId)

  const { count: existingSyntheses } = await supabase
    .from('developed_syntheses')
    .select('id', { count: 'exact', head: true })
    .eq('digest_id', digestId)

  debug.existingSynthesis = {
    candidates: existingCandidates || 0,
    developedSyntheses: existingSyntheses || 0,
  }

  // 6. Diagnosis
  const issues: string[] = []

  if (debug.embeddingStatus && typeof debug.embeddingStatus === 'object' && 'missingEmbeddings' in debug.embeddingStatus) {
    const embStatus = debug.embeddingStatus as { missingEmbeddings: number; percentComplete: number }
    if (embStatus.missingEmbeddings > 0 && embStatus.percentComplete < 80) {
      issues.push(`Nur ${embStatus.percentComplete}% der Items haben Embeddings. Bitte Backfill ausführen.`)
    }
  }

  if (debug.historicalItems && typeof debug.historicalItems === 'object' && 'withEmbeddings' in debug.historicalItems) {
    const histItems = debug.historicalItems as { withEmbeddings: number; total: number; missingEmbeddings: number }
    if (histItems.withEmbeddings === 0) {
      issues.push('Keine historischen Items haben Embeddings. Similarity Search findet nichts.')
    } else if (histItems.missingEmbeddings > histItems.withEmbeddings) {
      issues.push(`Viele historische Items ohne Embeddings (${histItems.missingEmbeddings} von ${histItems.total})`)
    }
  }

  if (debug.sourceItems && typeof debug.sourceItems === 'object' && 'found' in debug.sourceItems) {
    const srcItems = debug.sourceItems as { found: number; withEmbeddings: number }
    if (srcItems.found === 0) {
      issues.push('Keine Source-Items für diesen Digest gefunden.')
    } else if (srcItems.withEmbeddings === 0) {
      issues.push('Keines der Source-Items hat ein Embedding.')
    }
  }

  if (debug.dateItems && typeof debug.dateItems === 'object' && 'found' in debug.dateItems) {
    const dtItems = debug.dateItems as { found: number }
    if (dtItems.found === 0) {
      issues.push(`Keine Items für Datum ${digest.digest_date} gefunden.`)
    }
  }

  debug.diagnosis = {
    issues,
    recommendation: issues.length > 0
      ? 'Führe den Embedding-Backfill aus und starte die Synthese erneut.'
      : 'Alle Voraussetzungen scheinen erfüllt. Prüfe die Vercel-Logs für Details.',
  }

  // 7. Test similarity search with a sample item
  const sampleItemId = debug.sourceItems && typeof debug.sourceItems === 'object' && 'sample' in debug.sourceItems
    ? (debug.sourceItems as { sample?: Array<{ id: string }> }).sample?.[0]?.id
    : null

  if (sampleItemId) {
    // Get the embedding for this item
    const { data: itemWithEmbedding } = await supabase
      .from('daily_repo')
      .select('id, title, content, embedding')
      .eq('id', sampleItemId)
      .single()

    if (itemWithEmbedding?.embedding) {
      // Try direct similarity search via RPC
      const { data: similarItems, error: searchError } = await supabase.rpc('find_similar_items', {
        query_embedding: itemWithEmbedding.embedding,
        item_id: sampleItemId,
        max_age_days: 90,
        match_threshold: 0.3, // Lower threshold for testing
        match_count: 5,
      })

      debug.similarityTest = {
        testItemId: sampleItemId,
        testItemTitle: itemWithEmbedding.title?.slice(0, 50),
        embeddingLength: typeof itemWithEmbedding.embedding === 'string'
          ? itemWithEmbedding.embedding.length
          : 'array',
        embeddingPreview: typeof itemWithEmbedding.embedding === 'string'
          ? itemWithEmbedding.embedding.slice(0, 50) + '...'
          : 'array format',
        searchError: searchError?.message,
        resultsCount: similarItems?.length || 0,
        results: similarItems?.slice(0, 3).map((r: { id: string; title: string; similarity: number }) => ({
          id: r.id,
          title: r.title?.slice(0, 40),
          similarity: r.similarity,
        })),
      }

      // 8. Test actual scoring with Claude Haiku (if similarity search found results)
      if (similarItems && similarItems.length > 0 && searchParams.get('testScoring') === 'true') {
        const testSimilarItem = similarItems[0]

        // Get active synthesis prompt
        const { data: activePrompt } = await supabase
          .from('synthesis_prompts')
          .select('scoring_prompt')
          .eq('is_active', true)
          .single()

        if (activePrompt?.scoring_prompt) {
          try {
            const Anthropic = (await import('@anthropic-ai/sdk')).default
            const anthropic = new Anthropic({
              apiKey: process.env.ANTHROPIC_API_KEY,
            })

            const currentNews = `${itemWithEmbedding.title}\n\n${(itemWithEmbedding.content || '').slice(0, 1500)}`
            const historicalNews = `${testSimilarItem.title}\n\n${(testSimilarItem.content || '').slice(0, 1500)}`
            const daysAgo = Math.round((Date.now() - new Date(testSimilarItem.collected_at).getTime()) / (1000 * 60 * 60 * 24))

            const prompt = activePrompt.scoring_prompt
              .replace('{current_news}', currentNews)
              .replace('{historical_news}', historicalNews)
              .replace('{days_ago}', String(daysAgo))

            const response = await anthropic.messages.create({
              model: 'claude-3-5-haiku-20241022',
              max_tokens: 256,
              messages: [{ role: 'user', content: prompt }],
            })

            const text = response.content[0].type === 'text' ? response.content[0].text : ''

            // Parse structured response
            const originalityMatch = text.match(/ORIGINALITÄT:\s*(\d+)/i)
            const relevanceMatch = text.match(/RELEVANZ:\s*(\d+)/i)
            const typeMatch = text.match(/TYP:\s*(contradiction|evolution|cross_domain|validation|pattern)/i)

            const originality = originalityMatch ? parseInt(originalityMatch[1], 10) : 5
            const relevance = relevanceMatch ? parseInt(relevanceMatch[1], 10) : 5
            const totalScore = originality + relevance

            debug.scoringTest = {
              testItemTitle: itemWithEmbedding.title?.slice(0, 50),
              historicalItemTitle: testSimilarItem.title?.slice(0, 50),
              daysAgo,
              rawResponse: text,
              parsedOriginality: originality,
              parsedRelevance: relevance,
              parsedType: typeMatch?.[1] || 'fallback: cross_domain',
              totalScore,
              wouldPassThreshold: totalScore >= 12,
              threshold: 12,
              diagnosis: totalScore >= 12
                ? 'Score passes threshold - should create candidate'
                : `Score ${totalScore} is below threshold 12 - candidate filtered out`,
            }
          } catch (scoringError) {
            debug.scoringTest = {
              error: scoringError instanceof Error ? scoringError.message : 'Unknown error',
              diagnosis: 'Claude Haiku API call failed - check ANTHROPIC_API_KEY',
            }
          }
        } else {
          debug.scoringTest = {
            error: 'No active synthesis prompt found',
            diagnosis: 'Missing active prompt in synthesis_prompts table',
          }
        }
      }
    }
  }

  return NextResponse.json(debug)
}
