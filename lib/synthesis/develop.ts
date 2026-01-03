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
  sourceArticleTitle?: string | null  // Title of the news article this synthesis belongs to
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
 * Helper: Hard timeout wrapper using Promise.race
 * This is a last-resort safety net when AbortController doesn't work
 */
function withHardTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallbackValue: T
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => {
        console.log(`[Synthesis] Hard timeout triggered after ${timeoutMs}ms`)
        resolve(fallbackValue)
      }, timeoutMs)
    }),
  ])
}

/**
 * Develop a single synthesis using Claude Opus with timeout
 * Uses AbortController for proper request cancellation
 * Plus Promise.race as a hard fallback if AbortController fails
 */
export async function developSynthesis(
  candidate: ScoredCandidate,
  developmentPrompt: string,
  coreThesis: string,
  timeoutMs: number = 25000 // 25 second timeout (shorter to ensure we finish before Vercel timeout)
): Promise<DevelopedSynthesis> {
  const fallbackSynthesis: DevelopedSynthesis = {
    headline: `Verbindung: ${candidate.synthesisType}`,
    content: `Zusammenhang zwischen "${candidate.sourceItem.title.slice(0, 50)}" und historischer News konnte nicht entwickelt werden (Timeout).`,
    historicalReference: candidate.relatedItem.title,
    coreThesisAlignment: 0,
  }

  // Wrap the entire operation in a hard timeout as last resort
  return withHardTimeout(
    developSynthesisInternal(candidate, developmentPrompt, coreThesis, timeoutMs),
    timeoutMs + 10000, // Hard timeout 10s after soft timeout
    fallbackSynthesis
  )
}

/**
 * Internal implementation of synthesis development
 */
async function developSynthesisInternal(
  candidate: ScoredCandidate,
  developmentPrompt: string,
  coreThesis: string,
  timeoutMs: number
): Promise<DevelopedSynthesis> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    console.log(`[Synthesis] Aborting request after ${timeoutMs}ms timeout`)
    controller.abort()
  }, timeoutMs)

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: timeoutMs + 5000, // SDK timeout slightly higher than our abort
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

  try {
    const response = await anthropic.messages.create(
      {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal }
    )

    clearTimeout(timeoutId)

    const text =
      response.content[0].type === 'text' ? response.content[0].text : ''

    const parsed = parseSynthesisResponse(text)
    const alignment = estimateThesisAlignment(parsed.synthese, coreThesis)

    console.log(`[Synthesis] Successfully developed: "${parsed.headline.slice(0, 40)}..."`)

    return {
      headline: parsed.headline,
      content: parsed.synthese,
      historicalReference: parsed.referenz,
      coreThesisAlignment: alignment,
    }
  } catch (error) {
    clearTimeout(timeoutId)

    const isAborted = error instanceof Error && error.name === 'AbortError'
    const errorType = isAborted ? 'Timeout' : 'API error'
    console.error(`[Synthesis] ${errorType}:`, isAborted ? `Aborted after ${timeoutMs}ms` : error)

    // Return a fallback synthesis instead of throwing
    return {
      headline: `Verbindung: ${candidate.synthesisType}`,
      content: `Zusammenhang zwischen "${candidate.sourceItem.title.slice(0, 50)}" und historischer News konnte nicht entwickelt werden (${errorType}).`,
      historicalReference: candidate.relatedItem.title,
      coreThesisAlignment: 0,
    }
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
