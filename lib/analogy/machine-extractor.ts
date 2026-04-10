/**
 * Machine Extractor
 *
 * Claude analyzes a blog post section and generates a JSON processing script
 * for the "The Machine" terminal animation:
 * - Text flows in as data stream
 * - Keywords get highlighted
 * - Numbers are extracted and isolated
 * - Irrelevant text is struck through and faded
 * - Distilled take builds up line by line
 */

import Anthropic from '@anthropic-ai/sdk'
import { repairAndParseJSON } from './json-repair'

/**
 * A single processing step in the terminal animation
 */
export interface MachineStep {
  type: 'stream_in'      // Text flows in character by character
      | 'highlight'       // Keywords get colored
      | 'extract_number'  // Number gets pulled out and displayed large
      | 'strike'          // Text gets struck through and faded
      | 'build_take'      // Distilled take appears line by line
      | 'pause'           // Brief pause for effect
  text: string            // The affected text content
  color?: string          // For highlights: green, cyan, yellow, red
  delay_ms?: number       // Duration of this step in ms
}

export interface MachineScript {
  title: string           // Source post title
  sourceText: string      // Original blog section text
  steps: MachineStep[]    // Ordered processing steps
  take: string            // Final distilled take (what remains)
  estimatedDuration: number // Total estimated duration in seconds
}

function mapScript(item: Record<string, unknown>, fallbackTitle: string): MachineScript {
  return {
    title: String(item.title || fallbackTitle),
    sourceText: String(item.sourceText || item.source_text || ''),
    steps: (item.steps as MachineStep[]).map(s => ({
      type: s.type,
      text: String(s.text || ''),
      color: s.color,
      delay_ms: s.delay_ms || 400,
    })),
    take: String(item.take),
    estimatedDuration: Number(item.estimatedDuration || item.estimated_duration) || 20,
  }
}

/**
 * Generate a Machine processing script from a blog post section.
 * Claude acts as the "processing engine" that decides what to highlight,
 * strike, and distill.
 */
export async function generateMachineScript(
  postContent: string,
  postTitle: string,
  maxScripts: number = 2
): Promise<MachineScript[]> {
  const anthropic = new Anthropic()

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: `You are "The Machine" — an AI that processes news. Analyze the blog article and create ${maxScripts} processing scripts for terminal animations.

IMPORTANT: ALL text output must be in ENGLISH. Translate any German source material.

Each animation shows how you process a text section:
1. **stream_in**: The translated English text flows in (like terminal output)
2. **highlight**: Key terms get color-marked (green=positive, cyan=tech, yellow=important, red=critical)
3. **extract_number**: Numbers/percentages get pulled out large
4. **strike**: Irrelevant phrases get struck through (marketing fluff, filler words, redundancies)
5. **build_take**: The distilled take builds up line by line (max 3 lines, like a commit message)
6. **pause**: Brief pause for effect (200-500ms)

Per script:
- Pick a compelling section (3-5 sentences) from the article
- Translate it to English for the stream_in text
- The section must be self-contained
- The take at the end is your distilled judgment (sharp, punchy, max 2-3 lines, in English)
- Total duration: 15-25 seconds
- Timing: stream_in ~3000ms, highlights ~300ms each, strike ~400ms each, build_take ~800ms per line

Reply as JSON array of MachineScript objects:
[{
  "title": "Article Title in English",
  "sourceText": "The section translated to English",
  "steps": [
    { "type": "stream_in", "text": "Full section in English...", "delay_ms": 3000 },
    { "type": "highlight", "text": "keyword", "color": "cyan", "delay_ms": 300 },
    { "type": "extract_number", "text": "42%", "delay_ms": 600 },
    { "type": "strike", "text": "irrelevant phrase", "delay_ms": 400 },
    { "type": "pause", "text": "", "delay_ms": 400 },
    { "type": "build_take", "text": "First line of take", "delay_ms": 800 },
    { "type": "build_take", "text": "Second line", "delay_ms": 800 }
  ],
  "take": "The full distilled take in English",
  "estimatedDuration": 18
}]

JSON ONLY. No markdown, no explanation.

Article title: ${postTitle}

Article content:
${postContent}`
      }
    ],
  })

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('')

  console.log('[MachineExtractor] Raw response length:', text.length, 'chars')
  console.log('[MachineExtractor] Response preview:', text.slice(0, 300))

  try {
    const parsed = repairAndParseJSON(text)
    console.log(`[MachineExtractor] Parsed ${parsed.length} scripts`)

    return (parsed as Record<string, unknown>[])
      .filter((item) => {
        const valid = item.steps && Array.isArray(item.steps) && item.take
        if (!valid) console.log('[MachineExtractor] Skipping invalid item:', Object.keys(item))
        return valid
      })
      .slice(0, maxScripts)
      .map((item) => mapScript(item, postTitle))
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[MachineExtractor] JSON parse failed:', msg)
    console.error('[MachineExtractor] Full response:', text.slice(0, 1000))
    throw new Error(`Machine script parse error: ${msg}. Response: ${text.slice(0, 200)}`)
  }
}
