import { extractVisibleText } from '@/lib/posts/product-mentions'
import { GLOSSARY_MIN_NAME_LENGTH } from '@/lib/glossary/types'
import type { GlossaryMatcherTerm, GlossaryMention } from '@/lib/glossary/types'

/** `{lex:Begriff}` — der Begriff darf Leerzeichen und Bindestriche enthalten,
 *  aber keine geschweiften Klammern. */
const LEX_TAG_RE = /\{lex:([^{}]+)\}/g

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Wortgrenzen über Unicode-Klassen statt \b: \b bricht bei Umlauten und
 *  Komposita. Diese Funktion erlaubt Komposita (z.B. „Inferenzkosten" soll
 *  „Inferenz" treffen). Gleicher Muster wie in lib/posts/product-mentions.ts. */
function boundaryRegex(name: string, flags = 'iu'): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegex(name)})`, flags)
}

/** Für kurze Namen (< GLOSSARY_MIN_NAME_LENGTH): Grenze auch hinten erforderlich,
 *  um False-Positives zu vermeiden. Z.B. „RAG" in „Ragout" treffen („Rag" gefolgt
 *  von „out"), aber nicht „AI" in „Aida" („Ai" gefolgt von „da"). \p{L} erkennt
 *  Umlaute als Buchstaben, daher wird „Öfen" nicht als „fen" erkannt. */
function boundaryRegexShort(name: string, flags = 'iu'): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegex(name)})($|[^\\p{L}\\p{N}])`, flags)
}

/**
 * Ein Name, der GANZ aus Grossbuchstaben besteht, ist eine Abkuerzung und wird
 * NUR in dieser Schreibung gesucht.
 *
 * PROD-BEFUND 2026-08-06 auf /de/glossary/eu-ai-act: im Satz "Es wurde 2024
 * verabschiedet" war das Pronomen "Es" als Engineering Sample ausgezeichnet.
 * Der Alias "ES" ist zwei Zeichen lang, hatte also bereits beidseitige
 * Wortgrenzen — die greifen hier nicht, weil "Es" ein vollstaendiges Wort ist.
 * Das fehlende Stueck war die Gross-/Kleinschreibung: eine Abkuerzung, die
 * kleingeschrieben ein Alltagswort ergibt, darf nicht case-insensitiv suchen.
 *
 * Von 177 Namen/Aliassen mit hoechstens drei Zeichen kollidiert derzeit genau
 * einer mit einem deutschen Alltagswort ("ES"), aber die Regel ist bewusst
 * allgemein statt eine Ausnahme fuer ES: dieselbe Falle steht bei jedem
 * kuenftigen Kuerzel offen (etwa "IR", "RE", "SO").
 *
 * Namen mit gemischter Schreibung ("MoE", "K8s") bleiben case-insensitiv — dort
 * ist die Kleinschreibung im Fliesstext ueblich und ungefaehrlich.
 */
function isAbbreviation(name: string): boolean {
  return /\p{Lu}/u.test(name) && name === name.toUpperCase()
}

