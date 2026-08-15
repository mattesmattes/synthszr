import Heading from '@tiptap/extension-heading'

/**
 * Custom Heading extension that preserves the queueItemId attribute
 *
 * This extension extends TipTap's Heading to include a queueItemId attribute
 * on H2 headings. This ID links the heading to its source queue item,
 * allowing thumbnails to be matched to articles even after users reorder them.
 *
 * Also carries `bundleType` ('topic' | 'recap'), set by the markdown→TipTap
 * conversion from the `<!-- data-bundle-type:X -->` marker (see
 * lib/utils/markdown-to-tiptap.ts). Renders as `data-bundle-type` so both
 * renderers can read it off the H2 DOM/HTML node.
 *
 * Usage:
 * Replace StarterKit.configure({ heading: false }) and add HeadingWithQueueId separately
 */
export const HeadingWithQueueId = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      queueItemId: {
        default: null,
        parseHTML: element => element.getAttribute('data-queue-item-id'),
        renderHTML: attributes => {
          if (!attributes.queueItemId) {
            return {}
          }
          return {
            'data-queue-item-id': attributes.queueItemId,
          }
        },
      },
      bundleType: {
        default: null,
        parseHTML: element => element.getAttribute('data-bundle-type'),
        renderHTML: attributes => {
          if (!attributes.bundleType) {
            return {}
          }
          return {
            'data-bundle-type': attributes.bundleType,
          }
        },
      },
      /**
       * Die drei Überschriften-Vorschläge zu diesem Abschnitt (JSON-Array).
       * Gesetzt von der markdown→TipTap-Konvertierung aus dem
       * `<!-- hl-alts:BASE64 -->`-Marker (lib/claude/headline-variants.ts).
       * Index 0 ist die aktuell verwendete Überschrift.
       *
       * ⚠️ Dieses Attribut MUSS hier stehen, nicht nur im Editor: Die Extension
       * wird auch von lib/tiptap/render-static-html.ts geladen, und dort führt
       * ein unbekanntes Attribut über generateHTML in den catch — der liefert
       * einen LEEREN String, und der komplette Artikel verschwindet aus dem
       * Prerender-HTML, ohne Fehler und ohne Log.
       */
      headlineAlts: {
        default: null,
        parseHTML: element => {
          const roh = element.getAttribute('data-headline-alts')
          if (!roh) return null
          try {
            const parsed = JSON.parse(roh)
            return Array.isArray(parsed) ? parsed : null
          } catch {
            return null
          }
        },
        renderHTML: attributes => {
          const alts = attributes.headlineAlts
          if (!Array.isArray(alts) || alts.length === 0) {
            return {}
          }
          return {
            'data-headline-alts': JSON.stringify(alts),
          }
        },
      },
    }
  },
})
