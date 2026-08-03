import { Mark, mergeAttributes } from '@tiptap/core'

/**
 * Mark für Lexikon-Verlinkungen. Wird serverseitig injiziert
 * (lib/glossary/inject-marks.ts), nicht vom Nutzer gesetzt — muss aber im
 * Editor registriert sein, sonst verwirft TipTap sie beim Laden und der Link
 * verschwindet beim nächsten Speichern.
 */
export const GlossaryLinkMark = Mark.create({
  name: 'glossaryLink',

  addAttributes() {
    return {
      slug: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-glossary-slug'),
        renderHTML: (attrs) =>
          attrs.slug ? { 'data-glossary-slug': attrs.slug as string } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-glossary-slug]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const slug = HTMLAttributes['data-glossary-slug']
    return ['a', mergeAttributes(HTMLAttributes, {
      href: `/de/glossary/${slug}`,
      class: 'glossary-link',
    }), 0]
  },
})
