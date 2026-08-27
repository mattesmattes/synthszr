/**
 * Die Werkzeugleiste beider Editoren liest ihren Zustand direkt vom Editor ab
 * (`editor.isActive(...)`, `editor.getAttributes(...)`). Ausgewertet wird das
 * nur beim React-Render.
 *
 * TipTap v3 rendert die Komponente bei Transaktionen NICHT mehr automatisch neu
 * — anders als v2. Der Selector in @tiptap/react gibt konstant `null` zurück,
 * solange `shouldRerenderOnTransaction` nicht gesetzt ist (dist/index.js: die
 * Abfrage `=== false || === void 0`).
 *
 * Folge ohne diese Option: Ein Klick in eine Überschrift ist eine reine
 * Selection-Transaktion. Der Editor weiß Bescheid, React nicht. Die Bedingung
 * `editor.isActive("heading", { level: 2 })` wird nie neu geprüft, die
 * Bündel-Knöpfe ("Thema des Tages" / "Nachlese" / "Deep Dive") erscheinen
 * nicht. Erst ein Tastendruck erzwingt über onUpdate → onChange einen Rerender.
 *
 * Gemeldet am 27.08.2026: Knöpfe im Editor nicht auffindbar, obwohl der Cursor
 * in der H2 stand.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const EDITORS = [
  'components/tiptap-editor.tsx',
  'components/tiptap-editor-with-patterns.tsx',
]

describe('TipTap-Werkzeugleiste reagiert auf Cursor-Bewegungen', () => {
  for (const file of EDITORS) {
    const src = readFileSync(join(process.cwd(), file), 'utf8')

    it(`${file} setzt shouldRerenderOnTransaction: true`, () => {
      expect(src).toMatch(/shouldRerenderOnTransaction:\s*true/)
    })

    it(`${file} schaltet es nicht wieder ab`, () => {
      expect(src).not.toMatch(/shouldRerenderOnTransaction:\s*false/)
    })
  }

  it('die Bündel-Knöpfe hängen weiterhin am H2-Zustand', () => {
    // Wäre diese Bedingung weg, bräuchte es den Rerender nicht mehr — dann ist
    // dieser Test gegenstandslos und darf mit ihr zusammen entfernt werden.
    for (const file of EDITORS) {
      const src = readFileSync(join(process.cwd(), file), 'utf8')
      expect(src).toMatch(/editor\.isActive\("heading",\s*\{\s*level:\s*2\s*\}\)/)
    }
  })
})
