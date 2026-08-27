/**
 * Jede Newsletter-Mail trägt einen List-Unsubscribe-Header.
 *
 * Anlass 27.08.2026: 82 Adressen bouncten binnen zwei Wochen 375-mal, alle mit
 * Spam-Klassifikation (eXpurgate bei T-Online, Strato, Mittwald, VW). SPF, DKIM
 * und DMARC sind korrekt — die Ablehnung ist inhaltlich. Ein fehlender
 * List-Unsubscribe-Header ist eines der Signale, die Filter dabei gegen einen
 * Absender werten.
 *
 * Der Versand ist auf ZWEI Routen dupliziert (Admin-Knopf und Cron). Beide
 * bauen ihr Mail-Objekt selbst, ein Header in nur einer davon wirkt bloß beim
 * halben Versand — derselbe Duplikations-Fallstrick wie bei den zwei
 * TipTap-Editoren.
 *
 * BEWUSST NICHT gesetzt: List-Unsubscribe-Post (One-Click). Der bräuchte einen
 * POST-Endpunkt ohne Origin-Prüfung, den Gmails Server erreichen können.
 * app/api/newsletter/unsubscribe/route.ts ist absichtlich POST-only MIT
 * requireValidOrigin, weil Mail-Gateways (Outlook Safe Links, Microsoft ATP)
 * früher Links vorab abriefen und Leute ungewollt abmeldeten. One-Click wäre
 * eine eigene Entscheidung, kein Nebeneffekt dieses Tests.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROUTES = [
  'app/api/admin/newsletter-send/route.ts',
  'app/api/cron/newsletter-send/route.ts',
]

describe('List-Unsubscribe im Newsletter-Versand', () => {
  for (const file of ROUTES) {
    const src = readFileSync(join(process.cwd(), file), 'utf8')

    it(`${file} setzt den List-Unsubscribe-Header`, () => {
      expect(src).toMatch(/['"]List-Unsubscribe['"]\s*:/)
    })

    it(`${file} verwendet dafür die Abmelde-URL des Empfängers`, () => {
      const m = src.match(/['"]List-Unsubscribe['"]\s*:\s*([^,\n]+)/)
      expect(m?.[1]).toContain('unsubscribeUrl')
    })

    it(`${file} schaltet One-Click nicht ohne passenden Endpunkt scharf`, () => {
      // Nur als echter Header-Schluessel verboten — im Kommentar darf
      // erklaert stehen, warum One-Click bewusst fehlt.
      expect(src).not.toMatch(/['"]List-Unsubscribe-Post['"]\s*:/)
    })
  }

  it('die Abmelde-Route bleibt gegen Prefetch geschuetzt', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/newsletter/unsubscribe/route.ts'), 'utf8')
    expect(src).toMatch(/requireValidOrigin/)
    expect(src).not.toMatch(/export async function GET/)
  })
})
