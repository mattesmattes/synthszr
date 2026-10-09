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
 * Kurations-Attribute (Betreiber-Vorgabe 2026-10-05, Spec Heading-Marker):
 * `queueItemIds` (kommagetrennt, alle Mitglieder eines Abschnitts —
 * `queueItemId` bleibt die ERSTE davon, damit Barometer-Anker, Thumbnail-
 * Matching und extractQueueItemIds unveraendert funktionieren), `curationRank`
 * und `curationTier`. Alle drei sind Strings wie die bestehenden Attribute.
 * BEFUND 2026-10-06: Attribute, die hier NICHT deklariert sind, kennt das
 * ProseMirror-Schema nicht — sie fallen beim ersten Editor-Save
 * (editor.getJSON()) und beim HTML-Parse stillschweigend weg. Ohne diese
 * Deklaration waere der Final Cut der Kuration nach dem ersten Speichern
 * unsichtbar.
 *
 * Oeffentliche Ausgabe (Entscheidung 2026-10-06, Task 8): renderHTML gibt die
 * drei Attribute auch im oeffentlichen HTML aus — im crawlbaren Prerender
 * (lib/tiptap/render-static-html.ts) und im Client-Renderer
 * (components/tiptap-renderer/tiptap-renderer.tsx), die beide diese Extension
 * nutzen. Gewollt: data-queue-item-id und data-bundle-type stehen dort heute
 * schon (take-barometer.ts liest data-queue-item-id aus dem DOM), die IDs
 * sind opake UUIDs, und `held` erreicht nie einen Draft (Spec „Drei Tiers").
 * Ein Filter nur im Prerender liesse die beiden Renderer auseinanderlaufen.
 * Das E-Mail-HTML (lib/email/tiptap-to-html.ts, case 'heading') schreibt
 * keine data-Attribute. Festgenagelt in tests/lib/render-static-html.test.ts.
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
      queueItemIds: {
        default: null,
        parseHTML: element => element.getAttribute('data-queue-item-ids'),
        renderHTML: attributes => {
          if (!attributes.queueItemIds) {
            return {}
          }
          return {
            'data-queue-item-ids': attributes.queueItemIds,
          }
        },
      },
      curationRank: {
        default: null,
        parseHTML: element => element.getAttribute('data-curation-rank'),
        renderHTML: attributes => {
          if (!attributes.curationRank) {
            return {}
          }
          return {
            'data-curation-rank': attributes.curationRank,
          }
        },
      },
      curationTier: {
        default: null,
        parseHTML: element => element.getAttribute('data-curation-tier'),
        renderHTML: attributes => {
          if (!attributes.curationTier) {
            return {}
          }
          return {
            'data-curation-tier': attributes.curationTier,
          }
        },
      },
    }
  },
})
