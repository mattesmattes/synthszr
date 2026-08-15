'use client'

import { useEffect, useState } from 'react'
import type { WaehrungsInfo } from '@/lib/currency/currencies'

interface Props {
  waehrung: WaehrungsInfo
  /** Wie viele Einheiten der Fremdwährung ein Euro kostet (EZB-Konvention). */
  kurs: number
  /** Handelstag der Kurse, YYYY-MM-DD. */
  stand: string
  lang: string
  labels: {
    ueberschrift: string
    stand: string
    quelle: string
  }
}

/**
 * Beidseitiger Währungsrechner für Lexikonbegriffe, die eine Währung sind.
 *
 * ZWEI DINGE, DIE HIER LEICHT SCHIEFGEHEN:
 *
 * 1. Die Eingabe liegt als ZEICHENKETTE im Zustand, nicht als Zahl. Hielte man
 *    eine Zahl, könnte man kein Komma tippen: „1," parst zu 1, wird als „1"
 *    zurückgeschrieben und das Komma verschwindet unter den Fingern. Gerechnet
 *    wird erst beim Ableiten des anderen Feldes.
 *
 * 2. Das Dezimaltrennzeichen hängt an der Seitensprache, nicht am Browser.
 *    Wer die deutsche Fassung liest, tippt „1.234,56"; wer die englische liest,
 *    „1,234.56". Beide Male ist dieselbe Zahl gemeint. Ein naives
 *    parseFloat() macht aus dem deutschen Betrag 1.234 — also den Tausendstel
 *    eines Betrags, und der Fehler fällt niemandem auf, weil das Ergebnis
 *    plausibel aussieht.
 */
export function CurrencyConverter({ waehrung, kurs, stand, lang, labels }: Props) {
  const deutsch = lang === 'de'
  const name = deutsch ? waehrung.name.de : waehrung.name.en

  // Startwert: 100 Einheiten der Fremdwährung — eine Größenordnung, an der man
  // den Kurs sofort ablesen kann, ohne selbst zu rechnen.
  const [fremd, setFremd] = useState('100')
  const [euro, setEuro] = useState(() => formatiere(100 / kurs, lang))

  // BETRAG AUS DEM LINK ÜBERNEHMEN. Wer im Artikel auf „123 Millionen Yuan"
  // klickt, soll hier nicht 100 vorfinden, sondern seine 123 Millionen —
  // umgerechnet.
  //
  // Gelesen wird aus window.location, NICHT über useSearchParams(): dieser Hook
  // nimmt den umgebenden Teilbaum aus dem statischen Prerender heraus (an
  // derselben Stelle ist heute schon die Kopfleiste aus dem SSR-HTML
  // verschwunden). Die Lexikonseite ist ISR-gecacht und soll das bleiben. Dass
  // der Betrag erst nach dem Hydrieren steht, merkt niemand — vorher kann
  // ohnehin niemand tippen.
  useEffect(() => {
    const roh = new URLSearchParams(window.location.search).get('betrag')
    if (!roh) return
    const zahl = Number(roh)
    if (!Number.isFinite(zahl) || zahl <= 0) return
    setFremd(formatiere(zahl, lang, false))
    setEuro(formatiere(zahl / kurs, lang))
  }, [kurs, lang])

  function parse(eingabe: string): number | null {
    // Alles wegwerfen, was kein Zifferzeichen ist. Vorzeichen sind bei einem
    // Währungsbetrag sinnlos, ein Minus wäre nur eine Fehlerquelle.
    let roh = eingabe.replace(/[^0-9.,]/g, '')
    roh = deutsch
      ? roh.replace(/\./g, '').replace(',', '.')  // 1.234,56 → 1234.56
      : roh.replace(/,/g, '')                      // 1,234.56 → 1234.56
    if (roh === '' || roh === '.') return null
    const zahl = Number(roh)
    return Number.isFinite(zahl) ? zahl : null
  }

  function fremdGeaendert(wert: string) {
    setFremd(wert)
    const zahl = parse(wert)
    setEuro(zahl === null ? '' : formatiere(zahl / kurs, lang))
  }

  function euroGeaendert(wert: string) {
    setEuro(wert)
    const zahl = parse(wert)
    setFremd(zahl === null ? '' : formatiere(zahl * kurs, lang))
  }

  const feld =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-lg font-mono ' +
    'tabular-nums text-foreground focus:border-foreground focus:outline-none'

  return (
    <section className="not-prose my-8 rounded-xl border border-border p-4 sm:p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {labels.ueberschrift}
      </h2>

      {/* items-end, damit die beiden Felder auf einer Linie sitzen: die
          Beschriftungen darüber sind unterschiedlich lang und brechen auf
          schmalen Schirmen verschieden um. */}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-1 block text-xs text-muted-foreground">
            {name} ({waehrung.code})
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={fremd}
            onChange={(e) => fremdGeaendert(e.target.value)}
            className={feld}
            aria-label={`${name} (${waehrung.code})`}
          />
        </label>

        <span aria-hidden className="shrink-0 pb-2 text-center text-muted-foreground sm:pb-3">
          =
        </span>

        <label className="flex-1">
          <span className="mb-1 block text-xs text-muted-foreground">Euro (EUR)</span>
          <input
            type="text"
            inputMode="decimal"
            value={euro}
            onChange={(e) => euroGeaendert(e.target.value)}
            className={feld}
            aria-label="Euro (EUR)"
          />
        </label>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        1 EUR = {formatiere(kurs, lang)} {waehrung.code} · {labels.stand} {formatiereDatum(stand, lang)}
        <br />
        {labels.quelle}
      </p>
    </section>
  )
}

/**
 * Zwei Nachkommastellen genügen für Beträge; mehr suggeriert eine Genauigkeit,
 * die ein Tagesreferenzkurs nicht hat.
 *
 * Ganze Zahlen bekommen KEINE Nachkommastellen: ein aus dem Artikel
 * übernommener Betrag von 123 Millionen soll „123.000.000" heißen und nicht
 * „123.000.000,00" — die zwei Nullen sind bei dieser Größenordnung nur Lärm.
 * Für Kurs und Umrechnungsergebnis bleiben sie erzwungen, dort tragen sie
 * Information.
 */
function formatiere(wert: number, lang: string, immerZweiStellen = true): string {
  return new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', {
    minimumFractionDigits: immerZweiStellen || !Number.isInteger(wert) ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(wert)
}

function formatiereDatum(iso: string, lang: string): string {
  // Aus der Zeichenkette bauen statt new Date(iso): letzteres liest ein
  // datumsloses ISO-Datum als UTC-Mitternacht, und westlich davon zeigt der
  // Browser dann den Vortag an.
  const [j, m, t] = iso.split('-').map(Number)
  if (!j || !m || !t) return iso
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-US', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(j, m - 1, t))
}
