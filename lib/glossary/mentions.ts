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
function boundaryRegex(name: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegex(name)})`, 'iu')
}

/** Für kurze Namen (< GLOSSARY_MIN_NAME_LENGTH): Grenze auch hinten erforderlich,
 *  um False-Positives zu vermeiden. Z.B. „RAG" in „Ragout" treffen („Rag" gefolgt
 *  von „out"), aber nicht „AI" in „Aida" („Ai" gefolgt von „da"). \p{L} erkennt
 *  Umlaute als Buchstaben, daher wird „Öfen" nicht als „fen" erkannt. */
function boundaryRegexShort(name: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegex(name)})($|[^\\p{L}\\p{N}])`, 'iu')
}

/**
 * Findet die erste Erwähnung eines Namens im Text und gibt ihre Position
 * zurück. Einzige Stelle im System, die entscheidet, was als Treffer gilt —
 * Matcher und Mark-Injektor müssen dieselbe Antwort bekommen.
 */
export function matchNameInText(
  text: string,
  name: string,
): { start: number; end: number; matched: string } | null {
  const re = name.length < GLOSSARY_MIN_NAME_LENGTH
    ? boundaryRegexShort(name)
    : boundaryRegex(name)
  const m = re.exec(text)
  if (!m) return null
  const start = m.index + m[1].length
  return { start, end: start + m[2].length, matched: m[2] }
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
): GlossaryMention[] {
  const hits: GlossaryMention[] = []
  for (const term of terms) {
    if (hits.length >= max) break
    const allNames = [term.canonicalName, ...term.aliases]
    // Längste zuerst: „Mixture-of-Experts" vor „Mixture of Experts".
    const namesToTry = allNames.sort((a, b) => b.length - a.length)

    for (const name of namesToTry) {
      const hit = matchNameInText(text, name)
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
