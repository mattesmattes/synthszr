import {
  compileGlossaryMatcher,
  detectPageLanguage,
  findMatchesInText,
  type CompiledGlossaryMatcher,
  type GlossaryMatch,
} from '../matcher/aho-corasick'
import { getExtensionApi } from '../shared/ext-api'
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  type BackgroundRequest,
  type BackgroundResponse,
  type ExtensionGlossaryTerm,
  type ExtensionSettings,
  type StoredGlossaryCache,
  type SupportedLang,
  type TermDetailResponse,
} from '../shared/types'
import { GlossaryPopoverController } from '../ui/popover'

const ext = getExtensionApi()

interface HitEntry {
  range: Range
  term: ExtensionGlossaryTerm
  start: number
  end: number
  surface: string
}

interface PendingNodeMatches {
  node: Text
  matches: GlossaryMatch[]
}

const HIGHLIGHT_UNDERLINE = 'synthszr-glossary'
const HIGHLIGHT_BG = 'synthszr-glossary-bg'
const MAX_HIGHLIGHTS_PER_PAGE = 600
const FRAME_BUDGET_MS = 8

const FORBIDDEN_ANCESTOR_SELECTOR = [
  'script',
  'style',
  'noscript',
  'textarea',
  'input',
  'select',
  'option',
  'code',
  'pre',
  'kbd',
  'samp',
  'svg',
  'math',
  'canvas',
  'audio',
  'video',
  'a',
  'button',
  'nav',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[role="textbox"]',
  '.CodeMirror',
  '.monaco-editor',
  '.ProseMirror',
  '.tiptap',
  'synthszr-glossary-host',
].join(', ')

const FORBIDDEN_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
  'CODE',
  'PRE',
  'KBD',
  'SAMP',
  'SVG',
  'MATH',
  'CANVAS',
  'AUDIO',
  'VIDEO',
  'A',
  'BUTTON',
  'NAV',
  'SYNTHSZR-GLOSSARY-HOST',
])

const matcherCache = new Map<SupportedLang, { version: string; matcher: CompiledGlossaryMatcher }>()

let currentSettings: ExtensionSettings = DEFAULT_SETTINGS
let activeLang: SupportedLang = 'en'
let hitMap = new WeakMap<Text, HitEntry[]>()
let scanGeneration = 0
let mutationTimer: number | null = null
let hoverRafPending = false
let lastPointer = { x: 0, y: 0 }

async function sendBg<T>(msg: BackgroundRequest): Promise<T> {
  const res = (await ext.runtime.sendMessage<BackgroundResponse<T>>(msg)) as
    | BackgroundResponse<T>
    | undefined
  if (!res || !res.ok) {
    throw new Error(res?.error || 'Synthszr background service unavailable')
  }
  return res.data
}

const popover = new GlossaryPopoverController({
  onRequestDetail: (slug, lang) =>
    sendBg<TermDetailResponse>({ type: 'GET_TERM_DETAIL', slug, lang }),
  onPauseDomain: async (hostname) => {
    const clean = hostname.toLowerCase()
    if (!currentSettings.excludedDomains.includes(clean)) {
      const next: ExtensionSettings = {
        ...currentSettings,
        excludedDomains: [...currentSettings.excludedDomains, clean],
      }
      await ext.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: next })
    }
  },
})

function isDomainExcluded(hostname: string, excluded: string[]): boolean {
  const host = hostname.toLowerCase()
  return excluded.some((domain) => {
    const d = domain.trim().toLowerCase()
    return d.length > 0 && (host === d || host.endsWith(`.${d}`))
  })
}

function isGlossarySelfPage(): boolean {
  const host = window.location.hostname.toLowerCase()
  const isSynthszr =
    host === 'synthszr.com' || host === 'www.synthszr.com' || host === 'synthszr.vercel.app'
  return isSynthszr && /^\/(de|en)\/glossary(\/|$)/.test(window.location.pathname)
}

function reportPageState(count: number, paused: boolean): void {
  void ext.runtime
    .sendMessage({ type: 'REPORT_PAGE_STATE', count, paused } satisfies BackgroundRequest)
    .catch(() => undefined)
}

function clearHighlights(): void {
  scanGeneration++
  hitMap = new WeakMap<Text, HitEntry[]>()
  CSS.highlights?.delete(HIGHLIGHT_UNDERLINE)
  CSS.highlights?.delete(HIGHLIGHT_BG)
  document.documentElement.style.cursor = ''
}

