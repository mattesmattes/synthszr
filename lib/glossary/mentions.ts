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
 *  deutschen Komposita („Inferenzkosten" soll „Inferenz" treffen, „Ragout"
 *  aber nicht „RAG"). Dasselbe Muster wie in lib/posts/product-mentions.ts. */
function boundaryRegex(name: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegex(name)})`, 'iu')
}

/** Für kurze Namen (< GLOSSARY_MIN_NAME_LENGTH): Grenze auch hinten erforderlich,
 *  um False-Positives wie „AI" in „Aida" zu vermeiden. */
function boundaryRegexShort(name: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegex(name)})($|[^\\p{L}\\p{N}])`, 'iu')
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
      // Wähle Regex basierend auf Längenkategorie.
      const regex = name.length >= GLOSSARY_MIN_NAME_LENGTH
        ? boundaryRegex(name)
        : boundaryRegexShort(name)
      const m = regex.exec(text)
      if (m) {
        hits.push({ slug: term.slug, matchedText: m[2] })
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
