import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { getActiveLearnedPatterns } from '@/lib/edit-learning/retrieval'
import {
  detectPatternsInContent,
  matchesToDecorations,
} from '@/lib/edit-learning/pattern-detection'

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
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
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

    // Convert paragraph-relative positions to absolute TipTap positions
    const decorations = matchesToDecorations(content as TipTapNode, matches)

    // Store matches in applied_patterns with absolute positions
    const records = decorations.map((d) => {
      const match = matches.find(
        (m) => m.patternId === d.patternId && m.matchedText === d.matchedText
      )
      return {
        post_id: postId,
        pattern_id: d.patternId,
        paragraph_index: match?.paragraphIndex ?? 0,
        sentence_index: null,
        char_start: d.from,
        char_end: d.to,
        actually_written: d.matchedText,
        would_have_written: d.pattern.original_form || null,
      }
    })

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

    console.log(`[StoreAppliedPatterns] Stored ${records.length} applied patterns (absolute positions)`)

    return NextResponse.json({
      message: `Found and stored ${records.length} pattern matches`,
      patternsChecked: patterns.length,
      matchesFound: matches.length,
      matchesStored: records.length,
      patterns: decorations.map((d) => ({
        patternId: d.patternId,
        matchedText: d.matchedText,
        from: d.from,
        to: d.to,
        originalForm: d.pattern.original_form,
        preferredForm: d.pattern.preferred_form,
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
