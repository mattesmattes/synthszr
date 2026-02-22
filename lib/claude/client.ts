import { streamText } from 'ai'
import { google } from '@ai-sdk/google'

export interface AnalysisResult {
  content: string
  inputTokens: number
  outputTokens: number
}

const SYSTEM_PROMPT = `Du bist ein Kurator, der relevante Inhalte für einen Newsletter SELEKTIERT und DOKUMENTIERT.

KRITISCHE REGEL - FILTERUNG:
- Zeige NUR Quellen, die für das Thema RELEVANT sind
- IGNORIERE irrelevante Quellen KOMPLETT - erwähne sie NICHT
- Schreibe NIEMALS "nicht relevant" oder "enthält keine relevanten Informationen"
- Wenn eine Quelle nichts Relevantes enthält: ÜBERSPRINGE SIE STILLSCHWEIGEND

EXTRAKTION:
- Extrahiere VOLLSTÄNDIGE relevante Passagen und Zitate
- Behalte Originalformulierungen bei (übersetze nur ins Deutsche)
- Längere Abschnitte sind ERWÜNSCHT - das ist Rohmaterial

QUELLENANGABEN:
- JEDE Information MUSS mit dem zugehörigen Markdown-Link versehen sein
- Format: [Quellenname](URL) oder "Zitat" – [Quelle](URL)
- Ohne Link = ungültige Information

SPRACHE:
- Output auf Deutsch
- Englische Zitate übersetzen, Original in Klammern wenn besonders treffend
- Fachbegriffe können auf Englisch bleiben`

/**
 * Stream analysis using Gemini (1M+ token context)
 */
export async function* streamAnalysis(
  content: string,
  prompt: string
): AsyncGenerator<string, void, unknown> {
  const fullPrompt = `${SYSTEM_PROMPT}

${prompt}

---

Hier sind die Newsletter-Inhalte des Tages:

${content}`

  console.log(`[Analyze] Starting Gemini stream, prompt length: ${fullPrompt.length} chars`)

  try {
    const result = streamText({
      model: google('gemini-2.0-flash'),  // Fast enough for cron (5-min limit), 1M context
      prompt: fullPrompt,
      maxOutputTokens: 16384,
    })

    for await (const chunk of result.textStream) {
      yield chunk
    }
  } catch (error) {
    console.error('[Analyze] Gemini error:', error)
    throw error
  }
}

/**
 * Analyze daily repo content using Gemini
 */
export async function analyzeContent(
  content: string,
  prompt: string
): Promise<AnalysisResult> {
  let fullContent = ''

  for await (const chunk of streamAnalysis(content, prompt)) {
    fullContent += chunk
  }

  return {
    content: fullContent,
    inputTokens: 0, // Gemini doesn't return token counts in stream
    outputTokens: 0,
  }
}
