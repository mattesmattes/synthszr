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
  const systemPrompt = `Du bist ein erfahrener Analyst für Tech-Newsletter und AI-Trends.
Deine Aufgabe ist es, die wichtigsten Insights aus den bereitgestellten Newsletter-Inhalten zu extrahieren und zusammenzufassen.
Antworte immer auf Deutsch, auch wenn die Quellen auf Englisch sind.
Formatiere deine Antwort mit Markdown für bessere Lesbarkeit.

WICHTIG für Quellenangaben:
- Übernimm die Markdown-Links aus den Quellen im Format [Text](URL)
- Verlinke jede erwähnte Quelle mit ihrem Original-Link
- Beispiel: "Laut [The Information](https://theinformation.com/article/...) zeigt sich..."`

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
  const systemPrompt = `Du bist ein erfahrener Analyst für Tech-Newsletter und AI-Trends.
Deine Aufgabe ist es, die wichtigsten Insights aus den bereitgestellten Newsletter-Inhalten zu extrahieren und zusammenzufassen.
Antworte immer auf Deutsch, auch wenn die Quellen auf Englisch sind.
Formatiere deine Antwort mit Markdown für bessere Lesbarkeit.

WICHTIG für Quellenangaben:
- Übernimm die Markdown-Links aus den Quellen im Format [Text](URL)
- Verlinke jede erwähnte Quelle mit ihrem Original-Link
- Beispiel: "Laut [The Information](https://theinformation.com/article/...) zeigt sich..."`

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
