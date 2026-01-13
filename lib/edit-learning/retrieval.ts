/**
 * Pattern and Example Retrieval for Edit Learning
 *
 * Functions to retrieve learned patterns and examples for use in
 * Ghostwriter generation, with confidence decay and recency weighting.
 */

import { createClient } from '@supabase/supabase-js'
import { generateEmbedding } from '@/lib/embeddings/generator'

// Use service role for server-side operations
const getSupabase = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

export interface LearnedPattern {
  id: string
  pattern_type: 'replacement' | 'avoidance' | 'preference' | 'structure' | 'tone'
  original_form: string | null
  preferred_form: string | null
  context_description: string | null
  trigger_pattern: string | null
  confidence_score: number
  times_applied: number
  last_applied_at: string | null
  is_active: boolean
}

export interface EditExample {
  id: string
  context_text: string | null
  original_text: string
  edited_text: string
  example_type: string
  quality_score: number | null
  similarity?: number
}

/**
 * Calculate effective confidence with time decay
 *
 * Confidence decays by ~5% per week since last applied.
 * This ensures recent patterns are prioritized over stale ones.
 */
export function calculateEffectiveConfidence(pattern: LearnedPattern): number {
  const baseConfidence = pattern.confidence_score

  if (!pattern.last_applied_at) {
    // Never applied - use base confidence with slight penalty
    return baseConfidence * 0.9
  }

  const daysSinceApplied = Math.floor(
    (Date.now() - new Date(pattern.last_applied_at).getTime()) / (1000 * 60 * 60 * 24)
  )

  // Decay factor: 0.95^weeks (halves roughly every 14 weeks)
  const decayFactor = Math.pow(0.95, daysSinceApplied / 7)

  // Freshness bonus for recently created patterns
  const createdDaysAgo = pattern.last_applied_at
    ? Math.floor(
        (Date.now() - new Date(pattern.last_applied_at).getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : 30
  const freshnessBonus = createdDaysAgo < 14 ? 1.05 : 1.0

  return Math.min(1.0, baseConfidence * decayFactor * freshnessBonus)
}

/**
 * Get all active learned patterns, sorted by effective confidence
 *
 * @param minConfidence Minimum base confidence (default: 0.4)
 * @param limit Maximum patterns to return (default: 30)
 */
export async function getActiveLearnedPatterns(
  minConfidence: number = 0.4,
  limit: number = 30
): Promise<LearnedPattern[]> {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('learned_patterns')
    .select('*')
    .eq('is_active', true)
    .gte('confidence_score', minConfidence)
    .order('confidence_score', { ascending: false })
    .limit(limit * 2) // Fetch extra to account for decay filtering

  if (error) {
    console.error('[Retrieval] Failed to fetch patterns:', error)
    return []
  }

  if (!data) return []

  // Calculate effective confidence and filter
  const patternsWithEffectiveConfidence = data
    .map((p) => ({
      ...p,
      effectiveConfidence: calculateEffectiveConfidence(p),
    }))
    .filter((p) => p.effectiveConfidence >= 0.3) // Filter out decayed patterns
    .sort((a, b) => b.effectiveConfidence - a.effectiveConfidence)
    .slice(0, limit)

  return patternsWithEffectiveConfidence
}

/**
 * Find similar edit examples using embedding similarity
 *
 * @param contentSnippet Text to find similar examples for
 * @param limit Maximum examples to return
 * @param minQuality Minimum quality score
 */
export async function findSimilarEditExamples(
  contentSnippet: string,
  limit: number = 5,
  minQuality: number = 6
): Promise<EditExample[]> {
  const supabase = getSupabase()

  try {
    // Generate embedding for the content
    const embedding = await generateEmbedding(contentSnippet.slice(0, 2000))

    // Use pgvector similarity search
    const { data, error } = await supabase.rpc('find_similar_edit_examples', {
      query_embedding: embedding,
      match_threshold: 0.6,
      match_count: limit,
      min_quality: minQuality,
    })

    if (error) {
      console.error('[Retrieval] Similarity search failed:', error)
      return []
    }

    return data || []
  } catch (err) {
    console.error('[Retrieval] Error finding similar examples:', err)
    return []
  }
}

/**
 * Find patterns that match specific trigger keywords in content
 *
 * @param content Content to search for triggers
 * @param limit Maximum patterns to return
 */
export async function findMatchingPatterns(
  content: string,
  limit: number = 20
): Promise<LearnedPattern[]> {
  const supabase = getSupabase()

  // Get all active patterns with trigger patterns
  const { data, error } = await supabase
    .from('learned_patterns')
    .select('*')
    .eq('is_active', true)
    .not('trigger_pattern', 'is', null)
    .gte('confidence_score', 0.4)

  if (error || !data) {
    console.error('[Retrieval] Failed to fetch patterns for matching:', error)
    return []
  }

  const contentLower = content.toLowerCase()
  const matchingPatterns: LearnedPattern[] = []

  for (const pattern of data) {
    if (!pattern.trigger_pattern) continue

    try {
      // Check if trigger pattern matches
      const regex = new RegExp(pattern.trigger_pattern, 'gi')
      if (regex.test(contentLower)) {
        matchingPatterns.push(pattern)
      }
    } catch {
      // Invalid regex, try simple string match
      if (contentLower.includes(pattern.trigger_pattern.toLowerCase())) {
        matchingPatterns.push(pattern)
      }
    }
  }

  // Sort by effective confidence and limit
  return matchingPatterns
    .map((p) => ({
      ...p,
      effectiveConfidence: calculateEffectiveConfidence(p),
    }))
    .sort((a, b) => (b as { effectiveConfidence: number }).effectiveConfidence - (a as { effectiveConfidence: number }).effectiveConfidence)
    .slice(0, limit)
}

/**
 * Track that patterns were used in a generation
 *
 * @param patternIds Array of pattern IDs that were used
 */
export async function trackPatternUsage(patternIds: string[]): Promise<void> {
  if (patternIds.length === 0) return

  const supabase = getSupabase()

  const { error } = await supabase.rpc('increment_pattern_usage', {
    pattern_ids: patternIds,
  })

  if (error) {
    console.error('[Retrieval] Failed to track pattern usage:', error)
  }
}

/**
 * Record that a pattern was applied to a specific post
 *
 * @param postId The post ID
 * @param patternId The pattern ID
 * @param position Position info for highlighting
 * @param text The actual text that was written
 */
export async function recordAppliedPattern(
  postId: string,
  patternId: string,
  position: {
    paragraphIndex: number
    sentenceIndex?: number
    charStart?: number
    charEnd?: number
  },
  wouldHaveWritten: string | null,
  actuallyWritten: string
): Promise<void> {
  const supabase = getSupabase()

  const { error } = await supabase.from('applied_patterns').insert({
    post_id: postId,
    pattern_id: patternId,
    paragraph_index: position.paragraphIndex,
    sentence_index: position.sentenceIndex,
    char_start: position.charStart,
    char_end: position.charEnd,
    would_have_written: wouldHaveWritten,
    actually_written: actuallyWritten,
  })

  if (error) {
    console.error('[Retrieval] Failed to record applied pattern:', error)
  }
}

/**
 * Get applied patterns for a post (for editor highlighting)
 *
 * @param postId The post ID
 */
export async function getAppliedPatternsForPost(
  postId: string
): Promise<
  Array<{
    id: string
    pattern_id: string
    paragraph_index: number
    sentence_index: number | null
    char_start: number | null
    char_end: number | null
    would_have_written: string | null
    actually_written: string
    user_accepted: boolean | null
    pattern: LearnedPattern | null
  }>
> {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('applied_patterns')
    .select(
      `
      *,
      pattern:learned_patterns(*)
    `
    )
    .eq('post_id', postId)
    .order('paragraph_index', { ascending: true })

  if (error) {
    console.error('[Retrieval] Failed to fetch applied patterns:', error)
    return []
  }

  return data || []
}

/**
 * Build prompt enhancement section from patterns and examples
 *
 * @param patterns Active patterns to include
 * @param examples Relevant examples to include
 */
export function buildPromptEnhancement(
  patterns: LearnedPattern[],
  examples: EditExample[]
): string {
  if (patterns.length === 0 && examples.length === 0) {
    return ''
  }

  const sections: string[] = []

  // Add patterns section
  if (patterns.length > 0) {
    sections.push('## GELERNTE STILPRÄFERENZEN')
    sections.push('Diese Muster wurden aus vergangenen Korrekturen extrahiert:')
    sections.push('')

    for (const p of patterns) {
      if (p.pattern_type === 'replacement' && p.original_form && p.preferred_form) {
        let line = `- Statt "${p.original_form}" verwende "${p.preferred_form}"`
        if (p.context_description) {
          line += ` (${p.context_description})`
        }
        sections.push(line)
      } else if (p.pattern_type === 'avoidance' && p.original_form) {
        sections.push(`- Vermeide: "${p.original_form}"`)
      } else if (p.pattern_type === 'preference' && p.preferred_form) {
        let line = `- Bevorzuge: ${p.preferred_form}`
        if (p.context_description) {
          line += ` (${p.context_description})`
        }
        sections.push(line)
      } else if (p.pattern_type === 'tone' && p.context_description) {
        sections.push(`- Tonalität: ${p.context_description}`)
      } else if (p.pattern_type === 'structure' && p.context_description) {
        sections.push(`- Struktur: ${p.context_description}`)
      }
    }
  }

  // Add examples section
  if (examples.length > 0) {
    sections.push('')
    sections.push('## BEISPIELE FÜR GUTEN STIL')
    sections.push('Hier sind Beispiele für präferierten Schreibstil:')
    sections.push('')

    for (const ex of examples.slice(0, 3)) {
      // Limit to top 3
      sections.push(`**Vorher:** "${ex.original_text}"`)
      sections.push(`**Nachher:** "${ex.edited_text}"`)
      sections.push('')
    }
  }

  return sections.join('\n')
}
