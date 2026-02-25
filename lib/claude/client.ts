import { streamText } from 'ai'
import { google } from '@ai-sdk/google'

export interface AnalysisResult {
  content: string
  inputTokens: number
  outputTokens: number
}

const SYSTEM_PROMPT = `Du bist ein Kurator, der Inhalte für einen Newsletter DOKUMENTIERT und AUFBEREITET.

FILTERUNG (nur für echten Müll):
- ÜBERSPRINGEN (ohne Erwähnung): Tracking-Pixel, Werbeangebote, Gewinnspiele, Newsletter-Footer ("Subscribe", "Referral Hub", "Unsubscribe"), DSGVO-Hinweise, reine Produktwerbung ohne Neuigkeitswert
- Alle anderen Quellen: IMMER aufnehmen, auch wenn nur peripher relevant

EXTRAKTION (für aufgenommene Quellen):
- Extrahiere VOLLSTÄNDIGE relevante Passagen und Zitate — Rohmaterial, nicht Zusammenfassung
- Je mehr Inhalt, desto besser — Kürzen ist später einfacher als Ergänzen
- Behalte Originalformulierungen bei (übersetze ins Deutsche, Original in Klammern wenn treffend)
- Wichtige Zahlen, Namen, Fakten und Zitate VOLLSTÄNDIG wiedergeben

QUELLENANGABEN:
- JEDE Information MUSS mit dem zugehörigen Markdown-Link versehen sein
- Format: [Quellenname](URL) oder "Zitat" – [Quelle](URL)
- Ohne Link = ungültige Information

UMFANG:
- Ziel: möglichst VOLLSTÄNDIGE Erfassung aller relevanten Quellen
- Lieber zu ausführlich als zu knapp — das ist Rohmaterial für einen Blogpost
- Thematisch verwandte Quellen zusammenfassen, aber NICHTS weglassen

SPRACHE:
- Output auf Deutsch
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
      model: google('gemini-2.5-flash'),  // Better quality than 2.0-flash, fast enough for cron budget
      prompt: fullPrompt,
      maxOutputTokens: 65536,  // ~50k Wörter max — kein künstlicher Deckel mehr
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
