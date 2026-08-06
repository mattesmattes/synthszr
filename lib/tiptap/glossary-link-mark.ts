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
    // Begriffserklärungen existieren nur auf Deutsch und Englisch
    // (SUPPORTED_GLOSSARY_LANGS = ['en'], lib/glossary/translate.ts). Ein
    // Artikel in einer dritten Sprache verlinkte bisher auf sein eigenes
    // Präfix — /cs/glossary/… — wo der Feld-Fallback greift und der Leser
    // DEUTSCHEN Text bekommt, obwohl eine englische Fassung existiert.
    // Betreiber-Entscheidung 2026-08-06: alles außer 'de' zeigt auf 'en'.
    //
    // Die Abbildung sitzt hier statt bei den Aufrufern, weil es mehrere gibt
    // (Client-Renderer und render-static-html für den Prerender-Pfad) und ein
    // vergessener Aufrufer still die alte, falsche URL erzeugen würde.
    const lang = this.options.lang === 'de' ? 'de' : 'en'
    return ['a', mergeAttributes(HTMLAttributes, {
      href: `/${lang}/glossary/${slug}`,
      class: 'glossary-link',
    }), 0]
  },
})
