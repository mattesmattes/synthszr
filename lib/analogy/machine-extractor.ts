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
        content: `Du bist "The Machine" — eine KI, die Nachrichten verarbeitet. Analysiere den Blog-Artikel und erstelle ${maxScripts} Processing-Scripts für Terminal-Animationen.

Jede Animation zeigt, wie du einen Textabschnitt verarbeitest:
1. **stream_in**: Der Originaltext fließt rein (wie ein Terminal-Output)
2. **highlight**: Schlüsselbegriffe werden farbig markiert (green=positiv, cyan=tech, yellow=wichtig, red=kritisch)
3. **extract_number**: Zahlen/Prozente werden groß herausgezogen
4. **strike**: Irrelevante Phrasen werden durchgestrichen (Marketing-Floskeln, Füllwörter, Redundanzen)
5. **build_take**: Der destillierte Take baut sich Zeile für Zeile auf (max 3 Zeilen, wie eine Commit-Message)
6. **pause**: Kurze Pause für Effekt (200-500ms)

Pro Script:
- Wähle einen spannenden Abschnitt (3-5 Sätze) aus dem Artikel
- Der Abschnitt muss eigenständig verständlich sein
- Der Take am Ende ist dein destilliertes Urteil (scharf, pointiert, max 2-3 Zeilen)
- Gesamtdauer: 15-25 Sekunden
- Timing: stream_in ~3000ms, highlights ~300ms each, strike ~400ms each, build_take ~800ms per line

Antworte als JSON-Array von MachineScript-Objekten:
[{
  "title": "Post-Titel",
  "sourceText": "Der Original-Abschnitt",
  "steps": [
    { "type": "stream_in", "text": "Der komplette Abschnitt...", "delay_ms": 3000 },
    { "type": "highlight", "text": "Schlüsselwort", "color": "cyan", "delay_ms": 300 },
    { "type": "extract_number", "text": "42%", "delay_ms": 600 },
    { "type": "strike", "text": "irrelevante Phrase", "delay_ms": 400 },
    { "type": "pause", "text": "", "delay_ms": 400 },
    { "type": "build_take", "text": "Erste Zeile des Takes", "delay_ms": 800 },
    { "type": "build_take", "text": "Zweite Zeile", "delay_ms": 800 }
  ],
  "take": "Der vollständige destillierte Take",
  "estimatedDuration": 18
}]

NUR JSON. Kein Markdown, keine Erklärung.

Artikel-Titel: ${postTitle}

Artikel:
${postContent}`
      }
    ],
  })

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('')

  try {
    const cleaned = text.replace(/^```json?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim()
    const parsed = JSON.parse(cleaned)

    if (!Array.isArray(parsed)) {
      console.error('[MachineExtractor] Response is not an array:', text.slice(0, 200))
      return []
    }

    return parsed
      .filter((item: Record<string, unknown>) =>
        item.steps && Array.isArray(item.steps) && item.take
      )
      .slice(0, maxScripts)
      .map((item: Record<string, unknown>) => ({
        title: String(item.title || postTitle),
        sourceText: String(item.sourceText || ''),
        steps: (item.steps as MachineStep[]).map(s => ({
          type: s.type,
          text: String(s.text || ''),
          color: s.color,
          delay_ms: s.delay_ms || 400,
        })),
        take: String(item.take),
        estimatedDuration: Number(item.estimatedDuration) || 20,
      }))
  } catch (error) {
    console.error('[MachineExtractor] Failed to parse response:', error, text.slice(0, 500))
    return []
  }
}
