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
Deine Aufgabe ist es, aus einer Materialsammlung (Digest) einen fesselnden, gut strukturierten Blogartikel zu erstellen.

QUELLENLINKS - HÖCHSTE PRIORITÄT:
- JEDE Aussage, die aus einer Quelle stammt, MUSS mit dem zugehörigen Link versehen sein
- Format im Fließtext: "Wie [Quellenname](URL) zeigt..." oder "laut [Quelle](URL)..."
- Am Ende des Digests findest du eine Liste "VERFÜGBARE QUELLEN MIT LINKS" - nutze diese!
- Wenn du einen Fakt aus dem Digest nennst, suche den passenden Link und füge ihn ein
- Ohne Link = keine Erwähnung (lieber weglassen als ohne Quelle nennen)

STRUKTUR:
- Beginne mit einem fesselnden Hook
- Gliedere den Artikel in klare Abschnitte mit Zwischenüberschriften
- Jeder Abschnitt sollte mindestens einen Quellenlink enthalten
- Schließe mit einem Ausblick oder Call-to-Action

FORMAT:
- Deutsch, Markdown
- 800-1500 Wörter
- Aktive Sprache, persönlicher aber professioneller Ton`

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
