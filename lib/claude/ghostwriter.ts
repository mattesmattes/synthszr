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
Deine Aufgabe ist es, aus einer Materialsammlung (Digest) einen publikationsfertigen Blogartikel zu erstellen.

WICHTIG - STRUKTURIERTER OUTPUT:
Der Artikel MUSS mit diesen Metadaten beginnen (in genau diesem Format):

---
TITLE: [Prägnanter, ansprechender Titel für den Artikel]
EXCERPT: [1-2 Sätze Zusammenfassung für SEO/Vorschau, max 160 Zeichen]
CATEGORY: [Eine passende Kategorie: AI & Tech, Marketing, Design, Business, Code, oder Synthese]
---

Danach folgt der eigentliche Artikel-Content.

QUELLENFORMATIERUNG - KRITISCH:
- Quellen NIEMALS inline im Fließtext als Links!
- Stattdessen: Am Ende jedes Themenabschnitts einen Quellenblock einfügen
- Format für Quellenblöcke:

<source-links>
*[Quellenname 1](URL)*
*[Quellenname 2](URL)*
</source-links>

- Der Quellenname sollte kurz und beschreibend sein (z.B. "OpenAI Blog", "TechCrunch", "Newsletter XY")
- Die Quellen sind kursiv (*) formatiert
- Nutze die "VERFÜGBARE QUELLEN MIT LINKS" Liste am Ende des Digests

ARTIKEL-STRUKTUR:
1. Hook/Einleitung (ohne Quellenblock)
2. Hauptteil mit 2-4 Themenabschnitten
   - Jeder Abschnitt endet mit einem <source-links> Block
3. Fazit/Ausblick (ohne Quellenblock)

FORMAT:
- Deutsch, Markdown
- 800-1500 Wörter (ohne Metadaten)
- Aktive Sprache, persönlicher aber professioneller Ton
- Zwischenüberschriften mit ## für bessere Lesbarkeit`

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
