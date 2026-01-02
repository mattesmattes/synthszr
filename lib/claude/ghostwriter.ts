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
  // Minimaler System-Prompt - nur für Parsing-Anforderungen
  // Alle inhaltlichen Anweisungen kommen aus dem Datenbank-Prompt
  const systemPrompt = `Du bist ein Ghostwriter. Befolge die Anweisungen im User-Prompt exakt.

WICHTIG - STRUKTURIERTER OUTPUT (für automatisches Parsing):
Der Artikel MUSS mit diesen Metadaten beginnen (in genau diesem Format):

---
TITLE: [Titel]
EXCERPT: [1-2 Sätze, max 160 Zeichen]
CATEGORY: [AI & Tech, Marketing, Design, Business, Code, oder Synthese]
---

Danach folgt der Artikel-Content in Markdown.`

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
