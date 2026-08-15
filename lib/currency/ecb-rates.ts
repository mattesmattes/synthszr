// lib/currency/ecb-rates.ts
// Tageskurse von der Europäischen Zentralbank.
//
// QUELLE: die offiziellen EZB-Referenzkurse. Kostenlos, ohne Schlüssel, ohne
// Kontingent — deshalb hier und nicht ein kommerzieller Anbieter. Die EZB
// veröffentlicht sie an Handelstagen gegen 16:00 MEZ; an Wochenenden und
// Feiertagen bleibt der letzte Handelstag stehen. Das ist kein Fehler, sondern
// die Natur der Quelle: es gibt an diesen Tagen keinen Referenzkurs.
//
// ALLE KURSE STEHEN GEGEN EURO, in der Form „1 EUR = <rate> <Währung>". Der
// Euro selbst kommt in der Datei nicht vor; er ist die Basis und hat implizit
// den Kurs 1. Für Umrechnungen zwischen zwei Fremdwährungen müsste man über
// den Euro gehen — das braucht der Lexikon-Rechner nicht, er rechnet immer
// gegen Euro.

const EZB_TAGESKURSE =
  'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

export interface EcbRates {
  /** Handelstag der Kurse im Format YYYY-MM-DD, wie ihn die EZB angibt. */
  date: string
  /** ISO-Code → wie viele Einheiten dieser Währung ein Euro kostet. */
  rates: Record<string, number>
}

/**
 * Die Datei ist klein (rund 1,5 KB), flach und seit Jahren stabil aufgebaut.
 * Ein XML-Parser als Abhängigkeit wäre dafür unverhältnismäßig; zwei reguläre
 * Ausdrücke genügen. Beide Anführungszeichenarten werden akzeptiert — die EZB
 * liefert einfache, aber darauf würde ich eine Fremdquelle nicht festnageln.
 */
export function parseEcbXml(xml: string): EcbRates | null {
  const datum = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1]
  if (!datum) return null

  const rates: Record<string, number> = {}
  const muster = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g
  for (const treffer of xml.matchAll(muster)) {
    const kurs = Number(treffer[2])
    if (Number.isFinite(kurs) && kurs > 0) rates[treffer[1]] = kurs
  }
  if (Object.keys(rates).length === 0) return null

  return { date: datum, rates }
}

/**
 * Holt die Tageskurse. Wirft nicht — bei einer Störung der EZB-Seite soll der
 * Lexikonartikel trotzdem stehen, nur ohne Rechner.
 *
 * Die Zwischenspeicherung übernimmt Next: `revalidate` hält die Antwort eine
 * Stunde. Häufiger wäre sinnlos, weil sich der Wert nur einmal am Tag ändert;
 * seltener würde den neuen Kurs am Nachmittag zu lange verzögern.
 */
export async function fetchEcbRates(): Promise<EcbRates | null> {
  try {
    const antwort = await fetch(EZB_TAGESKURSE, {
      next: { revalidate: 3600 },
      headers: { Accept: 'application/xml' },
    })
    if (!antwort.ok) return null
    return parseEcbXml(await antwort.text())
  } catch {
    return null
  }
}
