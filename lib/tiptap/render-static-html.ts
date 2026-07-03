import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { HeadingWithQueueId } from '@/lib/tiptap/heading-with-queue-id'

/**
 * Rendert TipTap-JSON serverseitig zu statischem HTML — der crawlbare
 * Fallback für den client-only TiptapRenderer. Die Extension-Liste MUSS
 * mit dem Client-Editor (components/tiptap-renderer/tiptap-renderer.tsx)
 * deckungsgleich sein, sonst wirft generateHTML bei unbekannten Node-Typen.
 * generateHTML kommt aus '@tiptap/html' (zeed-dom, node-fähig) — die
 * '@tiptap/core'-Variante braucht window und wirft im Server-Kontext.
 * {Company}-Direktiven werden gestript (macht client-seitig
 * hideExplicitCompanyTags). Fehler → leerer String, nie werfen.
 */
export function renderStaticArticleHtml(content: Record<string, unknown> | string): string {
  try {
    const json = typeof content === 'string' ? JSON.parse(content) : content
    if (!json || typeof json !== 'object' || !('type' in json)) return ''
    const html = generateHTML(json as Parameters<typeof generateHTML>[0], [
      StarterKit.configure({
        heading: false,
      }),
      HeadingWithQueueId.configure({
        levels: [1, 2, 3, 4, 5, 6],
      }),
      // Identisch zum Client-Editor konfiguriert; openOnClick ist ein reines
      // Editor-Plugin und hat auf generateHTML keinen Einfluss.
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-foreground underline hover:text-foreground/70',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    ])
    return (
      html
        // zeed-dom-Serialisierungs-Artefakt auf Top-Level-Elementen
        .replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '')
        // {Company}-Tags entfernen (gleiche Semantik wie hideExplicitCompanyTags)
        .replace(/\{[^{}<>\n]{1,80}\}/g, '')
    )
  } catch {
    return ''
  }
}
