import { createHash } from 'crypto'
import { getMatcherTermsShared, getPublishedTermListShared } from '@/lib/glossary/terms'

export type SupportedExtensionLang = 'de' | 'en'

export interface ExtensionGlossaryTerm {
  /** Term slug (URL identifier on synthszr.com/<lang>/glossary/<slug>) */
  s: string
  /** Canonical display name */
  n: string
  /** Cleaned non-duplicate aliases */
  a?: string[]
  /** Short plain-text summary for zero-latency popover preview */
  d: string
  /** 1 when the term is a homonym / common word requiring AI page context (>= 2 unambiguous hits) */
  amb?: 1
}

export interface ExtensionGlossaryIndex {
  version: string
  lang: SupportedExtensionLang
  count: number
  generatedAt: string
  items: ExtensionGlossaryTerm[]
}

/** Short stop/tech tokens that create overwhelming false positives on general web pages. */
export const EXCLUDED_ALIASES = new Set<string>([
  'ai',
  'ki',
  'it',
  'ml',
  'dl',
  'ui',
  'ux',
  'ar',
  'vr',
  'xr',
  'db',
  'id',
  'os',
  'io',
  'js',
  'ts',
  'py',
  'go',
  'es',
  'r',
  'c',
  'die',
  'der',
  'das',
  'the',
  'and',
  'for',
  'or',
  'in',
  'on',
  'to',
  'of',
  'is',
  'at',
  'by',
])

/**
 * Everyday English/German single words and short tech acronyms that also live inside the AI glossary.
 * Highlighted ONLY when the current page already contains >= 2 unambiguous AI glossary hits.
 */
export const AMBIGUOUS_SINGLE_WORDS = new Set<string>([
  'activation',
  'adapter',
  'agent',
  'agenten',
  'agents',
  'alignment',
  'anchor',
  'api',
  'assistant',
  'assistent',
  'attention',
  'aufmerksamkeit',
  'batch',
  'belohnung',
  'benchmark',
  'bias',
  'bridge',
  'cache',
  'canvas',
  'chunk',
  'chunks',
  'cli',
  'cluster',
  'code',
  'context',
  'copilot',
  'cot',
  'cpu',
  'css',
  'diffusion',
  'distillation',
  'destillation',
  'dom',
  'dos',
  'drift',
  'dropout',
  'durchsatz',
  'embedding',
  'embeddings',
  'entropy',
  'entropie',
  'epoch',
  'eval',
  'evals',
  'filter',
  'finetuning',
  'fine-tuning',
  'frame',
  'frames',
  'gan',
  'gateway',
  'gedächtnis',
  'gewicht',
  'gewichte',
  'gpu',
  'gradient',
  'graph',
  'grounding',
  'gru',
  'guardrail',
  'guardrails',
  'hallucination',
  'halluzination',
  'html',
  'index',
  'inference',
  'inferenz',
  'json',
  'kernel',
  'knoten',
  'kontext',
  'latent',
  'latenz',
  'latency',
  'layer',
  'layers',
  'lora',
  'loss',
  'manifold',
  'matrix',
  'mcp',
  'memory',
  'mlp',
  'model',
  'modell',
  'modelle',
  'models',
  'moe',
  'node',
  'nodes',
  'noise',
  'npu',
  'orchestration',
  'orchestrierung',
  'persona',
  'pipeline',
  'pipelines',
  'policy',
  'pooling',
  'prompt',
  'prompts',
  'proxy',
  'pruning',
  'quantisierung',
  'quantization',
  'queue',
  'rag',
  'ram',
  'ranking',
  'rauschen',
  'reasoning',
  'rest',
  'reward',
  'richtlinie',
  'rnn',
  'router',
  'sandbox',
  'scalar',
  'scale',
  'scaling',
  'schicht',
  'schichten',
  'script',
  'sdk',
  'search',
  'seed',
  'shard',
  'signal',
  'skalierung',
  'skill',
  'skills',
  'spark',
  'speech',
  'sql',
  'ssm',
  'stream',
  'suche',
  'synthese',
  'synthesis',
  'temperatur',
  'temperature',
  'tensor',
  'throughput',
  'token',
  'tokens',
  'tool',
  'tools',
  'tot',
  'tpu',
  'training',
  'transformer',
  'transformers',
  'vae',
  'vector',
  'vektor',
  'vision',
  'voice',
  'weight',
  'weights',
  'werkzeug',
  'worker',
  'workflow',
  'workflows',
  'yaml',
])

