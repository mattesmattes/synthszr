/**
 * Content negotiation für AI-Agenten (acceptmarkdown.com-Konvention):
 * ein Request mit `Accept: text/markdown` bekommt Markdown statt HTML für
 * dieselbe URL — kein separater Pfad, keine Content-Verdopplung im Crawl-Index.
 *
 * Nur die zwei Typen zählen, die hier je vorkommen (text/markdown, text/html);
 * ein voller RFC-7231-Parser (Wildcards mit Parametern, Content-Coding etc.)
 * wäre für diesen Zweck Overkill.
 */
function parseAccept(accept: string): Map<string, number> {
  const q = new Map<string, number>()
  for (const part of accept.split(',')) {
    const [rawType, ...params] = part.trim().split(';')
    const type = rawType.trim().toLowerCase()
    if (!type) continue
    let quality = 1
    for (const param of params) {
      const [key, value] = param.trim().split('=')
      if (key === 'q' && value) {
        const parsed = Number.parseFloat(value)
        if (!Number.isNaN(parsed)) quality = parsed
      }
    }
    // Bei Duplikaten (kommt in freihändig gebauten Clients vor) den höchsten q-Wert behalten.
    const existing = q.get(type)
    if (existing === undefined || quality > existing) q.set(type, quality)
  }
  return q
}

/** true, wenn der Request text/markdown gegenüber text/html (oder Wildcard) vorzieht. */
export function wantsMarkdown(accept: string | null): boolean {
  if (!accept) return false
  const q = parseAccept(accept)
  const markdownQ = q.get('text/markdown') ?? -1
  if (markdownQ <= 0) return false
  const htmlQ = Math.max(q.get('text/html') ?? -1, q.get('application/xhtml+xml') ?? -1, q.get('*/*') ?? -1)
  return markdownQ >= htmlQ
}
