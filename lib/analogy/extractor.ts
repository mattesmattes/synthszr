/**
 * Analogy Extractor
 *
 * Uses Claude to extract compelling analogies from Synthszr Takes
 * and generate image prompts for each analogy.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { repairAndParseJSON } from './json-repair'

export interface ExtractedAnalogy {
  analogyText: string
  contextText: string
  imagePrompt: string
  sourceSection: string
}

const DEFAULT_STYLE_SUFFIX = `Hyper-photorealistic 3D marble statues depicting male and female figures from Greek mythology acting out the scene. Photorealistic rendering with extreme detail. Realistic marble texture with veins, imperfections, subtle translucency. Cinematic lighting with dramatic shadows. Museum-quality sculpture appearance. High contrast black and white. No naked female characters. Statues must be in the center of the composition. 9:16 portrait aspect ratio for smartphone/TikTok. Do NOT include ANY text or written language. Logos from companies and known figures like CEOs are okay.`

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
        content: `Analysiere den folgenden Blog-Artikel und extrahiere die ${maxAnalogies} stärksten Aussagen, die sich als kurzes TikTok-Video eignen.

Gesucht sind:
- Pointierte Vergleiche, Analogien oder Metaphern ("wie", "als ob", "wirkt wie")
- Provokante Thesen oder scharfe Beobachtungen aus den "Synthszr Take"-Abschnitten
- Sätze die eigenständig funktionieren — ohne den Kontext des restlichen Artikels
- Falls keine expliziten Analogien vorhanden: Nimm die schärfsten, quotefähigsten Aussagen

Für jede gefundene Stelle liefere:
1. **analogy_text**: Der vollständige Satz aus dem Artikel. Nicht kürzen, nicht umschreiben.
2. **context_text**: Der Tech-Kontext in max 10 Wörtern. Beispiel: "OpenAI plant Werbung in ChatGPT"
3. **image_prompt**: Ein englischer Bildprompt für eine Szene mit 3D-Marmorskulpturen griechischer Mythologie-Figuren, die die Aussage visuell darstellen. Ordne Tech-Akteure griechischen Göttern zu (Zeus=mächtiger CEO, Ikarus=überambitioniertes Startup, Prometheus=Wissensbringer, Athene=strategische Führung). Beschreibe konkret die Pose und Szene der Statuen. Suffix: "${styleSuffix}"
4. **source_section**: Der Absatz, aus dem der Satz stammt.

WICHTIG: Liefere IMMER mindestens ${maxAnalogies} Ergebnisse, auch wenn du die Qualitätsanforderungen etwas lockern musst. Ein brauchbares Ergebnis ist besser als keins.

Antworte NUR als JSON-Array. Kein Markdown, keine Erklärung, keine Code-Fences.

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

  console.log('[AnalogyExtractor] Response length:', text.length, 'preview:', text.slice(0, 200))

  try {
    const parsed = repairAndParseJSON(text) as Record<string, unknown>[]
    console.log(`[AnalogyExtractor] Parsed ${parsed.length} items`)

    return parsed
      .filter((item) => {
        const valid = item.analogy_text
        if (!valid) console.log('[AnalogyExtractor] Skipping item without analogy_text')
        return valid
      })
      .slice(0, maxAnalogies)
      .map((item) => ({
        analogyText: String(item.analogy_text),
        contextText: String(item.context_text || ''),
        imagePrompt: String(item.image_prompt || ''),
        sourceSection: String(item.source_section || ''),
      }))
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[AnalogyExtractor] Parse failed:', msg, 'Response:', text.slice(0, 500))
    throw new Error(`Analogy extraction parse error: ${msg}`)
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
