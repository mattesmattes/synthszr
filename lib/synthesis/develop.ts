/**
 * Synthesis Development Service
 * Uses Claude Opus (via Max Plan) for high-quality synthesis generation
 */

import Anthropic from '@anthropic-ai/sdk'
import { ScoredCandidate } from './score'

export interface DevelopedSynthesis {
  candidateId?: string
  headline: string
  content: string
  historicalReference: string
  coreThesisAlignment: number
}

interface ParsedSynthesis {
  headline: string
  synthese: string
  referenz: string
}

/**
 * Parse the structured synthesis response from Claude
 */
function parseSynthesisResponse(text: string): ParsedSynthesis {
  const headlineMatch = text.match(/HEADLINE:\s*(.+?)(?:\n|$)/i)
  const syntheseMatch = text.match(/SYNTHESE:\s*([\s\S]+?)(?=REFERENZ:|$)/i)
  const referenzMatch = text.match(/REFERENZ:\s*(.+?)(?:\n|$)/i)

  return {
    headline: headlineMatch?.[1]?.trim() || 'Synthese',
    synthese: syntheseMatch?.[1]?.trim() || text,
    referenz: referenzMatch?.[1]?.trim() || '',
  }
}

/**
 * Estimate how well the synthesis aligns with the core thesis
 * Uses simple keyword matching as a heuristic
 */
function estimateThesisAlignment(synthesis: string, coreThesis: string): number {
  if (!coreThesis) return 5

  const thesisKeywords = [
    'synthese',
    'kombination',
    'bereiche',
    'marketing',
    'design',
    'business',
    'code',
    'wertschöpfung',
    'transformation',
    'neu',
    'produkt',
    'service',
  ]

  const synthesisLower = synthesis.toLowerCase()
  let matches = 0

  for (const keyword of thesisKeywords) {
    if (synthesisLower.includes(keyword)) {
      matches++
    }
  }

  // Scale to 0-10
  return Math.min(10, Math.round((matches / thesisKeywords.length) * 15))
}

/**
 * Develop a single synthesis using Claude Opus
 */
export async function developSynthesis(
  candidate: ScoredCandidate,
  developmentPrompt: string,
  coreThesis: string
): Promise<DevelopedSynthesis> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const currentNews = `${candidate.sourceItem.title}\n\n${candidate.sourceItem.content.slice(0, 2000)}`
  const historicalNews = `${candidate.relatedItem.title}\n\n${candidate.relatedItem.content.slice(0, 2000)}`

  const prompt = developmentPrompt
    .replace('{current_news}', currentNews)
    .replace('{historical_news}', historicalNews)
    .replace('{days_ago}', String(candidate.daysAgo))
    .replace('{synthesis_type}', candidate.synthesisType)
    .replace('{core_thesis}', coreThesis)

  console.log(`[Synthesis] Developing synthesis for "${candidate.sourceItem.title.slice(0, 50)}..."`)

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const text =
    response.content[0].type === 'text' ? response.content[0].text : ''

  const parsed = parseSynthesisResponse(text)
  const alignment = estimateThesisAlignment(parsed.synthese, coreThesis)

  return {
    headline: parsed.headline,
    content: parsed.synthese,
    historicalReference: parsed.referenz,
    coreThesisAlignment: alignment,
  }
}

/**
 * Develop syntheses for multiple candidates
 * Processes sequentially to respect API rate limits for Opus
 */
export async function developSyntheses(
  candidates: ScoredCandidate[],
  developmentPrompt: string,
  coreThesis: string,
  options: {
    maxSyntheses?: number
    delayMs?: number
  } = {}
): Promise<Map<string, DevelopedSynthesis>> {
  const { maxSyntheses = 5, delayMs = 1000 } = options

  const results = new Map<string, DevelopedSynthesis>()
  const toProcess = candidates.slice(0, maxSyntheses)

  for (let i = 0; i < toProcess.length; i++) {
    const candidate = toProcess[i]

    try {
      const synthesis = await developSynthesis(
        candidate,
        developmentPrompt,
        coreThesis
      )

      // Use a composite key: sourceItemId-relatedItemId
      const key = `${candidate.sourceItem.id}-${candidate.relatedItem.id}`
      results.set(key, {
        ...synthesis,
        candidateId: key,
      })

      console.log(`[Synthesis] Developed ${i + 1}/${toProcess.length}: "${synthesis.headline}"`)
    } catch (error) {
      console.error(`[Synthesis] Failed to develop synthesis:`, error)
    }

    // Delay between requests for Opus
    if (i < toProcess.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return results
}
