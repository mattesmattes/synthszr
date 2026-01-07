import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateEmbedding, prepareTextForEmbedding } from '@/lib/embeddings/generator'
import { jwtVerify } from 'jose'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes max

const SESSION_COOKIE_NAME = 'synthszr_session'

function getSecretKey() {
  const secret = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD
  if (!secret) return null
  return new TextEncoder().encode(secret)
}

async function isAdminSession(request: NextRequest): Promise<boolean> {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!sessionToken) return false

  const secretKey = getSecretKey()
  if (!secretKey) return false

  try {
    await jwtVerify(sessionToken, secretKey)
    return true
  } catch {
    return false
  }
}

/**
 * GET: Check how many items need embeddings
 */
export async function GET(request: NextRequest) {
  // Check admin auth
  if (process.env.NODE_ENV === 'production') {
    const isAdmin = await isAdminSession(request)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
  // Check admin auth
  if (process.env.NODE_ENV === 'production') {
    const isAdmin = await isAdminSession(request)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const { searchParams } = new URL(request.url)
  const batchSize = Math.min(parseInt(searchParams.get('batchSize') || '50'), 100)
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
