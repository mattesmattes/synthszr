// lib/currency/history.ts
// Kursverlauf einer Währung gegen den Euro.
//
// QUELLE ist das ECB Data Portal, nicht die Tagesdatei aus ecb-rates.ts:
//   https://data-api.ecb.europa.eu/service/data/EXR/D.<CODE>.EUR.SP00.A
// Der Reihen-Schlüssel liest sich als „Daily, <Währung>, gegen Euro,
// Spot-Kurs, Average". `startPeriod` schneidet serverseitig zu, wir laden also
// nur, was gebraucht wird — rund 180 KB für drei Jahre.
//
// Die komplette Historiendatei (eurofxref-hist.xml) wäre die naheliegende
// Alternative und ist mit 8 MB dafür untauglich: sie enthält alle Währungen
// seit 1999 und müsste bei jedem Aufbau ganz gelesen werden.

export interface KursPunkt {
  /** Tag im Format YYYY-MM-DD. */
  t: string
  /** Wie viele Einheiten der Fremdwährung ein Euro an diesem Tag kostete. */
  v: number
}

/**
 * Holt den Verlauf. Wirft nicht — ohne Verlauf bleibt die Lexikonseite
 * vollständig, nur ohne Kurve.
 *
 * `revalidate` steht auf 12 Stunden: die Reihe wächst höchstens einmal
 * börsentäglich um einen Wert, und die Seite selbst cacht ohnehin.
 */
export async function fetchKursverlauf(
  code: string,
  abJahr = 3,
): Promise<KursPunkt[]> {
  // Kein Date.now() im Modulrumpf, aber hier ist es in einer Funktion und
  // damit unbedenklich — die Startgrenze muss mitwandern.
  const start = new Date()
  start.setFullYear(start.getFullYear() - abJahr)
  const ab = start.toISOString().slice(0, 10)

  const url =
    `https://data-api.ecb.europa.eu/service/data/EXR/D.${encodeURIComponent(code)}.EUR.SP00.A` +
    `?startPeriod=${ab}&format=csvdata`

  try {
    const antwort = await fetch(url, { next: { revalidate: 43200 } })
    if (!antwort.ok) return []
    return parseEzbCsv(await antwort.text())
  } catch {
    return []
  }
}

/**
 * Die Antwort ist eine breite CSV mit rund 30 Spalten. Gebraucht werden zwei:
 * TIME_PERIOD (Index 6) und OBS_VALUE (Index 7).
 *
 * Ein vollwertiger CSV-Parser wäre hier Ballast: die hinteren Felder enthalten
 * zwar Kommas in Anführungszeichen (die Reihenbeschreibung), aber die ersten
 * acht sind durchweg einfache Werte. Gelesen wird deshalb nur bis Feld 8.
 *
 * Feiertage stehen mit leerem OBS_VALUE in der Reihe — solche Zeilen fallen
 * heraus, sonst risse die Kurve auf null ab.
 */
export function parseEzbCsv(csv: string): KursPunkt[] {
  const zeilen = csv.split('\n')
  const punkte: KursPunkt[] = []
  for (let i = 1; i < zeilen.length; i++) {
    const felder = zeilen[i].split(',', 8)
    if (felder.length < 8) continue
    const t = felder[6]
    const v = Number(felder[7])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || !Number.isFinite(v) || v <= 0) continue
    punkte.push({ t, v })
  }
  return punkte
}

/**
 * Dünnt den Verlauf auf höchstens `ziel` Punkte aus.
 *
 * Drei Jahre Tageskurse sind rund 780 Werte — mehr, als eine 600 Einheiten
 * breite Kurve auflösen kann, und jeder Punkt kostet Zeichen im HTML. Der
 * LETZTE Wert bleibt dabei immer erhalten: er ist der aktuelle Kurs, und ein
 * Diagramm, das kurz vor heute endet, sieht nach einem Datenfehler aus.
 */
export function ausduennen(punkte: KursPunkt[], ziel = 160): KursPunkt[] {
  if (punkte.length <= ziel) return punkte
  const schritt = punkte.length / ziel
  const raus: KursPunkt[] = []
  for (let i = 0; i < ziel; i++) raus.push(punkte[Math.floor(i * schritt)])
  const letzter = punkte[punkte.length - 1]
  if (raus[raus.length - 1].t !== letzter.t) raus.push(letzter)
  return raus
}
