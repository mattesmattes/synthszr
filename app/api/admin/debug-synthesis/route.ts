/**
 * Debug endpoint for synthesis pipeline issues
 * Analyzes embedding coverage, date distributions, and similarity search
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const testItemId = searchParams.get('testItemId')

  try {
    const supabase = await createClient()

    // 1. Overall embedding coverage
    const { data: embeddingStats } = await supabase.rpc('get_embedding_stats')

    // If RPC doesn't exist, do it manually
    let stats = embeddingStats
    if (!stats) {
      const { data: allItems } = await supabase
        .from('daily_repo')
        .select('id, embedding, collected_at, newsletter_date')

      const total = allItems?.length || 0
      const withEmbedding = allItems?.filter(i => i.embedding !== null).length || 0
      const withCollectedAt = allItems?.filter(i => i.collected_at !== null).length || 0

      // Check date ranges
      const now = new Date()
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

      const inDateRange = allItems?.filter(i => {
        if (!i.collected_at) return false
        const date = new Date(i.collected_at)
        return date > ninetyDaysAgo
      }).length || 0

      const withBothInRange = allItems?.filter(i => {
        if (!i.embedding || !i.collected_at) return false
        const date = new Date(i.collected_at)
        return date > ninetyDaysAgo
      }).length || 0

      stats = {
        total,
        withEmbedding,
        withoutEmbedding: total - withEmbedding,
        withCollectedAt,
        inDateRange,
        withBothInRange,
        embeddingPercent: total > 0 ? Math.round(100 * withEmbedding / total) : 0,
      }
    }

    // 2. Sample items to check embedding format
    const { data: sampleItems } = await supabase
      .from('daily_repo')
      .select('id, title, embedding, collected_at, newsletter_date')
      .not('embedding', 'is', null)
      .order('collected_at', { ascending: false })
      .limit(5)

    const embeddingFormats = sampleItems?.map(item => {
      const emb = item.embedding
      let format = 'unknown'
      let length = 0

      if (typeof emb === 'string') {
        format = 'string'
        // Try to parse and count
        try {
          const cleaned = emb.replace(/[\[\]]/g, '')
          const parts = cleaned.split(',')
          length = parts.length
        } catch {
          length = -1
        }
      } else if (Array.isArray(emb)) {
        format = 'array'
        length = emb.length
      }

      return {
        id: item.id,
        title: item.title?.slice(0, 40),
        format,
        embeddingLength: length,
        collected_at: item.collected_at,
        newsletter_date: item.newsletter_date,
      }
    })

    // 3. Check collected_at distribution
    const { data: dateDistribution } = await supabase
      .from('daily_repo')
      .select('collected_at, newsletter_date')
      .not('embedding', 'is', null)
      .order('collected_at', { ascending: false })
      .limit(100)

    const dateStats = {
      nullCollectedAt: dateDistribution?.filter(d => !d.collected_at).length || 0,
      nullNewsletterDate: dateDistribution?.filter(d => !d.newsletter_date).length || 0,
      mismatchedDates: dateDistribution?.filter(d => {
        if (!d.collected_at || !d.newsletter_date) return false
        const collected = new Date(d.collected_at).toISOString().slice(0, 10)
        return collected !== d.newsletter_date
      }).length || 0,
    }

    // 4. Test similarity search if testItemId provided
    let similarityTest = null
    if (testItemId) {
      // Get the item's embedding
      const { data: testItem } = await supabase
        .from('daily_repo')
        .select('id, title, embedding')
        .eq('id', testItemId)
        .single()

      if (testItem?.embedding) {
        // Call the find_similar_items function
        const { data: similarItems, error: simError } = await supabase.rpc('find_similar_items', {
          query_embedding: testItem.embedding,
          item_id: testItemId,
          max_age_days: 90,
          match_threshold: 0.3, // Very low threshold for testing
          match_count: 10,
        })

        similarityTest = {
          testItemTitle: testItem.title,
          hasEmbedding: !!testItem.embedding,
          error: simError?.message,
          resultsCount: similarItems?.length || 0,
          results: similarItems?.slice(0, 5).map((s: { title: string; similarity: number; collected_at: string }) => ({
            title: s.title?.slice(0, 50),
            similarity: s.similarity,
            collected_at: s.collected_at,
          })),
        }
      } else {
        similarityTest = {
          error: 'Test item has no embedding',
          testItemTitle: testItem?.title,
        }
      }
    }

    // 5. Check items from today's digest
    const today = new Date().toISOString().slice(0, 10)
    const { data: todayItems } = await supabase
      .from('daily_repo')
      .select('id, title, embedding, collected_at')
      .eq('newsletter_date', today)
      .limit(20)

    const todayStats = {
      total: todayItems?.length || 0,
      withEmbedding: todayItems?.filter(i => i.embedding !== null).length || 0,
      withCollectedAt: todayItems?.filter(i => i.collected_at !== null).length || 0,
      items: todayItems?.slice(0, 5).map(i => ({
        title: i.title?.slice(0, 50),
        hasEmbedding: !!i.embedding,
        collected_at: i.collected_at,
      })),
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      embeddingStats: stats,
      embeddingFormats,
      dateStats,
      todayStats,
      similarityTest,
      diagnosis: generateDiagnosis(stats, dateStats, todayStats),
    })
  } catch (error) {
    console.error('[Debug-Synthesis] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

function generateDiagnosis(
  stats: { total: number; withEmbedding: number; withBothInRange: number; embeddingPercent: number },
  dateStats: { nullCollectedAt: number },
  todayStats: { total: number; withEmbedding: number }
): string[] {
  const issues: string[] = []

  if (stats.embeddingPercent < 50) {
    issues.push(`CRITICAL: Only ${stats.embeddingPercent}% of items have embeddings. Run embedding backfill.`)
  }

  if (stats.withBothInRange < 100) {
    issues.push(`WARNING: Only ${stats.withBothInRange} items have embeddings AND are within 90-day range.`)
  }

  if (dateStats.nullCollectedAt > 0) {
    issues.push(`WARNING: ${dateStats.nullCollectedAt} items with embeddings have NULL collected_at.`)
  }

  if (todayStats.total > 0 && todayStats.withEmbedding < todayStats.total) {
    issues.push(`INFO: Today's items: ${todayStats.withEmbedding}/${todayStats.total} have embeddings.`)
  }

  if (issues.length === 0) {
    issues.push('No obvious issues detected. Check similarity threshold or embedding quality.')
  }

  return issues
}
