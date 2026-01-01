// Lazy load AI SDK to avoid module loading issues
let streamTextFn: typeof import('ai').streamText | null = null

async function getStreamText() {
  if (!streamTextFn) {
    const aiModule = await import('ai')
    streamTextFn = aiModule.streamText
  }
  return streamTextFn
}

export interface AnalysisResult {
  content: string
  inputTokens: number
  outputTokens: number
}

const SYSTEM_PROMPT = `Du bist ein Recherche-Assistent, der AUSFÜHRLICHE MATERIALSAMMLUNGEN erstellt.

DEINE ROLLE:
- Du erstellst KEINE Zusammenfassungen
- Du extrahierst und dokumentierst das Rohmaterial für spätere Blogposts
- Längere, detailliertere Outputs sind BESSER
- Behalte Originalformulierungen und Zitate bei

QUELLENANGABEN - KRITISCH WICHTIG:
- JEDE Information MUSS mit dem zugehörigen Markdown-Link versehen sein
- Format: [Quellenname](URL) oder "Zitat" – [Quelle](URL)
- Übernimm ALLE Links aus den Quelldaten
- Ohne Link = ungültige Information

SPRACHE:
- Output auf Deutsch
- Englische Zitate übersetzen, aber Original in Klammern behalten wenn besonders treffend
- Fachbegriffe können auf Englisch bleiben

UMFANG:
- Sei ausführlich - das ist Arbeitsmaterial, keine Endversion
- Vollständige Passagen > gekürzte Snippets
- Lieber zu viel als zu wenig`

/**
 * Stream analysis using Gemini (1M+ token context)
 */
export async function* streamAnalysis(
  content: string,
  prompt: string
): AsyncGenerator<string, void, unknown> {
  const streamText = await getStreamText()

  const fullPrompt = `${SYSTEM_PROMPT}

${prompt}

---

Hier sind die Newsletter-Inhalte des Tages:

${content}`

  console.log(`[Analyze] Starting Gemini stream, prompt length: ${fullPrompt.length} chars`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await streamText({
    model: 'google/gemini-2.5-flash-preview-05-20' as any,
    prompt: fullPrompt,
    maxTokens: 16384,
  })

  for await (const chunk of result.textStream) {
    yield chunk
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
