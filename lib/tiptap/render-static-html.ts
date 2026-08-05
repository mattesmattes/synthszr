import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { HeadingWithQueueId } from '@/lib/tiptap/heading-with-queue-id'
import { GlossaryLinkMark } from '@/lib/tiptap/glossary-link-mark'
import { stripLexTags } from '@/lib/glossary/mentions'
import { applyTypographicQuotes } from '@/lib/typography/quotes'

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
export function renderStaticArticleHtml(content: Record<string, unknown> | string, lang = 'de'): string {
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return ''
    // Typografische Anfuehrungszeichen VOR dem Rendern, auf den Textknoten: im
    // fertigen HTML stehen Anfuehrungszeichen in Attributen (href, class), eine
    // Ersetzung dort wuerde das Markup zerstoeren.
    const json = applyTypographicQuotes(parsed, lang)
    const html = generateHTML(json as Parameters<typeof generateHTML>[0], [
      StarterKit.configure({
        heading: false,
        link: false,
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
      // Ohne diesen Eintrag wirft generateHTML bei der glossaryLink-Mark, der
      // catch schluckt es, und der komplette Artikel fehlt im Prerender-HTML.
      GlossaryLinkMark.configure({ lang }),
    ])
    return (
      stripLexTags(
        html
          // zeed-dom-Serialisierungs-Artefakt auf Top-Level-Elementen
          .replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '')
      )
        // {Company}-Tags entfernen (gleiche Semantik wie hideExplicitCompanyTags).
        // Erst NACH stripLexTags, sonst verschwindet {lex:Begriff} mitsamt Begriff.
        .replace(/\{[^{}<>\n]{1,80}\}/g, '')
    )
  } catch {
    return ''
  }
}
