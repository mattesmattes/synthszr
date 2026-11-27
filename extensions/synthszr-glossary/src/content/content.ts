import {
  compileGlossaryMatcher,
  detectPageLanguage,
  findMatchesInText,
  type CompiledGlossaryMatcher,
  type GlossaryMatch,
} from '../matcher/aho-corasick'
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  type BackgroundRequest,
  type BackgroundResponse,
  type ExtensionGlossaryTerm,
  type ExtensionSettings,
  type HighlightStyle,
  type StoredGlossaryCache,
  type SupportedLang,
  type TermDetailResponse,
} from '../shared/types'
import { GlossaryPopoverController } from '../ui/popover'

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

const HIGHLIGHT_NAME = 'synthszr-glossary'
const STYLE_ELEMENT_ID = 'synthszr-glossary-highlight-css'
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
  const res = (await chrome.runtime.sendMessage<BackgroundResponse<T>>(msg)) as
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
      await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: next })
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

function injectHighlightStyles(styleMode: HighlightStyle): void {
  let styleEl = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = STYLE_ELEMENT_ID
    ;(document.head ?? document.documentElement).appendChild(styleEl)
  }

  const css =
    styleMode === 'subtle-bg'
      ? `
::highlight(${HIGHLIGHT_NAME}) {
  background-color: rgba(204, 255, 0, 0.30);
  text-decoration: underline rgba(180, 145, 0, 0.85) 1.5px;
  text-underline-offset: 3px;
}
`
      : `
::highlight(${HIGHLIGHT_NAME}) {
  background-color: rgba(250, 215, 20, 0.14);
  text-decoration: underline rgba(224, 180, 0, 0.92) 2px;
  text-underline-offset: 3px;
}
`

  if (styleEl.textContent !== css) {
    styleEl.textContent = css
  }
}

function clearHighlights(): void {
  scanGeneration++
  hitMap = new WeakMap<Text, HitEntry[]>()
  CSS.highlights?.delete(HIGHLIGHT_NAME)
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
  const index = await sendBg<StoredGlossaryCache>({ type: 'GET_GLOSSARY_INDEX', lang })
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
    isDomainExcluded(window.location.hostname, currentSettings.excludedDomains)
  ) {
    clearHighlights()
    popover.close()
    return
  }

  injectHighlightStyles(currentSettings.highlightStyle)

  const bodyTextSample = document.body?.innerText?.slice(0, 3000) ?? ''
  activeLang =
    currentSettings.languageMode === 'auto'
      ? detectPageLanguage(document.documentElement.lang, bodyTextSample)
      : currentSettings.languageMode

  let matcher: CompiledGlossaryMatcher
  try {
    matcher = await getMatcherForLang(activeLang)
  } catch {
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
    const isAiPageContext = unambiguousSlugs.size >= 2
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
    if (ranges.length > 0) {
      const highlight = new Highlight(...ranges)
      highlight.priority = 1
      CSS.highlights?.set(HIGHLIGHT_NAME, highlight)
    } else {
      CSS.highlights?.delete(HIGHLIGHT_NAME)
    }
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
            if (
              added instanceof Element &&
              (added.tagName === 'SYNTHSZR-GLOSSARY-HOST' || added.id === STYLE_ELEMENT_ID)
            ) {
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

  chrome.storage.onChanged.addListener((changes, areaName) => {
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

  const stored = await chrome.storage.sync.get<Record<string, ExtensionSettings>>([
    STORAGE_KEYS.SETTINGS,
  ])
  if (stored[STORAGE_KEYS.SETTINGS]) {
    currentSettings = { ...DEFAULT_SETTINGS, ...stored[STORAGE_KEYS.SETTINGS] }
  }

  setupListeners()
  await scanAndHighlight()
}

void init()
