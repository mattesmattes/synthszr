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
  historicalReference: string | null  // null for content-only syntheses
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

// Version marker for deployment verification
const SYNTHESIS_VERSION = 'v6-debug'

/**
 * Helper: Hard timeout wrapper using Promise.race
 * This is a last-resort safety net when AbortController doesn't work
 */
function withHardTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallbackValue: T,
  label: string = 'unknown'
): Promise<T> {
  let settled = false

  const wrappedPromise = promise
    .then((result) => {
      settled = true
      console.log(`[Synthesis ${SYNTHESIS_VERSION}] Promise resolved for: ${label}`)
      return result
    })
    .catch((error) => {
      settled = true
      console.log(`[Synthesis ${SYNTHESIS_VERSION}] Promise rejected for: ${label}`, error)
      return fallbackValue
    })

  const timeoutPromise = new Promise<T>((resolve) => {
    setTimeout(() => {
      if (!settled) {
        console.log(`[Synthesis ${SYNTHESIS_VERSION}] HARD TIMEOUT after ${timeoutMs}ms for: ${label}`)
        resolve(fallbackValue)
      }
    }, timeoutMs)
  })

  return Promise.race([wrappedPromise, timeoutPromise])
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
  timeoutMs: number = 10000 // 10 second timeout
): Promise<DevelopedSynthesis> {
  const itemLabel = candidate.sourceItem.title.slice(0, 30)
  console.log(`[Synthesis ${SYNTHESIS_VERSION}] START: "${itemLabel}"`)

  const fallbackSynthesis: DevelopedSynthesis = {
    headline: `Timeout: ${candidate.synthesisType}`,
    content: `Timeout bei "${candidate.sourceItem.title.slice(0, 50)}"`,
    historicalReference: candidate.relatedItem.title,
    coreThesisAlignment: 0,
  }

  // Hard timeout at 12s guarantees we never wait longer
  const result = await withHardTimeout(
    developSynthesisInternal(candidate, developmentPrompt, coreThesis, timeoutMs),
    12000, // 12s hard timeout
    fallbackSynthesis,
    itemLabel
  )

  console.log(`[Synthesis ${SYNTHESIS_VERSION}] END: "${itemLabel}" -> ${result.headline.slice(0, 30)}`)
  return result
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
    timeout: 11000, // SDK timeout at 11s
  })

  const currentNews = `${candidate.sourceItem.title}\n\n${candidate.sourceItem.content.slice(0, 2000)}`
  const historicalNews = `${candidate.relatedItem.title}\n\n${candidate.relatedItem.content.slice(0, 2000)}`

  const prompt = developmentPrompt
    .replace('{current_news}', currentNews)
    .replace('{historical_news}', historicalNews)
    .replace('{days_ago}', String(candidate.daysAgo))
    .replace('{synthesis_type}', candidate.synthesisType)
    .replace('{core_thesis}', coreThesis)

  console.log(`[Synthesis] >>> CALLING ANTHROPIC API...`)

  try {
    const response = await anthropic.messages.create(
      {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal }
    )

    console.log(`[Synthesis] <<< API RETURNED`)
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
 * Develop a content-only synthesis (no historical reference)
 * Used as fallback when no similar historical articles are found
 */
export async function developContentSynthesis(
  article: { id: string; title: string; content: string },
  developmentPrompt: string,
  coreThesis: string,
  timeoutMs: number = 10000
): Promise<DevelopedSynthesis> {
  const itemLabel = article.title.slice(0, 30)
  console.log(`[Synthesis ${SYNTHESIS_VERSION}] START content-only: "${itemLabel}"`)

  const fallbackSynthesis: DevelopedSynthesis = {
    headline: `Timeout: Content-Synthese`,
    content: `Timeout bei "${article.title.slice(0, 50)}"`,
    historicalReference: '',
    coreThesisAlignment: 0,
  }

  const result = await withHardTimeout(
    developContentSynthesisInternal(article, developmentPrompt, coreThesis, timeoutMs),
    12000,
    fallbackSynthesis,
    itemLabel
  )

  console.log(`[Synthesis ${SYNTHESIS_VERSION}] END content-only: "${itemLabel}" -> ${result.headline.slice(0, 30)}`)
  return result
}

/**
 * Internal implementation of content-only synthesis
 */
async function developContentSynthesisInternal(
  article: { id: string; title: string; content: string },
  developmentPrompt: string,
  coreThesis: string,
  timeoutMs: number
): Promise<DevelopedSynthesis> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    console.log(`[Synthesis] Aborting content synthesis after ${timeoutMs}ms timeout`)
    controller.abort()
  }, timeoutMs)

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 11000,
  })

  const currentNews = `${article.title}\n\n${article.content.slice(0, 2000)}`

  const prompt = developmentPrompt
    .replace('{current_news}', currentNews)
    .replace('{core_thesis}', coreThesis)

  console.log(`[Synthesis] >>> CALLING ANTHROPIC API for content synthesis...`)

  try {
    const response = await anthropic.messages.create(
      {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal }
    )

    console.log(`[Synthesis] <<< API RETURNED for content synthesis`)
    clearTimeout(timeoutId)

    const text =
      response.content[0].type === 'text' ? response.content[0].text : ''

    const parsed = parseContentSynthesisResponse(text)
    const alignment = estimateThesisAlignment(parsed.synthese, coreThesis)

    console.log(`[Synthesis] Content synthesis developed: "${parsed.headline.slice(0, 40)}..."`)

    return {
      headline: parsed.headline,
      content: parsed.synthese,
      historicalReference: '', // No historical reference for content-only syntheses
      coreThesisAlignment: alignment,
    }
  } catch (error) {
    clearTimeout(timeoutId)

    const isAborted = error instanceof Error && error.name === 'AbortError'
    const errorType = isAborted ? 'Timeout' : 'API error'
    console.error(`[Synthesis] Content synthesis ${errorType}:`, isAborted ? `Aborted after ${timeoutMs}ms` : error)

    return {
      headline: `Insight: ${article.title.slice(0, 30)}`,
      content: `Synthese für "${article.title.slice(0, 50)}" konnte nicht entwickelt werden (${errorType}).`,
      historicalReference: '',
      coreThesisAlignment: 0,
    }
  }
}

/**
 * Parse content synthesis response (simplified - no REFERENZ field expected)
 */
function parseContentSynthesisResponse(text: string): { headline: string; synthese: string } {
  const headlineMatch = text.match(/HEADLINE:\s*(.+?)(?:\n|$)/i)
  const syntheseMatch = text.match(/SYNTHESE:\s*([\s\S]+?)(?=HEADLINE:|$)/i)

  // Handle case where SYNTHESE comes before HEADLINE
  let synthese = syntheseMatch?.[1]?.trim()
  if (!synthese) {
    // Try matching everything after HEADLINE as the synthesis
    const afterHeadline = text.match(/HEADLINE:\s*.+?\n([\s\S]+)/i)
    synthese = afterHeadline?.[1]?.trim() || text
  }

  return {
    headline: headlineMatch?.[1]?.trim() || 'Synthese',
    synthese: synthese || text,
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