function collectEligibleTextNodes(root: Node): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.nodeValue
      if (!text || text.trim().length < 2) return NodeFilter.FILTER_REJECT

      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (FORBIDDEN_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT
      if (parent.closest(FORBIDDEN_ANCESTOR_SELECTOR)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let current = walker.nextNode()
  while (current) {
    nodes.push(current as Text)
    current = walker.nextNode()
  }
  return nodes
}

function scheduleIdle(cb: () => void): void {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => cb(), { timeout: 120 })
  } else {
    window.setTimeout(cb, 0)
  }
}

function getCaretPosition(x: number, y: number): { node: Node; offset: number } | null {
  if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(x, y)
    if (pos) return { node: pos.offsetNode, offset: pos.offset }
  }
  if (typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(x, y)
    if (range) return { node: range.startContainer, offset: range.startOffset }
  }
  return null
}

function hitTestPoint(x: number, y: number): { hit: HitEntry; rect: DOMRect } | null {
  const pos = getCaretPosition(x, y)
  if (!pos || pos.node.nodeType !== Node.TEXT_NODE) return null

  const entries = hitMap.get(pos.node as Text)
  if (!entries || entries.length === 0) return null

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (pos.offset < entry.start || pos.offset > entry.end) continue

    const rects = entry.range.getClientRects()
    for (let r = 0; r < rects.length; r++) {
      const rect = rects[r]
      if (
        x >= rect.left - 2 &&
        x <= rect.right + 2 &&
        y >= rect.top - 2 &&
        y <= rect.bottom + 2
      ) {
        return { hit: entry, rect }
      }
    }
  }

  return null
}

async function getMatcherForLang(lang: SupportedLang): Promise<CompiledGlossaryMatcher> {
  const key = lang === 'de' ? STORAGE_KEYS.INDEX_DE : STORAGE_KEYS.INDEX_EN
  const stored = await ext.storage.local.get<Record<string, StoredGlossaryCache>>([key])
  let index = stored[key]

  if (!index || !Array.isArray(index.items) || index.items.length === 0) {
    await sendBg<{ version: string; count: number }>({
      type: 'ENSURE_GLOSSARY_INDEX',
      lang,
    })
    const refreshed = await ext.storage.local.get<Record<string, StoredGlossaryCache>>([key])
    index = refreshed[key]
  } else {
    const ageMs = Date.now() - (index.fetchedAt ?? 0)
    if (ageMs > 6 * 60 * 60 * 1000) {
      void sendBg({ type: 'ENSURE_GLOSSARY_INDEX', lang }).catch(() => undefined)
    }
  }

  if (!index || !Array.isArray(index.items) || index.items.length === 0) {
    throw new Error(`Glossary index unavailable for ${lang}`)
  }

  const cached = matcherCache.get(lang)
  if (cached && cached.version === index.version) {
    return cached.matcher
  }
  const matcher = compileGlossaryMatcher(index.items)
  matcherCache.set(lang, { version: index.version, matcher })
  return matcher
}

