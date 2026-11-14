/**
 * Klartext aus TipTap-JSON für den Podcast-Prompt (aus der generate-script-
 * Route ausgelagert, 2026-11-14).
 *
 * BEFUND 2026-11-14: Zwischen zwei ausgezeichneten Textstücken (Link, fett)
 * steht im Editor oft ein eigener Textknoten mit nur einem Leerzeichen. Die
 * alte Fassung verwarf jeden Kindknoten ohne sichtbaren Text, also auch diese
 * Leerzeichen, und das Modell las „longagentic" statt „long agentic".
 * Leerzeichen-Textknoten bleiben jetzt erhalten; leere Absätze fallen weiter weg.
 */
export function extractTextFromTiptap(content: unknown): string {
  if (!content) return ''

  // JSON-String
  if (typeof content === 'string') {
    try {
      return extractTextFromTiptap(JSON.parse(content))
    } catch {
      return content
    }
  }

  if (typeof content !== 'object') return ''
  const node = content as { type?: string; content?: unknown[]; text?: string }

  if (node.type === 'text' && node.text) return node.text

  if (Array.isArray(node.content)) {
    const texts: string[] = []
    for (const child of node.content) {
      const text = extractTextFromTiptap(child)
      const isInlineText = (child as { type?: string } | null)?.type === 'text'
      if (text.trim() || (isInlineText && text)) texts.push(text)
    }
    if (node.type === 'paragraph' || node.type === 'heading') return texts.join('') + '\n\n'
    if (node.type === 'listItem') return '• ' + texts.join('') + '\n'
    return texts.join('')
  }

  return ''
}
