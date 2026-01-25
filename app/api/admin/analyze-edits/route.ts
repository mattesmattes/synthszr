import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import Anthropic from '@anthropic-ai/sdk'
import {
  extractSentenceDiffs,
  filterSignificantDiffs,
  TipTapNode,
} from '@/lib/edit-learning/diff-extractor'
import { generateEmbedding } from '@/lib/embeddings/generator'
import { parseIntParam } from '@/lib/validation/query-params'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

interface EditClassification {
  type: 'stylistic' | 'structural' | 'factual' | 'vocabulary' | 'grammar' | 'deletion' | 'addition' | 'formatting'
  significance: number
  generalizability: number
  explanation: string
}

/**
 * POST /api/admin/analyze-edits
 *
 * Analyzes unprocessed edit_history entries:
 * 1. Extracts sentence-level diffs
 * 2. Classifies each diff using AI
 * 3. Generates embeddings for similarity search
 * 4. Stores in edit_diffs table
 *
 * Query params:
 * - limit: Max entries to process (default: 10)
 * - force: Re-analyze even if already processed
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const limit = parseIntParam(searchParams.get('limit'), 10, 1, 100)
    const force = searchParams.get('force') === 'true'

    // Find unanalyzed edit_history entries
    let query = supabase
      .from('edit_history')
      .select('id, post_id, version, content_before, content_after')
      .order('created_at', { ascending: true })
      .limit(limit)

    if (!force) {
      query = query.is('analysis_completed_at', null)
    }

    const { data: unanalyzed, error: fetchError } = await query

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    if (!unanalyzed || unanalyzed.length === 0) {
      return NextResponse.json({
        message: 'No unanalyzed edits found',
        processed: 0,
      })
    }

    console.log(`[AnalyzeEdits] Processing ${unanalyzed.length} edit history entries`)

    let totalDiffsCreated = 0
    const results: Array<{ historyId: string; diffsCreated: number }> = []

    for (const entry of unanalyzed) {
      try {
        // Extract sentence-level diffs
        const allDiffs = extractSentenceDiffs(
          entry.content_before as TipTapNode,
          entry.content_after as TipTapNode
        )

        // Filter to significant changes only
        const significantDiffs = filterSignificantDiffs(allDiffs)

        console.log(
          `[AnalyzeEdits] Entry ${entry.id}: ${allDiffs.length} total diffs, ${significantDiffs.length} significant`
        )

        // Process each significant diff
        for (const diff of significantDiffs) {
          // Skip very short changes
          if (diff.original.length < 10 && diff.edited.length < 10) continue

          // Classify the edit using AI
          const classification = await classifyEdit(diff.original, diff.edited, diff.changeType)

          // Generate embedding for similarity search
          const embeddingText = `Original: ${diff.original}\nEdited: ${diff.edited}`
          let embedding: number[] | null = null

          try {
            embedding = await generateEmbedding(embeddingText)
          } catch (embError) {
            console.error('[AnalyzeEdits] Embedding generation failed:', embError)
          }

          // Store in edit_diffs
          const { error: insertError } = await supabase.from('edit_diffs').insert({
            edit_history_id: entry.id,
            paragraph_index: diff.paragraphIndex,
            sentence_index: diff.sentenceIndex,
            original_text: diff.original,
            edited_text: diff.edited,
            edit_type: classification.type,
            embedding: embedding ? `[${embedding.join(',')}]` : null,
            significance_score: classification.significance,
            generalizability_score: classification.generalizability,
            pattern_explanation: classification.explanation,
          })

          if (insertError) {
            console.error('[AnalyzeEdits] Failed to insert diff:', insertError)
          } else {
            totalDiffsCreated++
          }
        }

        // Mark entry as analyzed
        await supabase
          .from('edit_history')
          .update({ analysis_completed_at: new Date().toISOString() })
          .eq('id', entry.id)

        results.push({
          historyId: entry.id,
          diffsCreated: significantDiffs.length,
        })
      } catch (entryError) {
        console.error(`[AnalyzeEdits] Error processing entry ${entry.id}:`, entryError)
      }
    }

    return NextResponse.json({
      message: `Analyzed ${unanalyzed.length} edit history entries`,
      processed: unanalyzed.length,
      totalDiffsCreated,
      results,
    })
  } catch (error) {
    console.error('[AnalyzeEdits] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * Classify an edit using Claude
 */
