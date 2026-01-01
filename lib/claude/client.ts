import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export interface AnalysisResult {
  content: string
  inputTokens: number
  outputTokens: number
}

/**
 * Analyze daily repo content using Claude
 */
export async function analyzeContent(
  content: string,
  prompt: string
): Promise<AnalysisResult> {
  const systemPrompt = `Du bist ein Recherche-Assistent, der AUSFÜHRLICHE MATERIALSAMMLUNGEN erstellt.

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

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: `${prompt}\n\n---\n\nHier sind die Newsletter-Inhalte des Tages:\n\n${content}`,
      },
    ],
    system: systemPrompt,
  })

  const textContent = message.content.find(block => block.type === 'text')

  return {
    content: textContent?.type === 'text' ? textContent.text : '',
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  }
}

/**
 * Stream analysis for real-time output
 */
export async function* streamAnalysis(
  content: string,
  prompt: string
): AsyncGenerator<string, void, unknown> {
  const systemPrompt = `Du bist ein Recherche-Assistent, der AUSFÜHRLICHE MATERIALSAMMLUNGEN erstellt.

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

  const stream = await anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: `${prompt}\n\n---\n\nHier sind die Newsletter-Inhalte des Tages:\n\n${content}`,
      },
    ],
    system: systemPrompt,
  })

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text
    }
  }
}
