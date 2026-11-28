import type { ExtensionGlossaryTerm, SupportedLang } from '../shared/types'

export interface GlossaryMatch {
  term: ExtensionGlossaryTerm
  start: number
  end: number
  surface: string
  ambiguous: boolean
}

interface IndexedPattern {
  term: ExtensionGlossaryTerm
  /** Populated only for multi-token or symbol patterns; single-token patterns match the bucket key directly. */
  lower: string
  len: number
  singleToken: boolean
  /** Exact surface required when pattern is an all-uppercase short acronym (e.g. "RAG", "MCP") */
  exactCase: string | null
  ambiguous: boolean
}

export interface CompiledGlossaryMatcher {
  buckets: Map<string, IndexedPattern[]>
  symbolPatterns: IndexedPattern[]
  termBySlug: Map<string, ExtensionGlossaryTerm>
  patternCount: number
  termCount: number
}

const WORD_CHAR_RE = /[\p{L}\p{N}_]/u
const FIRST_TOKEN_RE = /^[\p{L}\p{N}_]+/u

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR_RE.test(ch)
}

function isStrictAcronym(pattern: string): boolean {
  const compact = pattern.replace(/[-.\s]/g, '')
  return compact.length > 0 && compact.length <= 5 && /\p{Lu}/u.test(pattern) && pattern === pattern.toUpperCase()
}

/**
 * Compiles all glossary canonical names and aliases into a First-Word Token Hash Index.
 * Runs in ~8–15 ms for 3,300+ terms (~3.7 MB retained vs ~42 MB for a character Trie).
 */
export function compileGlossaryMatcher(terms: ExtensionGlossaryTerm[]): CompiledGlossaryMatcher {
  const buckets = new Map<string, IndexedPattern[]>()
  const symbolPatterns: IndexedPattern[] = []
  const termBySlug = new Map<string, ExtensionGlossaryTerm>()
  const seenPatterns = new Set<string>()
  let patternCount = 0

  const addPattern = (rawSurface: string, compactTerm: ExtensionGlossaryTerm) => {
    const surface = rawSurface.trim()
    if (surface.length < 2) return

    const exactCase = isStrictAcronym(surface) ? surface : null
    const lower = surface.toLowerCase()
    const dedupKey = `${lower}\0${exactCase ?? ''}\0${compactTerm.s}`
    if (seenPatterns.has(dedupKey)) return
    seenPatterns.add(dedupKey)

    const compactLen = surface.replace(/[^A-Za-z0-9]/g, '').length
    const isSingleWord = !/\s/.test(surface)
    const ambiguous =
      isSingleWord &&
      (compactTerm.amb === 1 || (compactLen <= 3 && !/^(llm|agi|asi)$/i.test(surface)))

    const firstMatch = FIRST_TOKEN_RE.exec(lower)
    if (firstMatch) {
      const firstToken = firstMatch[0]
      const singleToken = firstToken.length === lower.length
      const entry: IndexedPattern = {
        term: compactTerm,
        lower: singleToken ? '' : lower,
        len: surface.length,
        singleToken,
        exactCase,
        ambiguous,
      }
      let bucket = buckets.get(firstToken)
      if (!bucket) {
        bucket = []
        buckets.set(firstToken, bucket)
      }
      bucket.push(entry)
    } else {
      symbolPatterns.push({
        term: compactTerm,
        lower,
        len: surface.length,
        singleToken: false,
        exactCase,
        ambiguous,
      })
    }
    patternCount++
  }

  for (const term of terms) {
    // Store one compact term object without alias array so raw `a[]` arrays can be GC'd
    const compactTerm: ExtensionGlossaryTerm = term.amb
      ? { s: term.s, n: term.n, d: term.d, amb: 1 }
      : { s: term.s, n: term.n, d: term.d }
    termBySlug.set(compactTerm.s, compactTerm)

    addPattern(term.n, compactTerm)
    if (term.a) {
      for (const alias of term.a) {
        addPattern(alias, compactTerm)
      }
    }
  }

  return { buckets, symbolPatterns, termBySlug, patternCount, termCount: terms.length }
}

