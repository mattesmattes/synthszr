/**
 * Analogy Extractor
 *
 * Uses Claude to extract compelling analogies from Synthszr Takes
 * and generate image prompts for each analogy.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'

export interface ExtractedAnalogy {
  analogyText: string
  contextText: string
  imagePrompt: string
  sourceSection: string
}

const DEFAULT_STYLE_SUFFIX = `editorial illustration, muted earth tones with one accent color, slight surrealism, clean composition, 16:9 aspect ratio, no text, no watermarks, soft lighting, editorial magazine quality`

/**
 * Get the configured style suffix from settings, or use default
 */
async function getStyleSuffix(): Promise<string> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'analogy_style_suffix')
      .single()
    return data?.value?.suffix || DEFAULT_STYLE_SUFFIX
  } catch {
    return DEFAULT_STYLE_SUFFIX
  }
}

/**
 * Extract analogies from a blog post's content.
 * Returns up to maxAnalogies extracted analogies with image prompts.
 */
export async function extractAnalogies(
  postContent: string,
  postTitle: string,
  maxAnalogies: number = 3
): Promise<ExtractedAnalogy[]> {
  const anthropic = new Anthropic()
  const styleSuffix = await getStyleSuffix()

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `Analysiere den folgenden Blog-Artikel und extrahiere die ${maxAnalogies} besten Analogien oder Metaphern.

Eine gute Analogie ist:
- Ein Vergleich mit "wie", "als ob", "wirkt wie", "erinnert an" oder eine lebhafte Metapher
- Visuell vorstellbar (kann als Bild dargestellt werden)
- Eigenständig verständlich ohne den restlichen Artikel
- Pointiert, überraschend oder witzig

Für jede Analogie liefere:
1. **analogy_text**: Der vollständige Analogie-Satz, wie er im Artikel steht. Kein Kürzen.
2. **context_text**: Ein kurzer Halbsatz (max 10 Wörter), der den Tech-Kontext erklärt. Beispiel: "OpenAI plant Werbung in ChatGPT"
3. **image_prompt**: Ein englischer Bildprompt, der die Analogie als surreales Standbild visualisiert. Beschreibe die Szene konkret und visuell. Keine abstrakten Konzepte. KEIN Text im Bild. Der Prompt endet mit diesem Style-Suffix: "${styleSuffix}"
4. **source_section**: Der Absatz aus dem Artikel, in dem die Analogie vorkommt.

Antworte ausschließlich als JSON-Array. Keine Erklärung, kein Markdown.

Artikel-Titel: ${postTitle}

Artikel-Inhalt:
${postContent}`
      }
    ],
  })

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('')

  try {
    // Parse JSON, handle potential markdown code fences
    const cleaned = text.replace(/^```json?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim()
    const parsed = JSON.parse(cleaned)

    if (!Array.isArray(parsed)) {
      console.error('[AnalogyExtractor] Response is not an array:', text.slice(0, 200))
      return []
    }

    return parsed
      .filter((item: Record<string, unknown>) =>
        item.analogy_text && item.context_text && item.image_prompt
      )
      .slice(0, maxAnalogies)
      .map((item: Record<string, unknown>) => ({
        analogyText: String(item.analogy_text),
        contextText: String(item.context_text),
        imagePrompt: String(item.image_prompt),
        sourceSection: String(item.source_section || ''),
      }))
  } catch (error) {
    console.error('[AnalogyExtractor] Failed to parse response:', error, text.slice(0, 500))
    return []
  }
}

/**
 * Extract plain text from TipTap JSON content.
 * Simplified version — walks the node tree recursively.
 */
export function tiptapToPlainText(content: unknown): string {
  if (!content || typeof content !== 'object') return ''

  const doc = content as { type?: string; content?: unknown[]; text?: string }

  if (doc.type === 'text' && doc.text) {
    return doc.text
  }

  if (!Array.isArray(doc.content)) {
    return doc.text || ''
  }

  const parts: string[] = []
  for (const node of doc.content) {
    const nodeObj = node as { type?: string; content?: unknown[]; text?: string }
    const text = tiptapToPlainText(nodeObj)
    if (text) {
      // Add spacing based on block-level nodes
      if (['paragraph', 'heading', 'blockquote'].includes(nodeObj.type || '')) {
        parts.push(text + '\n\n')
      } else {
        parts.push(text)
      }
    }
  }

  return parts.join('').trim()
}
