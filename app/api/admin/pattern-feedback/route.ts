import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * POST /api/admin/pattern-feedback
 *
 * Handle user feedback on applied patterns:
 * - Accept: Increases pattern confidence
 * - Reject: Decreases confidence, potentially deactivates pattern
 * - Deactivate: Immediately deactivates the pattern
 *
 * Body:
 * - appliedPatternId: The applied_patterns record ID
 * - action: 'accept' | 'reject' | 'deactivate'
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { appliedPatternId, action } = body

    if (!appliedPatternId) {
      return NextResponse.json(
        { error: 'appliedPatternId is required' },
        { status: 400 }
      )
    }

    if (!['accept', 'reject', 'deactivate'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be accept, reject, or deactivate' },
        { status: 400 }
      )
    }

    // Get the applied pattern to find the pattern_id
    const { data: appliedPattern, error: fetchError } = await supabase
      .from('applied_patterns')
      .select('id, pattern_id, user_accepted')
      .eq('id', appliedPatternId)
      .single()

    if (fetchError || !appliedPattern) {
      return NextResponse.json(
        { error: 'Applied pattern not found' },
        { status: 404 }
      )
    }

    const patternId = appliedPattern.pattern_id

    if (action === 'deactivate') {
      // Immediately deactivate the pattern
      const { error: deactivateError } = await supabase
        .from('learned_patterns')
        .update({
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', patternId)

      if (deactivateError) {
        return NextResponse.json(
          { error: deactivateError.message },
          { status: 500 }
        )
      }

      // Also record the rejection on the applied pattern
      await supabase
        .from('applied_patterns')
        .update({
          user_accepted: false,
          feedback_at: new Date().toISOString(),
        })
        .eq('id', appliedPatternId)

      return NextResponse.json({
        success: true,
        action: 'deactivate',
        message: 'Pattern deactivated',
      })
    }

    // Use the stored function for accept/reject
    const { error: feedbackError } = await supabase.rpc('handle_pattern_feedback', {
      p_applied_pattern_id: appliedPatternId,
      p_accepted: action === 'accept',
    })

    if (feedbackError) {
      return NextResponse.json(
        { error: feedbackError.message },
        { status: 500 }
      )
    }

    // Get updated pattern confidence
    const { data: updatedPattern } = await supabase
      .from('learned_patterns')
      .select('confidence_score, is_active')
      .eq('id', patternId)
      .single()

    return NextResponse.json({
      success: true,
      action,
      patternId,
      newConfidence: updatedPattern?.confidence_score,
      isActive: updatedPattern?.is_active,
    })
  } catch (error) {
    console.error('[PatternFeedback] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/admin/pattern-feedback?postId=...
 *
 * Get all applied patterns for a post (for highlighting in editor)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const postId = searchParams.get('postId')

    if (!postId) {
      return NextResponse.json(
        { error: 'postId is required' },
        { status: 400 }
      )
    }

    // Fetch applied patterns with their pattern details
    const { data, error } = await supabase
      .from('applied_patterns')
      .select(`
        id,
        paragraph_index,
        sentence_index,
        char_start,
        char_end,
        would_have_written,
        actually_written,
        user_accepted,
        feedback_at,
        pattern:learned_patterns(
          id,
          pattern_type,
          original_form,
          preferred_form,
          context_description,
          confidence_score,
          is_active
        )
      `)
      .eq('post_id', postId)
      .order('paragraph_index', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      postId,
      appliedPatterns: data || [],
    })
  } catch (error) {
    console.error('[PatternFeedback] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