const LEX_TAG_RE = /\{lex:([^{}]+)\}/g
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\([^)]+\)/g
const HTML_TAG_RE = /<[^>]+>/g

/** Strips `{lex:...}`, markdown links and HTML tags, yielding plain single-line text. */
export function stripPlainText(input: string, maxLen = 180): string {
  const cleaned = input
    .replace(LEX_TAG_RE, '$1')
    .replace(MARKDOWN_LINK_RE, '$1')
    .replace(HTML_TAG_RE, ' ')
    .replace(/[*_`~#>]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim()

  if (cleaned.length <= maxLen) return cleaned

  const sliced = cleaned.slice(0, maxLen)
  const lastSpace = sliced.lastIndexOf(' ')
  const cut = lastSpace > maxLen * 0.6 ? sliced.slice(0, lastSpace) : sliced
  return `${cut.replace(/[.,;:!?-]+$/, '')}…`
}

/**
 * Determines whether a term requires surrounding AI-domain context on general web pages
 * to avoid highlighting everyday words (e.g. "Agent", "Model", "Token").
 */
export function isAmbiguousTerm(canonicalName: string, aliases: string[]): boolean {
  const trimmed = canonicalName.trim()
  const lower = trimmed.toLowerCase()
  if (AMBIGUOUS_SINGLE_WORDS.has(lower)) return true

  if (!/\s/.test(trimmed) && trimmed.length <= 3 && !/^(llm|agi|asi)$/i.test(trimmed)) {
    return true
  }

  // If the canonical name itself is clean/specific (e.g., "Retrieval-Augmented Generation"),
  // an ambiguous alias like "RAG" shouldn't suppress the full canonical phrase; individual alias
  // ambiguity will be enforced in the client matcher.
  void aliases
  return false
}

/** Filters aliases: trims, strips `{lex:...}`, removes exclusions and canonical-name duplicates. */
export function cleanAliasList(canonicalName: string, rawAliases: string[]): string[] {
  const canonicalLower = canonicalName.trim().toLowerCase()
  const seen = new Set<string>([canonicalLower])
  const result: string[] = []

  for (const raw of rawAliases) {
    const cleaned = raw.replace(LEX_TAG_RE, '$1').replace(/\s+/g, ' ').trim()
    if (cleaned.length < 2) continue
    const lower = cleaned.toLowerCase()
    if (EXCLUDED_ALIASES.has(lower)) continue
    if (seen.has(lower)) continue
    seen.add(lower)
    result.push(cleaned)
  }

  return result
}

export interface GlossaryPlainBlock {
  type: 'heading' | 'paragraph' | 'quote' | 'listItem'
  text: string
}

interface TipTapNode {
  type?: string
  text?: string
  content?: TipTapNode[]
}

function collectNodePlainText(node: TipTapNode): string {
  if (typeof node.text === 'string') {
    return node.text
  }
  if (!Array.isArray(node.content)) return ''
  return node.content.map(collectNodePlainText).join('')
}

function cleanBlockText(raw: string): string {
  return raw
    .replace(LEX_TAG_RE, '$1')
    .replace(HTML_TAG_RE, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim()
}

function walkTipTapStructuredBlocks(
  node: TipTapNode,
  out: GlossaryPlainBlock[],
  inListItem = false,
  inBlockquote = false,
): void {
  if (!node || typeof node !== 'object') return

  if (node.type === 'heading') {
    const clean = cleanBlockText(collectNodePlainText(node))
    if (clean.length > 0) out.push({ type: 'heading', text: clean })
    return
  }

  if (node.type === 'paragraph' || node.type === 'codeBlock') {
    const clean = cleanBlockText(collectNodePlainText(node))
    if (clean.length > 0) {
      out.push({
        type: inListItem ? 'listItem' : inBlockquote ? 'quote' : 'paragraph',
        text: clean,
      })
    }
    return
  }

  if (node.type === 'listItem' || node.type === 'blockquote') {
    const nextList = inListItem || node.type === 'listItem'
    const nextQuote = inBlockquote || node.type === 'blockquote'
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        walkTipTapStructuredBlocks(child, out, nextList, nextQuote)
      }
    } else {
      const clean = cleanBlockText(collectNodePlainText(node))
      if (clean.length > 0) {
        out.push({ type: nextList ? 'listItem' : 'quote', text: clean })
      }
    }
    return
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      walkTipTapStructuredBlocks(child, out, inListItem, inBlockquote)
    }
  }
}

/**
 * Extracts strictly plain-text structured blocks from a TipTap JSON document (or plain/string body).
 * Preserves headings, quotes, list items, and full length up to generous safety limits.
 */
export function extractTipTapPlainBlocks(
  body: unknown,
  maxBlocks = 100,
  maxTotalChars = 20000,
): GlossaryPlainBlock[] {
  if (!body) return []

  let doc: unknown = body
  if (typeof body === 'string') {
    const trimmed = body.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        doc = JSON.parse(trimmed)
      } catch {
        doc = trimmed
      }
    }
  }

  const rawBlocks: GlossaryPlainBlock[] = []
  if (typeof doc === 'string') {
    for (const chunk of doc.split(/\n{2,}/)) {
      const clean = stripPlainText(chunk, maxTotalChars)
      if (clean) rawBlocks.push({ type: 'paragraph', text: clean })
    }
  } else if (doc && typeof doc === 'object') {
    walkTipTapStructuredBlocks(doc as TipTapNode, rawBlocks)
  }

  const result: GlossaryPlainBlock[] = []
  let totalChars = 0

  for (const block of rawBlocks) {
    if (result.length >= maxBlocks) break
    const remaining = maxTotalChars - totalChars
    if (remaining <= 40) break

    const text = block.text.length > remaining ? stripPlainText(block.text, remaining) : block.text
    if (!text) continue
    result.push({ type: block.type, text })
    totalChars += text.length
  }

  return result
}

/**
 * Extracts strictly plain-text paragraphs from a TipTap JSON document (or plain/string body).
 * Never emits HTML so extension popovers can safely render via `textContent`.
 */
export function extractTipTapPlainParagraphs(
  body: unknown,
  maxParagraphs = 100,
  maxTotalChars = 20000,
): string[] {
  return extractTipTapPlainBlocks(body, maxParagraphs, maxTotalChars).map((b) => b.text)
}

/**
 * Builds the compact, ETag-versioned glossary index for the Chrome extension.
 * Reuses the shared Upstash/in-memory cached loaders from `lib/glossary/terms.ts`.
 * Returns `null` when upstream loading fails so callers can return 503 instead of caching empty data.
 */
export async function buildExtensionGlossaryIndex(
  lang: SupportedExtensionLang,
): Promise<ExtensionGlossaryIndex | null> {
  const [matcherTerms, termList] = await Promise.all([
    getMatcherTermsShared(lang),
    getPublishedTermListShared(lang, { includeSummary: true }),
  ])

  if (!matcherTerms || matcherTerms.length === 0) {
    return null
  }

  const summaryBySlug = new Map<string, string>()
  for (const row of termList) {
    if (row.summary) {
      summaryBySlug.set(row.slug, stripPlainText(row.summary, 180))
    }
  }

  const items: ExtensionGlossaryTerm[] = []

  for (const term of matcherTerms) {
    const name = term.canonicalName.trim()
    if (name.length < 2) continue
    if (EXCLUDED_ALIASES.has(name.toLowerCase())) continue

    const aliases = cleanAliasList(name, term.aliases ?? [])
    const summary = summaryBySlug.get(term.slug) ?? ''
    const amb = isAmbiguousTerm(name, aliases)

    const entry: ExtensionGlossaryTerm = {
      s: term.slug,
      n: name,
      d: summary,
    }
    if (aliases.length > 0) entry.a = aliases
    if (amb) entry.amb = 1

    items.push(entry)
  }

  // Sort deterministically by slug so the ETag hash stays stable across identical snapshots
  items.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0))

  const hash = createHash('sha256')
    .update(lang)
    .update('\0')
    .update(JSON.stringify(items))
    .digest('hex')
    .slice(0, 16)

  return {
    version: hash,
    lang,
    count: items.length,
    generatedAt: new Date().toISOString(),
    items,
  }
}
