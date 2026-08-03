import { Mark, mergeAttributes } from '@tiptap/core'

export interface GlossaryLinkOptions {
  /** Sprachpräfix für den href. Ein Artikel verlinkt auf die Lexikonseite
   *  seiner eigenen Sprache — ein sprachneutraler Pfad würde über den
   *  307-Redirect der Middleware laufen und je nach Cookie/Geo anders landen. */
  lang: string
}

/**
 * Mark für Lexikon-Verlinkungen. Wird serverseitig injiziert
 * (lib/glossary/inject-marks.ts), nicht vom Nutzer gesetzt — muss aber im
 * Editor registriert sein, sonst verwirft TipTap sie beim Laden und der Link
 * verschwindet beim nächsten Speichern.
 */
export const GlossaryLinkMark = Mark.create<GlossaryLinkOptions>({
  name: 'glossaryLink',

  addOptions() {
    return { lang: 'de' }
  },

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
      href: `/${this.options.lang}/glossary/${slug}`,
      class: 'glossary-link',
    }), 0]
  },
})
