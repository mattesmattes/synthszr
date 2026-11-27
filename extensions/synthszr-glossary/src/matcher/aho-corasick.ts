import type { ExtensionGlossaryTerm, SupportedLang } from '../shared/types'

export interface GlossaryMatch {
  term: ExtensionGlossaryTerm
  start: number
  end: number
  surface: string
  ambiguous: boolean
}

interface PatternEntry {
  term: ExtensionGlossaryTerm
  len: number
  /** Exact surface required when pattern is an all-uppercase short acronym (e.g. "RAG", "MCP") */
  exactCase: string | null
  ambiguous: boolean
}

interface TrieNode {
  next: Map<string, number>
  fail: number
  out: number[]
}

export interface CompiledGlossaryMatcher {
  nodes: TrieNode[]
  patterns: PatternEntry[]
  termCount: number
}

const WORD_CHAR_RE = /[\p{L}\p{N}_]/u

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR_RE.test(ch)
}

function isStrictAcronym(pattern: string): boolean {
  const compact = pattern.replace(/[-.\s]/g, '')
  return compact.length > 0 && compact.length <= 5 && /\p{Lu}/u.test(pattern) && pattern === pattern.toUpperCase()
}

/**
 * Compiles all glossary canonical names and aliases into an Aho-Corasick automaton.
 * Runs in O(sum of pattern lengths) once per index load (~10–25 ms for 3,300+ terms).
 */
export function compileGlossaryMatcher(terms: ExtensionGlossaryTerm[]): CompiledGlossaryMatcher {
  const nodes: TrieNode[] = [{ next: new Map(), fail: 0, out: [] }]
  const patterns: PatternEntry[] = []

  const addPattern = (rawSurface: string, term: ExtensionGlossaryTerm) => {
    const surface = rawSurface.trim()
    if (surface.length < 2) return

    const exactCase = isStrictAcronym(surface) ? surface : null
    const compactLen = surface.replace(/[^A-Za-z0-9]/g, '').length
    const isSingleWord = !/\s/.test(surface)
    const ambiguous =
      isSingleWord &&
      (term.amb === 1 || (compactLen <= 3 && !/^(llm|agi|asi)$/i.test(surface)))

    const patternId = patterns.length
    patterns.push({
      term,
      len: surface.length,
      exactCase,
      ambiguous,
    })

    const lower = surface.toLowerCase()
    let state = 0
    for (let i = 0; i < lower.length; i++) {
      const ch = lower[i]
      let nxt = nodes[state].next.get(ch)
      if (nxt === undefined) {
        nxt = nodes.length
        nodes.push({ next: new Map(), fail: 0, out: [] })
        nodes[state].next.set(ch, nxt)
      }
      state = nxt
    }
    nodes[state].out.push(patternId)
  }

  for (const term of terms) {
    addPattern(term.n, term)
    if (term.a) {
      for (const alias of term.a) {
        addPattern(alias, term)
      }
    }
  }

  // BFS to build Aho-Corasick failure links & merge outputs
  const queue: number[] = []
  for (const [, child] of nodes[0].next) {
    nodes[child].fail = 0
    queue.push(child)
  }

  for (let qIdx = 0; qIdx < queue.length; qIdx++) {
    const r = queue[qIdx]
    for (const [ch, s] of nodes[r].next) {
      queue.push(s)
      let state = nodes[r].fail
      while (state !== 0 && !nodes[state].next.has(ch)) {
        state = nodes[state].fail
      }
      const failState = nodes[state].next.get(ch) ?? 0
      nodes[s].fail = failState
      if (nodes[failState].out.length > 0) {
        nodes[s].out.push(...nodes[failState].out)
      }
    }
  }

  return { nodes, patterns, termCount: terms.length }
}

/**
 * Finds non-overlapping glossary matches in `text` in O(text.length + hits) time.
 * Enforces Unicode word boundaries on both sides (protecting German Komposita like "Agentur")
 * and exact uppercase matching for short acronyms (e.g. "RAG", "MCP", "GAN").
 */
export function findMatchesInText(
  matcher: CompiledGlossaryMatcher,
  text: string,
): GlossaryMatch[] {
  if (!text || text.length < 2 || matcher.patterns.length === 0) return []

  const lower = text.toLowerCase()
  const candidates: GlossaryMatch[] = []
  const nodes = matcher.nodes
  let state = 0

  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i]
    while (state !== 0 && !nodes[state].next.has(ch)) {
      state = nodes[state].fail
    }
    state = nodes[state].next.get(ch) ?? 0

    const out = nodes[state].out
    if (out.length === 0) continue

    const end = i + 1
    // Fast right-boundary check once per position before inspecting output list
    if (isWordChar(text[end])) continue

    for (let k = 0; k < out.length; k++) {
      const p = matcher.patterns[out[k]]
      const start = end - p.len
      if (start < 0) continue
      if (isWordChar(text[start - 1])) continue

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
