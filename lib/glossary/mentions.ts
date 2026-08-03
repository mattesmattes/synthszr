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
 * Reihenfolge der übergebenen Begriffsliste. Namen unter
 * GLOSSARY_MIN_NAME_LENGTH werden übersprungen, falls der Term auch längere
 * Namen hat; wenn der Term nur kurze Namen hat, wird er ganz ignoriert.
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
    const longNames = allNames.filter((n) => n.length >= GLOSSARY_MIN_NAME_LENGTH)
    // Wenn kein Name >= Mindestlänge: Term ignorieren.
    if (longNames.length === 0) continue

    // Längste zuerst: „Mixture-of-Experts" vor „Mixture of Experts".
    const namesToTry = longNames.sort((a, b) => b.length - a.length)

    for (const name of namesToTry) {
      const m = boundaryRegex(name).exec(text)
      if (m) {
        hits.push({ slug: term.slug, matchedText: m[2] })
        break
      }
    }

    // Wenn kein langer Name matched, versuche auch kurze Namen (als Fallback).
    // Kurze Namen brauchen Grenze auf BEIDEN Seiten, um False-Positives zu vermeiden.
    if (!hits.some(h => h.slug === term.slug)) {
      const shortNames = allNames.filter((n) => n.length < GLOSSARY_MIN_NAME_LENGTH)
        .sort((a, b) => b.length - a.length)
      for (const name of shortNames) {
        const m = boundaryRegexShort(name).exec(text)
        if (m) {
          hits.push({ slug: term.slug, matchedText: m[2] })
          break
        }
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
