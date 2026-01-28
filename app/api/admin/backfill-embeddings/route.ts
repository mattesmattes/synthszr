import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/session'
import { generateEmbedding, prepareTextForEmbedding } from '@/lib/embeddings/generator'
import { parseIntParam } from '@/lib/validation/query-params'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes max

/**
 * GET: Check how many items need embeddings
 * Query params:
 * - test=true: Test the embedding API with a sample text
 */
export async function GET(request: NextRequest) {
  // Always require admin auth
  const authError = await requireAdmin(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)

  // Test mode: verify embedding API works
  if (searchParams.get('test') === 'true') {
    const apiKeyExists = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
    const apiKeyLength = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.length || 0

    if (!apiKeyExists) {
      return NextResponse.json({
        test: 'FAILED',
        error: 'GOOGLE_GENERATIVE_AI_API_KEY is not set',
        apiKeyExists: false,
      }, { status: 500 })
    }

    try {
      const startTime = Date.now()
      const embedding = await generateEmbedding('Test embedding for API verification')
      const duration = Date.now() - startTime

      return NextResponse.json({
        test: 'SUCCESS',
        apiKeyExists: true,
        apiKeyLength,
        embeddingDimensions: embedding.length,
        durationMs: duration,
        model: 'embedding-001',
      })
    } catch (error) {
      return NextResponse.json({
        test: 'FAILED',
        apiKeyExists: true,
        apiKeyLength,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      }, { status: 500 })
    }
  }

  const supabase = createAdminClient()

  // Count items without embeddings
  const { count: missingCount, error: countError } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .is('embedding', null)

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 })
  }

  // Count total items
  const { count: totalCount } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })

  // Count items with embeddings
  const { count: withEmbeddingsCount } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .not('embedding', 'is', null)

  return NextResponse.json({
    total: totalCount || 0,
    withEmbeddings: withEmbeddingsCount || 0,
    missingEmbeddings: missingCount || 0,
    percentComplete: totalCount ? Math.round((withEmbeddingsCount || 0) / totalCount * 100) : 0,
  })
}

/**
 * POST: Generate embeddings for items that don't have them
 * Query params:
 * - batchSize: number of items to process (default: 50)
 * - dryRun: if true, only count without generating
 */
export async function POST(request: NextRequest) {
  // Always require admin auth
  const authError = await requireAdmin(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const batchSize = parseIntParam(searchParams.get('batchSize'), 200, 1, 500)
  const dryRun = searchParams.get('dryRun') === 'true'

  const supabase = createAdminClient()

  // Get items without embeddings
  const { data: items, error: fetchError } = await supabase
    .from('daily_repo')
    .select('id, title, content')
    .is('embedding', null)
    .order('collected_at', { ascending: false }) // Process newest first
    .limit(batchSize)

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!items || items.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'Alle Items haben bereits Embeddings',
      processed: 0,
      remaining: 0,
    })
  }

  if (dryRun) {
    return NextResponse.json({
      success: true,
      dryRun: true,
      wouldProcess: items.length,
      items: items.map(i => ({ id: i.id, title: i.title?.slice(0, 50) })),
    })
  }

  // Process items and generate embeddings
  let processed = 0
  let errors = 0
  const errorDetails: Array<{ id: string; title: string; error: string }> = []

  console.log(`[Backfill] Starting embedding generation for ${items.length} items`)

  for (const item of items) {
    try {
      // Prepare text for embedding
      const text = prepareTextForEmbedding(item.title || '', item.content || '')

      if (text.length < 10) {
        console.log(`[Backfill] Skipping item ${item.id} - text too short`)
        continue
      }

      // Generate embedding
      const embedding = await generateEmbedding(text)
      const embeddingString = `[${embedding.join(',')}]`

      // Store embedding
      const { error: updateError } = await supabase
        .from('daily_repo')
        .update({ embedding: embeddingString })
        .eq('id', item.id)

      if (updateError) {
        throw updateError
      }

      processed++
      console.log(`[Backfill] Generated embedding for "${item.title?.slice(0, 40)}..." (${processed}/${items.length})`)

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100))
    } catch (error) {
      console.error(`[Backfill] Error for item ${item.id}:`, error)
      errors++
      errorDetails.push({
        id: item.id,
        title: item.title?.slice(0, 50) || 'Unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  // Count remaining items without embeddings
  const { count: remainingCount } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .is('embedding', null)

  console.log(`[Backfill] Completed: ${processed} processed, ${errors} errors, ${remainingCount} remaining`)

  return NextResponse.json({
    success: true,
    processed,
    errors,
    remaining: remainingCount || 0,
    errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
    message: remainingCount && remainingCount > 0
      ? `${processed} Embeddings generiert. Noch ${remainingCount} verbleibend. Bitte erneut ausführen.`
      : `Fertig! ${processed} Embeddings generiert.`,
  })
}