/**
 * Finds non-overlapping glossary matches in `text` using word-token bucket lookup.
 * Enforces Unicode word boundaries on both sides (protecting German Komposita like "Agentur")
 * and exact uppercase matching for short acronyms (e.g. "RAG", "MCP", "GAN").
 */
export function findMatchesInText(
  matcher: CompiledGlossaryMatcher,
  text: string,
): GlossaryMatch[] {
  if (!text || text.length < 2 || matcher.patternCount === 0) return []

  const lower = text.toLowerCase()
  const candidates: GlossaryMatch[] = []
  const tokenRe = /[\p{L}\p{N}_]+/gu
  let tokenMatch: RegExpExecArray | null

  while ((tokenMatch = tokenRe.exec(lower)) !== null) {
    const bucket = matcher.buckets.get(tokenMatch[0])
    if (!bucket) continue

    const start = tokenMatch.index
    for (let k = 0; k < bucket.length; k++) {
      const p = bucket[k]
      const end = start + p.len
      if (end > text.length) continue

      if (!p.singleToken) {
        if (end > lower.length) continue
        if (!lower.startsWith(p.lower, start)) continue
        if (end < lower.length && isWordChar(lower[end])) continue
      }

      const surface = text.slice(start, end)
      if (p.exactCase !== null && surface !== p.exactCase) continue

      candidates.push({
        term: p.term,
        start,
        end,
        surface,
        ambiguous: p.ambiguous,
      })
    }
  }

  if (matcher.symbolPatterns.length > 0) {
    for (let s = 0; s < matcher.symbolPatterns.length; s++) {
      const p = matcher.symbolPatterns[s]
      let pos = 0
      while ((pos = lower.indexOf(p.lower, pos)) !== -1) {
        const end = pos + p.len
        if (
          end <= text.length &&
          (pos === 0 || !isWordChar(lower[pos - 1])) &&
          (end >= lower.length || !isWordChar(lower[end]))
        ) {
          const surface = text.slice(pos, end)
          if (p.exactCase === null || surface === p.exactCase) {
            candidates.push({
              term: p.term,
              start: pos,
              end,
              surface,
              ambiguous: p.ambiguous,
            })
          }
        }
        pos += 1
      }
    }
  }

  if (candidates.length <= 1) return candidates

  // Longest-match-first, non-overlapping resolution
  candidates.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start
    const lenDiff = b.end - b.start - (a.end - a.start)
    if (lenDiff !== 0) return lenDiff
    // Prefer non-ambiguous canonical term on identical span
    return Number(a.ambiguous) - Number(b.ambiguous)
  })

  const accepted: GlossaryMatch[] = []
  let lastEnd = -1

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    if (c.start >= lastEnd) {
      accepted.push(c)
      lastEnd = c.end
    }
  }

  return accepted
}

const DE_STOPWORDS = /\b(der|die|das|und|ist|für|mit|auf|von|nicht|eine|ein|als|auch|sich|bei)\b/gi
const EN_STOPWORDS = /\b(the|and|is|for|with|that|this|from|are|was|have|not|but|you)\b/gi

/** Detects whether a web page is primarily German or English. */
export function detectPageLanguage(
  htmlLang?: string | null,
  sampleText?: string | null,
): SupportedLang {
  const normalized = (htmlLang ?? '').trim().toLowerCase()
  if (normalized.startsWith('de')) return 'de'
  if (normalized.startsWith('en')) return 'en'

  if (sampleText) {
    const snippet = sampleText.slice(0, 3000)
    const deCount = (snippet.match(DE_STOPWORDS) ?? []).length
    const enCount = (snippet.match(EN_STOPWORDS) ?? []).length
    if (deCount > enCount) return 'de'
  }

  return 'en'
}
