import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings/generator'
import { parseIntParam, parseFloatParam } from '@/lib/validation/query-params'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

interface EditDiff {
  id: string
  original_text: string
  edited_text: string
  edit_type: string
  embedding: number[] | null
  generalizability_score: number
  pattern_explanation: string | null
}

interface ExtractedPattern {
  pattern_type: 'replacement' | 'avoidance' | 'preference' | 'structure' | 'tone'
  original_form: string | null
  preferred_form: string | null
  context_description: string
  trigger_pattern: string | null
  confidence: number
}

/**
 * POST /api/cron/extract-patterns
 *
 * Extracts patterns from similar edit diffs:
 * 1. Fetches generalizable diffs from the last N days
 * 2. Clusters similar diffs by embedding
 * 3. For clusters with 3+ examples, extracts a pattern
 * 4. Checks for contradictions with existing patterns
 * 5. Stores new patterns
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const daysBack = parseIntParam(searchParams.get('days'), 30, 1, 365)
    const minClusterSize = parseIntParam(searchParams.get('minCluster'), 3, 2, 20)
    const similarityThreshold = parseFloatParam(searchParams.get('threshold'), 0.8, 0.5, 1.0)

    // Calculate date threshold
    const dateThreshold = new Date()
    dateThreshold.setDate(dateThreshold.getDate() - daysBack)

    // Fetch generalizable diffs with embeddings
    const { data: diffs, error: fetchError } = await supabase
      .from('edit_diffs')
      .select('id, original_text, edited_text, edit_type, embedding, generalizability_score, pattern_explanation')
      .gte('created_at', dateThreshold.toISOString())
      .gte('generalizability_score', 6)
      .not('embedding', 'is', null)
      .order('generalizability_score', { ascending: false })
      .limit(500)

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    if (!diffs || diffs.length === 0) {
      return NextResponse.json({
        message: 'No generalizable diffs found',
        patternsExtracted: 0,
      })
    }

    console.log(`[ExtractPatterns] Analyzing ${diffs.length} diffs`)

    // Parse embeddings
    const diffsWithParsedEmbeddings = diffs.map((d) => ({
      ...d,
      embedding: parseEmbedding(d.embedding),
    })).filter((d) => d.embedding !== null) as Array<EditDiff & { embedding: number[] }>

    // Cluster similar diffs
    const clusters = clusterByEmbedding(diffsWithParsedEmbeddings, similarityThreshold)

    console.log(`[ExtractPatterns] Found ${clusters.length} clusters`)

    // Process clusters with enough examples
    const largeClusters = clusters.filter((c) => c.length >= minClusterSize)
    console.log(`[ExtractPatterns] ${largeClusters.length} clusters have ${minClusterSize}+ examples`)

    let patternsExtracted = 0
    let patternsSkipped = 0
    const results: Array<{ clusterSize: number; pattern: ExtractedPattern | null; status: string }> = []

    for (const cluster of largeClusters) {
      try {
        // Extract pattern from cluster
        const pattern = await extractPatternFromCluster(cluster)

        if (!pattern || pattern.confidence < 0.6) {
          results.push({ clusterSize: cluster.length, pattern, status: 'low_confidence' })
          patternsSkipped++
          continue
        }

        // Check for contradictions
        const existingConflict = await findContradictingPattern(pattern)

        if (existingConflict) {
          // Compare confidence and handle conflict
          if (pattern.confidence > existingConflict.confidence_score * 1.2) {
            // New pattern wins - deactivate old
            await supabase
              .from('learned_patterns')
              .update({ is_active: false })
              .eq('id', existingConflict.id)

            console.log(`[ExtractPatterns] Deactivated conflicting pattern ${existingConflict.id}`)
          } else {
            // Old pattern wins - skip new
            results.push({ clusterSize: cluster.length, pattern, status: 'conflict_lost' })
            patternsSkipped++
            continue
          }
        }

        // Generate embedding for the pattern
        const patternText = `${pattern.original_form || ''} -> ${pattern.preferred_form || ''} (${pattern.context_description})`
        let patternEmbedding: number[] | null = null

        try {
          patternEmbedding = await generateEmbedding(patternText)
        } catch (err) {
          console.error('[ExtractPatterns] Pattern embedding failed:', err)
        }

        // Store the pattern
        const { error: insertError } = await supabase.from('learned_patterns').insert({
          pattern_type: pattern.pattern_type,
          original_form: pattern.original_form,
          preferred_form: pattern.preferred_form,
          context_description: pattern.context_description,
          trigger_pattern: pattern.trigger_pattern,
          confidence_score: pattern.confidence,
          derived_from_edit_ids: cluster.map((d) => d.id),
          embedding: patternEmbedding ? `[${patternEmbedding.join(',')}]` : null,
          is_active: true,
        })

        if (insertError) {
          console.error('[ExtractPatterns] Failed to insert pattern:', insertError)
          results.push({ clusterSize: cluster.length, pattern, status: 'insert_failed' })
        } else {
          patternsExtracted++
          results.push({ clusterSize: cluster.length, pattern, status: 'created' })
          console.log(`[ExtractPatterns] Created pattern: ${pattern.pattern_type} - ${pattern.original_form} -> ${pattern.preferred_form}`)
        }
      } catch (clusterError) {
        console.error('[ExtractPatterns] Cluster processing error:', clusterError)
        results.push({ clusterSize: cluster.length, pattern: null, status: 'error' })
      }
    }

    return NextResponse.json({
      message: `Processed ${largeClusters.length} clusters`,
      totalDiffs: diffs.length,
      totalClusters: clusters.length,
      largeClusters: largeClusters.length,
      patternsExtracted,
      patternsSkipped,
      results,
    })
  } catch (error) {
    console.error('[ExtractPatterns] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * Parse embedding from database format
 */
