import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getActiveLearnedPatterns } from '@/lib/edit-learning/retrieval'
import {
  detectPatternsInContent,
  type DetectedPatternMatch,
} from '@/lib/edit-learning/pattern-detection'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface TipTapNode {
  type: string
  content?: TipTapNode[]
  text?: string
  attrs?: Record<string, unknown>
}

/**
 * POST /api/admin/store-applied-patterns
 *
 * Detects where learned patterns were applied in generated content
 * and stores them for inline highlighting in the editor.
 *
 * Body:
 * - postId: The post ID
 * - content: TipTap JSON content
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { postId, content } = body

    if (!postId || !content) {
      return NextResponse.json(
        { error: 'postId and content are required' },
        { status: 400 }
      )
    }

    // Get active patterns
    const patterns = await getActiveLearnedPatterns(0.4, 30)

    if (patterns.length === 0) {
      return NextResponse.json({
        message: 'No active patterns found',
        matchesFound: 0,
        matchesStored: 0,
      })
    }

    console.log(`[StoreAppliedPatterns] Checking ${patterns.length} patterns for post ${postId}`)

    // Detect patterns in content
    const matches = detectPatternsInContent(content as TipTapNode, patterns)

    if (matches.length === 0) {
      return NextResponse.json({
        message: 'No pattern matches found in content',
        patternsChecked: patterns.length,
        matchesFound: 0,
        matchesStored: 0,
      })
    }

    console.log(`[StoreAppliedPatterns] Found ${matches.length} pattern matches`)

    // Store matches in applied_patterns
    const records = matches.map((m: DetectedPatternMatch) => ({
      post_id: postId,
      pattern_id: m.patternId,
      paragraph_index: m.paragraphIndex,
      sentence_index: null,
      char_start: m.charStartInParagraph,
      char_end: m.charEndInParagraph,
      actually_written: m.matchedText,
      would_have_written: m.pattern.original_form || null,
    }))

    // Delete existing applied patterns for this post (in case of re-generation)
    await supabase
      .from('applied_patterns')
      .delete()
      .eq('post_id', postId)

    // Insert new matches
    const { error: insertError } = await supabase
      .from('applied_patterns')
      .insert(records)

    if (insertError) {
      console.error('[StoreAppliedPatterns] Insert error:', insertError)
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      )
    }

    console.log(`[StoreAppliedPatterns] Stored ${records.length} applied patterns`)

    return NextResponse.json({
      message: `Found and stored ${matches.length} pattern matches`,
      patternsChecked: patterns.length,
      matchesFound: matches.length,
      matchesStored: records.length,
      patterns: matches.map((m: DetectedPatternMatch) => ({
        patternId: m.patternId,
        matchedText: m.matchedText,
        originalForm: m.pattern.original_form,
        preferredForm: m.pattern.preferred_form,
      })),
    })
  } catch (error) {
    console.error('[StoreAppliedPatterns] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