async function classifyEdit(
  original: string,
  edited: string,
  changeType: string
): Promise<EditClassification> {
  // Default classification for deletions and additions
  if (changeType === 'deleted') {
    return {
      type: 'deletion',
      significance: 5,
      generalizability: 3,
      explanation: 'Content was removed from the article.',
    }
  }

  if (changeType === 'added') {
    return {
      type: 'addition',
      significance: 5,
      generalizability: 3,
      explanation: 'New content was added to the article.',
    }
  }

  try {
    const prompt = `Analyze this edit to a German tech newsletter article.

ORIGINAL TEXT:
"${original}"

EDITED TEXT:
"${edited}"

Classify this edit:

1. TYPE: Choose one of:
   - stylistic (tone, voice, formality changes)
   - structural (reorganization, flow)
   - factual (content corrections)
   - vocabulary (word choice improvements)
   - grammar (syntax fixes)
   - formatting (markdown/formatting)

2. SIGNIFICANCE (1-10): How important is this change for article quality?
   - 1-3: Minor polish
   - 4-6: Noticeable improvement
   - 7-10: Critical correction

3. GENERALIZABILITY (1-10): Could this pattern apply to future articles?
   - 1-3: Very specific to this context
   - 4-6: Might apply sometimes
   - 7-10: General pattern worth learning

4. EXPLANATION: Why might the editor have made this change? (1-2 sentences in German)

Respond in this exact JSON format:
{
  "type": "stylistic|structural|factual|vocabulary|grammar|formatting",
  "significance": 5,
  "generalizability": 5,
  "explanation": "..."
}`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    })

    // Extract text content
    const textContent = response.content.find((block) => block.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude')
    }

    // Parse JSON response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No JSON found in response')
    }

    const parsed = JSON.parse(jsonMatch[0])

    return {
      type: parsed.type || 'stylistic',
      significance: Math.min(10, Math.max(1, parseInt(parsed.significance, 10) || 5)),
      generalizability: Math.min(10, Math.max(1, parseInt(parsed.generalizability, 10) || 5)),
      explanation: parsed.explanation || 'Edit classification failed',
    }
  } catch (error) {
    console.error('[AnalyzeEdits] Classification error:', error)

    // Fallback classification
    return {
      type: 'stylistic',
      significance: 5,
      generalizability: 5,
      explanation: 'Automatische Klassifikation fehlgeschlagen.',
    }
  }
}

/**
 * GET /api/admin/analyze-edits
 *
 * Get stats about edit analysis
 */
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    // Get counts
    const { count: totalHistory } = await supabase
      .from('edit_history')
      .select('*', { count: 'exact', head: true })

    const { count: analyzedHistory } = await supabase
      .from('edit_history')
      .select('*', { count: 'exact', head: true })
      .not('analysis_completed_at', 'is', null)

    const { count: totalDiffs } = await supabase
      .from('edit_diffs')
      .select('*', { count: 'exact', head: true })

    // Get diff type distribution
    const { data: typeDistribution } = await supabase
      .from('edit_diffs')
      .select('edit_type')

    const typeCounts: Record<string, number> = {}
    if (typeDistribution) {
      for (const row of typeDistribution) {
        const type = row.edit_type || 'unknown'
        typeCounts[type] = (typeCounts[type] || 0) + 1
      }
    }

    return NextResponse.json({
      totalHistory: totalHistory || 0,
      analyzedHistory: analyzedHistory || 0,
      pendingHistory: (totalHistory || 0) - (analyzedHistory || 0),
      totalDiffs: totalDiffs || 0,
      typeDistribution: typeCounts,
    })
  } catch (error) {
    console.error('[AnalyzeEdits] Stats error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