/**
 * Begriffe, die NUR als ganzes Wort treffen duerfen, obwohl ihr Name lang genug
 * fuer die Kompositum-Regel waere.
 *
 * PROD-BEFUND 2026-08-06, gleiche Seite: in "Computerprogrammen" war "Compute"
 * verlinkt — das "rprogrammen" stand ausserhalb des Links und sah aus wie ein
 * Darstellungsfehler. Die Kompositum-Regel ist hier richtig gedacht und trotzdem
 * falsch angewandt: "Inferenzkosten" IST ein Kompositum mit "Inferenz" als
 * Erstglied, "Computerprogramm" ist keines mit "Compute" — "Computer" ist ein
 * eigenstaendiges Wort, das zufaellig so beginnt.
 *
 * Diese Unterscheidung ist ohne Woerterbuch nicht zu berechnen, deshalb eine
 * gepflegte Liste statt einer Heuristik — gleiches Muster wie
 * EXCLUDED_COMPANY_NAMES in lib/data/company-exclusions.ts. Hier gehoert ein
 * Begriff hinein, wenn sein Name das Praefix eines gebraeuchlichen laengeren
 * Wortes ist. Vergleich in Kleinschreibung.
 *
 * "branch" kam ueber einen Scan aller Begriffs-Bodies dazu und war der mit
 * ABSTAND haeufigste Fehltreffer des Lexikons: auf 148 Seiten war das Wort
 * "Branche" als Git-Branch verlinkt, dazu 19-mal "Branchen". Dieser Fall ist
 * heimtueckischer als "Compute", weil "e" als Flexionsendung gilt —
 * extendByInflection dehnte den Treffer ueber das ganze Wort aus, der Link sah
 * also voellig korrekt aus und fiel nur beim Draufklicken auf. Der Name deckt
 * alle drei Begriffe ab, die ihn tragen (branch, branch-versionskontrolle,
 * feature-branch), weil hier NAMEN stehen und keine Slugs.
 *
 * "diff" kam am 2026-08-07 dazu: im Artikeltext war "The diff|erence sounds
 * technical" verlinkt. Der Name hat GENAU vier Zeichen und faellt damit knapp
 * auf die Kompositum-Seite der Laengenregel (`4 < 4` ist falsch) — im Deutschen
 * kollidiert er zusaetzlich mit "Differenz" und "Diffusion".
 */
const WHOLE_WORD_ONLY = new Set(['compute', 'branch', 'diff'])

/**
 * Wie matchNameInText, aber mit Wortgrenze auf BEIDEN Seiten — für Namen, bei
 * denen ein Kompositum-Treffer falsch ist.
 *
 * PROD-BEFUND 2026-08-05: auf einer Lexikonseite war in „künstliche Intelligenz"
 * das Wort „Intel" als Firmenlink ausgezeichnet. Ursache war die Wiederverwendung
 * von matchNameInText: die verlangt eine Grenze nur DAVOR, weil Glossarbegriffe
 * in Komposita treffen sollen („Inferenzkosten" → „Inferenz"). Für Firmennamen
 * gilt das Gegenteil — „Intel" in „Intelligenz", „Meta" in „Metadaten", „Apple"
 * in „Applet" sind alle falsch.
 *
 * Die Grenze bleibt „kein Buchstabe und keine Ziffer", nicht „Leerzeichen":
 * „Intel." und „Nvidia-Chips" sind legitime Nennungen der Firma.
 */
export function matchWholeWordInText(
  text: string,
  name: string,
): { start: number; end: number; matched: string } | null {
  const m = boundaryRegexShort(name).exec(text)
  if (!m) return null
  const start = m.index + m[1].length
  return { start, end: start + m[2].length, matched: m[2] }
}

/**
 * Findet die erste Erwähnung eines Namens im Text und gibt ihre Position
 * zurück. Einzige Stelle im System, die entscheidet, was als Treffer gilt —
 * Matcher und Mark-Injektor müssen dieselbe Antwort bekommen.
 */
/**
 * Deutsche Flexionsendungen, die zum Treffer GEHOEREN.
 *
 * PROD-BEFUND 2026-08-05: "Grafikkarten-Vergleiche" wurde als
 * "[Grafikkarte]n-Vergleiche" verlinkt — das n stand ausserhalb des Links und sah
 * wie ein Fehler aus. Die Kompositum-Regel erlaubt den Treffer IM Wort, dehnt ihn
 * aber nicht auf die Beugung aus.
 *
 * Bewusst eine kurze, geschlossene Liste und keine Heuristik: sie darf nur
 * greifen, wo das Folgende WIRKLICH eine Endung ist. "Intel" + "ligenz" bleibt
 * damit unberuehrt, und "Inferenzkosten" verlinkt weiterhin nur "Inferenz" —
 * "kosten" ist keine Endung, sondern ein zweites Wort.
 *
 * Laengste zuerst, damit "en" vor "e" und "es" vor "e" greift.
 */
const INFLECTIONS = ['en', 'es', 'er', 'em', 'ns', 'n', 's', 'e']

