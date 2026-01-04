import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '')

/**
 * Stream ghostwriter blog post generation using Gemini 2.5 Pro
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

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-pro',
    systemInstruction: systemPrompt,
  })

  const userMessage = `${prompt}\n\n---\n\nHier ist der Digest, aus dem du einen Blogartikel erstellen sollst:\n\n${digestContent}`

  const result = await model.generateContentStream(userMessage)

  for await (const chunk of result.stream) {
    const text = chunk.text()
    if (text) {
      yield text
    }
  }
}