async function scanAndHighlight(): Promise<void> {
  const gen = ++scanGeneration

  if (!CSS.highlights) return
  if (
    !currentSettings.enabled ||
    isGlossarySelfPage() ||
    isDomainExcluded(window.location.hostname, currentSettings.excludedDomains)
  ) {
    clearHighlights()
    popover.close()
    reportPageState(0, true)
    return
  }

  const bodyTextSample = document.body?.textContent?.slice(0, 3000) ?? ''
  activeLang =
    currentSettings.languageMode === 'auto'
      ? detectPageLanguage(document.documentElement.lang, bodyTextSample)
      : currentSettings.languageMode

  let matcher: CompiledGlossaryMatcher
  try {
    matcher = await getMatcherForLang(activeLang)
  } catch (err) {
    console.warn('[Synthszr Lexikon] Glossary index load failed:', err)
    return
  }

  if (gen !== scanGeneration || !document.body) return

  const textNodes = collectEligibleTextNodes(document.body)
  const pending: PendingNodeMatches[] = []
  const unambiguousSlugs = new Set<string>()
  let cursor = 0

  const processChunk = () => {
    if (gen !== scanGeneration) return
    const sliceStart = performance.now()

    while (cursor < textNodes.length) {
      const node = textNodes[cursor++]
      const value = node.nodeValue
      if (!value) continue

      const matches = findMatchesInText(matcher, value)
      if (matches.length > 0) {
        pending.push({ node, matches })
        for (let i = 0; i < matches.length; i++) {
          if (!matches[i].ambiguous) {
            unambiguousSlugs.add(matches[i].term.s)
          }
        }
      }

      if (performance.now() - sliceStart >= FRAME_BUDGET_MS && cursor < textNodes.length) {
        scheduleIdle(processChunk)
        return
      }
    }

    // Pass 2: Register non-mutating CSS Custom Highlight ranges
    const isAiPageContext = unambiguousSlugs.size >= 1
    const nextHitMap = new WeakMap<Text, HitEntry[]>()
    const ranges: Range[] = []

    for (let i = 0; i < pending.length && ranges.length < MAX_HIGHLIGHTS_PER_PAGE; i++) {
      const { node, matches } = pending[i]
      if (!node.isConnected) continue

      const entries: HitEntry[] = []
      const nodeLen = node.nodeValue?.length ?? 0

      for (let m = 0; m < matches.length && ranges.length < MAX_HIGHLIGHTS_PER_PAGE; m++) {
        const match = matches[m]
        if (match.ambiguous && !isAiPageContext) continue
        if (match.end > nodeLen) continue

        const range = document.createRange()
        range.setStart(node, match.start)
        range.setEnd(node, match.end)
        ranges.push(range)
        entries.push({
          range,
          term: match.term,
          start: match.start,
          end: match.end,
          surface: match.surface,
        })
      }

      if (entries.length > 0) {
        nextHitMap.set(node, entries)
      }
    }

    if (gen !== scanGeneration) return

    hitMap = nextHitMap
    const activeHighlightName =
      currentSettings.highlightStyle === 'subtle-bg' ? HIGHLIGHT_BG : HIGHLIGHT_UNDERLINE
    const inactiveHighlightName =
      activeHighlightName === HIGHLIGHT_BG ? HIGHLIGHT_UNDERLINE : HIGHLIGHT_BG

    CSS.highlights?.delete(inactiveHighlightName)
    if (ranges.length > 0) {
      const highlight = new Highlight(...ranges)
      highlight.priority = 1
      CSS.highlights?.set(activeHighlightName, highlight)
    } else {
      CSS.highlights?.delete(activeHighlightName)
    }
    reportPageState(ranges.length, false)
  }

  scheduleIdle(processChunk)
}

function setupListeners(): void {
  document.addEventListener(
    'mousemove',
    (e: MouseEvent) => {
      lastPointer = { x: e.clientX, y: e.clientY }
      if (hoverRafPending) return
      hoverRafPending = true
      window.requestAnimationFrame(() => {
        hoverRafPending = false
        if (popover.isEventInside(e.target)) {
          document.documentElement.style.cursor = ''
          return
        }
        const hit = hitTestPoint(lastPointer.x, lastPointer.y)
        document.documentElement.style.cursor = hit ? 'pointer' : ''
      })
    },
    { passive: true },
  )

  document.addEventListener('click', (e: MouseEvent) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    if (popover.isEventInside(e.target)) return
    if (e.target instanceof Element && e.target.closest('a[href], button, [role="button"]')) {
      return
    }

    const result = hitTestPoint(e.clientX, e.clientY)
    if (!result) return

    e.stopPropagation()
    popover.open(result.hit.term, result.hit.surface, result.rect, activeLang)
  })

  if (document.body) {
    const observer = new MutationObserver((mutations) => {
      let hasRelevantChange = false
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i]
        if (m.target instanceof Element && m.target.closest('synthszr-glossary-host')) continue
        if (m.addedNodes.length > 0) {
          for (let j = 0; j < m.addedNodes.length; j++) {
            const added = m.addedNodes[j]
            if (added instanceof Element && added.tagName === 'SYNTHSZR-GLOSSARY-HOST') {
              continue
            }
            hasRelevantChange = true
            break
          }
        }
        if (hasRelevantChange) break
      }

      if (!hasRelevantChange) return
      if (mutationTimer !== null) window.clearTimeout(mutationTimer)
      mutationTimer = window.setTimeout(() => {
        mutationTimer = null
        void scanAndHighlight()
      }, 450)
    })

    observer.observe(document.body, { childList: true, subtree: true })
  }

  ext.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return
    const next = changes[STORAGE_KEYS.SETTINGS]?.newValue as ExtensionSettings | undefined
    if (!next) return
    currentSettings = { ...DEFAULT_SETTINGS, ...next }
    void scanAndHighlight()
  })
}

async function init(): Promise<void> {
  if (!CSS.highlights) return
  if (document.contentType && document.contentType !== 'text/html') return

  const stored = await ext.storage.sync.get<Record<string, ExtensionSettings>>([
    STORAGE_KEYS.SETTINGS,
  ])
  if (stored[STORAGE_KEYS.SETTINGS]) {
    currentSettings = { ...DEFAULT_SETTINGS, ...stored[STORAGE_KEYS.SETTINGS] }
  }

  setupListeners()
  await scanAndHighlight()
}

void init()