/**
 * Dehnt einen Treffer um eine Flexionsendung aus, wenn danach eine Wortgrenze
 * folgt. Ohne diese Bedingung wuerde aus "Token" in "Tokenisierung" ein
 * "Tokenis"-Treffer.
 */
function extendByInflection(text: string, end: number): number {
  const rest = text.slice(end)
  for (const suffix of INFLECTIONS) {
    if (!rest.startsWith(suffix)) continue
    const after = rest.slice(suffix.length)
    // Wortgrenze dahinter: Satzende, Leerzeichen, Bindestrich, Satzzeichen.
    if (after === '' || /^[^\p{L}\p{N}]/u.test(after)) return end + suffix.length
  }
  return end
}

export function matchNameInText(
  text: string,
  name: string,
  lang = 'de',
): { start: number; end: number; matched: string } | null {
  // Grenze hinten verlangen, wenn der Name zu kurz für die Kompositum-Regel ist
  // ODER der Begriff nur als ganzes Wort gelten darf (s. WHOLE_WORD_ONLY).
  // Ausserhalb des Deutschen gibt es die Zusammenschreibung nicht, auf der die
  // Kompositum-Ausnahme beruht: "difference" ist kein "diff"+"erence",
  // "tokenizer" kein "token"+"izer". Dort ist ein Treffer im Wortinneren
  // IMMER ein Fehlgriff — die Einzelfall-Liste unten waere fuer fremde Sprachen
  // ein Fass ohne Boden.
  const wholeWord = lang !== 'de'
    || name.length < GLOSSARY_MIN_NAME_LENGTH
    || WHOLE_WORD_ONLY.has(name.toLowerCase())
  // Abkürzungen nur in ihrer Schreibung (s. isAbbreviation).
  const flags = isAbbreviation(name) ? 'u' : 'iu'
  const re = wholeWord ? boundaryRegexShort(name, flags) : boundaryRegex(name, flags)
  const m = re.exec(text)
  if (!m) return null
  const start = m.index + m[1].length
  const end = extendByInflection(text, start + m[2].length)
  return { start, end, matched: text.slice(start, end) }
}

/**
 * Findet Lexikonbegriffe im Text — pro Begriff maximal ein Treffer, in der
 * Reihenfolge der übergebenen Begriffsliste. Namen >= GLOSSARY_MIN_NAME_LENGTH
 * brauchen eine Wortgrenze davor (erlauben Komposita wie „Inferenzkosten").
 * Namen darunter brauchen Grenzen davor und dahinter (z.B. „AI" in „Aida" wird
 * verhindert, aber „RAG" in „Wir nutzen RAG." wird gefunden).
 */
export function findGlossaryMentions(
  text: string,
  terms: GlossaryMatcherTerm[],
  max = Number.MAX_SAFE_INTEGER,
  lang = 'de',
): GlossaryMention[] {
  const hits: GlossaryMention[] = []
  for (const term of terms) {
    if (hits.length >= max) break
    const allNames = [term.canonicalName, ...term.aliases]
    // Längste zuerst: „Mixture-of-Experts" vor „Mixture of Experts".
    const namesToTry = allNames.sort((a, b) => b.length - a.length)

    for (const name of namesToTry) {
      const hit = matchNameInText(text, name, lang)
      if (hit) {
        hits.push({ slug: term.slug, matchedText: hit.matched })
        break
      }
    }
  }
  return hits
}

/** Liest die Begriffsnamen aus allen `{lex:...}`-Direktiven eines
 *  TipTap-Dokuments, in Reihenfolge des Auftretens, ohne Duplikate. */
export function extractLexTags(content: unknown): string[] {
  const text = extractVisibleText(content)
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(LEX_TAG_RE)) {
    const name = m[1].trim()
    if (name && !seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

/** Entfernt die Direktiv-Klammern, behält den Begriff im Fließtext. */
export function stripLexTags(text: string): string {
  return text.replace(LEX_TAG_RE, '$1')
}
