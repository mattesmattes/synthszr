/**
 * Server-taugliche Markdown → TipTap JSON.
 *
 * WARUM ES DIESE ZWEITE FASSUNG GIBT: `markdownToTiptap` aus
 * lib/utils/markdown-to-tiptap.ts ruft TipTaps `generateJSON()`, und das ruft
 * `elementFromString()` — hart mit
 *   "[tiptap error]: there is no window object available"
 * sobald kein DOM da ist. Die Datei wird zusätzlich vom Client importiert
 * (create-article), weshalb Turbopack einen `typeof window`-Guard im
 * Server-Chunk wegoptimiert; ein globaler jsdom-Shim hilft dort NICHT.
 *
 * Deshalb wird `elementFromString` ganz umgangen: HTML mit marked bauen, mit
 * einem jsdom-DOM und prosemirrors DOMParser einlesen, über `getSchema` mit
 * DEMSELBEN Extension-Satz wie die Client-Fassung. Weder `getSchema` noch der
 * prosemirror-DOMParser fassen `window` an.
 *
 * Die Funktion lag bis zum 2026-08-09 modul-privat in
 * lib/article-jobs/service.ts. Sie ist hierher gewandert, als die
 * Wrap-up-Route sie ebenfalls brauchte: eine Markdown-Konvertierung gehört
 * nicht in ein Artikel-Job-Modul, und der Wrap-up hat mit Jobs nichts zu tun.
 *
 * Marker-Behandlung spiegelt die Client-Fassung: `<!-- data-bundle-type:X -->`
 * wird vor `marked()` aus der Überschriftenzeile gelöst (HTML-Kommentare
 * überleben das DOM-Parsen nicht) und danach als `bundleType`-Attribut am
 * passenden Heading-Knoten nachgetragen — über dieselben extract/apply-Helfer,
 * damit beide Wege denselben Baum erzeugen.
 */
export async function markdownToTiptapServer(markdown: string): Promise<Record<string, unknown>> {
  const { marked } = await import('marked')
  const { getSchema } = await import('@tiptap/core')
  const { DOMParser: PMDOMParser } = await import('@tiptap/pm/model')
  const StarterKit = (await import('@tiptap/starter-kit')).default
  const Link = (await import('@tiptap/extension-link')).default
  const { HeadingWithQueueId } = await import('@/lib/tiptap/heading-with-queue-id')
  const { normalizeQuotes } = await import('@/lib/utils/typography')
  const { JSDOM } = await import('jsdom')
  const { extractBundleMarkers, applyBundleMarkers, extractHeadlineMarkers, applyHeadlineMarkers } =
    await import('@/lib/utils/markdown-to-tiptap')

  const { cleaned: ohneBundle, markers } = extractBundleMarkers(normalizeQuotes(markdown, 'de'))
  const { cleaned, markers: headlineMarkers } = extractHeadlineMarkers(ohneBundle)
  const html = marked.parse(cleaned, { async: false }) as string
  const schema = getSchema([
    StarterKit.configure({ heading: false }),
    HeadingWithQueueId.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    Link.configure({ openOnClick: false }),
  ])
  const dom = new JSDOM(`<body>${html}</body>`)
  const json = PMDOMParser.fromSchema(schema)
    .parse(dom.window.document.body)
    .toJSON() as Record<string, unknown>
  applyBundleMarkers(json, markers)
  applyHeadlineMarkers(json, headlineMarkers)
  return json
}
