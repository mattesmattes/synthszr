import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

/**
 * Stream ghostwriter blog post generation
 */
export async function* streamGhostwriter(
  digestContent: string,
  prompt: string
): AsyncGenerator<string, void, unknown> {
  const systemPrompt = `Du bist ein erfahrener Ghostwriter für Tech-Blogs und Newsletter.
Deine Aufgabe ist es, aus einem Digest einen fesselnden, gut strukturierten Blogartikel zu erstellen.
Der Artikel soll eigenständig lesbar sein und die wichtigsten Insights des Digests in eine narrative Form bringen.
Schreibe immer auf Deutsch und nutze Markdown für die Formatierung.

WICHTIG für Quellenangaben:
- Übernimm alle Markdown-Links aus dem Digest im Format [Text](URL)
- Verlinke jede erwähnte Quelle mit ihrem Original-Link
- Setze Quellenlinks direkt im Fließtext, z.B.: "Wie [The Information](https://...) berichtet..."
- Am Ende des Artikels KEINE separate Quellenliste nötig, wenn Links inline sind`

  const stream = await anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: `${prompt}\n\n---\n\nHier ist der Digest, aus dem du einen Blogartikel erstellen sollst:\n\n${digestContent}`,
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