function parseEmbedding(embedding: unknown): number[] | null {
  if (!embedding) return null

  if (Array.isArray(embedding)) return embedding

  if (typeof embedding === 'string') {
    try {
      // Handle PostgreSQL array format: [1,2,3] or {1,2,3}
      const cleaned = embedding.replace(/[{}[\]]/g, '')
      return cleaned.split(',').map((n) => parseFloat(n.trim()))
    } catch {
      return null
    }
  }

  return null
}

/**
 * Cluster diffs by embedding similarity
 */
function clusterByEmbedding(
  diffs: Array<EditDiff & { embedding: number[] }>,
  threshold: number
): Array<Array<EditDiff & { embedding: number[] }>> {
  const clusters: Array<Array<EditDiff & { embedding: number[] }>> = []
  const assigned = new Set<string>()

  for (const diff of diffs) {
    if (assigned.has(diff.id)) continue

    // Start new cluster
    const cluster = [diff]
    assigned.add(diff.id)

    // Find similar diffs
    for (const other of diffs) {
      if (assigned.has(other.id)) continue

      const similarity = cosineSimilarity(diff.embedding, other.embedding)
      if (similarity >= threshold) {
        cluster.push(other)
        assigned.add(other.id)
      }
    }

    clusters.push(cluster)
  }

  return clusters
}

/**
 * Extract a pattern from a cluster of similar diffs
 */
async function extractPatternFromCluster(
  cluster: Array<EditDiff & { embedding: number[] }>
): Promise<ExtractedPattern | null> {
  const examples = cluster
    .slice(0, 5)
    .map((d) => `- "${d.original_text}" → "${d.edited_text}"`)
    .join('\n')

  const prompt = `Analysiere diese wiederholten Edits in einem deutschen Tech-Newsletter:

${examples}

Extrahiere ein GENERALISIERBARES Muster:

1. PATTERN_TYPE: Wähle einen:
   - replacement: "Ersetze X durch Y"
   - avoidance: "Vermeide X"
   - preference: "Bevorzuge X gegenüber Y"
   - structure: "Verwende Muster X für Situation Y"
   - tone: "Halte Ton X bei Thema Y"

2. ORIGINAL_FORM: Was die AI typischerweise schreibt (null bei tone/structure)

3. PREFERRED_FORM: Was der Editor bevorzugt (null bei avoidance)

4. CONTEXT: Wann dieses Muster angewendet werden sollte (1-2 Sätze)

5. TRIGGER: Schlüsselwörter/Regex die anzeigen, wann dieses Muster relevant ist (oder null)

6. CONFIDENCE (0-1): Wie sicher bist du, dass dies eine konsistente Präferenz ist?

Antworte im exakten JSON-Format:
{
  "pattern_type": "replacement|avoidance|preference|structure|tone",
  "original_form": "...",
  "preferred_form": "...",
  "context_description": "...",
  "trigger_pattern": "...",
  "confidence": 0.8
}`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })

    const textContent = response.content.find((block) => block.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return null
    }

    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])

    return {
      pattern_type: parsed.pattern_type || 'replacement',
      original_form: parsed.original_form || null,
      preferred_form: parsed.preferred_form || null,
      context_description: parsed.context_description || 'Unbekannter Kontext',
      trigger_pattern: parsed.trigger_pattern || null,
      confidence: Math.min(1, Math.max(0, parseFloat(parsed.confidence) || 0.5)),
    }
  } catch (error) {
    console.error('[ExtractPatterns] Pattern extraction error:', error)
    return null
  }
}

/**
 * Find existing patterns that contradict the new pattern
 */
async function findContradictingPattern(
  newPattern: ExtractedPattern
): Promise<{ id: string; confidence_score: number } | null> {
  if (!newPattern.original_form && !newPattern.preferred_form) return null

  const { data: existing } = await supabase
    .from('learned_patterns')
    .select('id, original_form, preferred_form, confidence_score')
    .eq('is_active', true)
    .eq('pattern_type', newPattern.pattern_type)

  if (!existing) return null

  for (const pattern of existing) {
    // Check if original/preferred are swapped (contradiction)
    if (
      (newPattern.original_form === pattern.preferred_form &&
        newPattern.preferred_form === pattern.original_form) ||
      (newPattern.original_form === pattern.original_form &&
        newPattern.preferred_form !== pattern.preferred_form)
    ) {
      return { id: pattern.id, confidence_score: pattern.confidence_score }
    }
  }

  return null
}

/**
 * GET /api/cron/extract-patterns
 *
 * Get extraction stats
 */
export async function GET() {
  try {
    const { count: totalPatterns } = await supabase
      .from('learned_patterns')
      .select('*', { count: 'exact', head: true })

    const { count: activePatterns } = await supabase
      .from('learned_patterns')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)

    const { data: typeDistribution } = await supabase
      .from('learned_patterns')
      .select('pattern_type')
      .eq('is_active', true)

    const typeCounts: Record<string, number> = {}
    if (typeDistribution) {
      for (const row of typeDistribution) {
        const type = row.pattern_type || 'unknown'
        typeCounts[type] = (typeCounts[type] || 0) + 1
      }
    }

    return NextResponse.json({
      totalPatterns: totalPatterns || 0,
      activePatterns: activePatterns || 0,
      inactivePatterns: (totalPatterns || 0) - (activePatterns || 0),
      typeDistribution: typeCounts,
    })
  } catch (error) {
    console.error('[ExtractPatterns] Stats error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
