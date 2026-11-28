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
import { GlossaryMarkerOverlay, MARKER_LAYER_ID } from '../ui/marker-overlay'
import { GlossaryPopoverController } from '../ui/popover'

const ext = getExtensionApi()
const API_BASE = 'https://www.synthszr.com'

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
  `#${MARKER_LAYER_ID}`,
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

const matcherCache = new Map<
  SupportedLang,
  { version: string; fetchedAt: number; matcher: CompiledGlossaryMatcher }
>()
const markerOverlay = new GlossaryMarkerOverlay()

let currentSettings: ExtensionSettings = DEFAULT_SETTINGS
let activeLang: SupportedLang = 'en'
let hitMap = new WeakMap<Text, HitEntry[]>()
let scannedNodes = new WeakSet<Text>()
let activeRanges: Range[] = []
let activeHighlightCount = 0
let pageUnambiguousSlugs = new Set<string>()
const pendingMutationRoots = new Set<Node>()
let fullScanRunning = false
let scanGeneration = 0
let mutationTimer: number | null = null
let hoverRafPending = false
let lastPointer = { x: 0, y: 0 }

async function fetchWithTimeout(url: string, timeoutMs = 6500): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

async function sendBgOnce<T>(msg: BackgroundRequest, timeoutMs: number): Promise<T> {
  let timerId: number | null = null
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = window.setTimeout(() => reject(new Error('Background IPC timeout')), timeoutMs)
    })
    const res = (await Promise.race([
      ext.runtime.sendMessage<BackgroundResponse<T>>(msg),
      timeoutPromise,
    ])) as BackgroundResponse<T> | undefined
    if (!res || !res.ok) {
      throw new Error(res?.error || 'Synthszr background service unavailable')
    }
    return res.data
  } finally {
    if (timerId !== null) window.clearTimeout(timerId)
  }
}

async function sendBg<T>(msg: BackgroundRequest, timeoutMs = 4500): Promise<T> {
  try {
    return await sendBgOnce<T>(msg, timeoutMs)
  } catch (firstErr) {
    await new Promise((resolve) => window.setTimeout(resolve, 200))
    try {
      return await sendBgOnce<T>(msg, timeoutMs)
    } catch {
      throw firstErr
    }
  }
}

async function requestTermDetail(slug: string, lang: SupportedLang): Promise<TermDetailResponse> {
  try {
    return await sendBg<TermDetailResponse>({ type: 'GET_TERM_DETAIL', slug, lang })
  } catch {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/glossary/term/${encodeURIComponent(slug)}?lang=${lang}`,
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as TermDetailResponse
  }
}

async function requestTermIllustration(slug: string): Promise<{ base64: string }> {
  try {
    return await sendBg<{ base64: string }>({ type: 'GET_TERM_ILLUSTRATION', slug })
  } catch {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/glossary/term/${encodeURIComponent(slug)}/illustration`,
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return { base64: arrayBufferToBase64(await res.arrayBuffer()) }
  }
}

const popover = new GlossaryPopoverController({
  onRequestDetail: requestTermDetail,
  onRequestIllustration: requestTermIllustration,
  onPauseDomain: async (hostname) => {
    const clean = hostname.toLowerCase()
    if (!currentSettings.excludedDomains.includes(clean)) {
      const next: ExtensionSettings = {
        ...currentSettings,
        excludedDomains: [...currentSettings.excludedDomains, clean],
      }
      await ext.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: next }).catch(() => undefined)
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

function isInsideFixedContainer(
  el: Element | null,
  fixedCache?: WeakMap<Element, boolean>,
): boolean {
  if (!el) return false
  const cached = fixedCache?.get(el)
  if (cached !== undefined) return cached

  let cur: Element | null = el
  let hops = 0
  let result = false
  while (cur && cur !== document.body && cur !== document.documentElement && hops < 12) {
    const stepCached = fixedCache?.get(cur)
    if (stepCached !== undefined) {
      result = stepCached
      break
    }
    if (window.getComputedStyle(cur).position === 'fixed') {
      result = true
      break
    }
    cur = cur.parentElement
    hops++
  }
  fixedCache?.set(el, result)
  return result
}

function clearHighlights(): void {
  scanGeneration++
  fullScanRunning = false
  hitMap = new WeakMap<Text, HitEntry[]>()
  scannedNodes = new WeakSet<Text>()
  activeRanges = []
  activeHighlightCount = 0
  pageUnambiguousSlugs = new Set<string>()
  pendingMutationRoots.clear()
  markerOverlay.clear()
  document.documentElement.style.cursor = ''
}

function isTextNodeEligible(node: Text): boolean {
  const text = node.nodeValue
  if (!text || text.trim().length < 2) return false
  const parent = node.parentElement
  if (!parent) return false
  if (FORBIDDEN_TAGS.has(parent.tagName)) return false
  if (parent.closest(FORBIDDEN_ANCESTOR_SELECTOR)) return false
  return true
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

function samplePageText(root: Node | null, maxChars = 3000): string {
  if (!root) return ''
  let sample = ''
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || FORBIDDEN_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let current = walker.nextNode()
  while (current && sample.length < maxChars) {
    const val = current.nodeValue
    if (val) {
      const trimmed = val.trim()
      if (trimmed.length > 0) {
        sample += (sample ? ' ' : '') + trimmed
      }
    }
    current = walker.nextNode()
  }
  return sample.slice(0, maxChars)
}

function resolveActiveLang(): SupportedLang {
  if (currentSettings.languageMode !== 'auto') return currentSettings.languageMode
  const htmlLang = document.documentElement.lang?.trim().toLowerCase() ?? ''
  if (htmlLang.startsWith('de')) return 'de'
  if (htmlLang.startsWith('en')) return 'en'
  return detectPageLanguage(document.documentElement.lang, samplePageText(document.body, 3000))
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
  const memoryCached = matcherCache.get(lang)
  if (memoryCached) {
    const ageMs = Date.now() - memoryCached.fetchedAt
    if (ageMs > 6 * 60 * 60 * 1000) {
      memoryCached.fetchedAt = Date.now()
      void sendBg({ type: 'ENSURE_GLOSSARY_INDEX', lang }).catch(() => undefined)
    }
    return memoryCached.matcher
  }

  const key = lang === 'de' ? STORAGE_KEYS.INDEX_DE : STORAGE_KEYS.INDEX_EN
  const stored = await ext.storage.local
    .get<Record<string, StoredGlossaryCache>>([key])
    .catch(() => ({}) as Record<string, StoredGlossaryCache>)
  let index: StoredGlossaryCache | undefined = stored[key]

  if (!index || !Array.isArray(index.items) || index.items.length === 0) {
    try {
      await sendBg<{ version: string; count: number }>({
        type: 'ENSURE_GLOSSARY_INDEX',
        lang,
      })
      const refreshed = await ext.storage.local
        .get<Record<string, StoredGlossaryCache>>([key])
        .catch(() => ({}) as Record<string, StoredGlossaryCache>)
      index = refreshed[key]
    } catch {
      // Fallback to direct CORS fetch if background IPC stalled
    }
  } else {
    const ageMs = Date.now() - (index.fetchedAt ?? 0)
    if (ageMs > 6 * 60 * 60 * 1000) {
      void sendBg({ type: 'ENSURE_GLOSSARY_INDEX', lang }).catch(() => undefined)
    }
  }

  if (!index || !Array.isArray(index.items) || index.items.length === 0) {
    const res = await fetchWithTimeout(`${API_BASE}/api/glossary/extension-index?lang=${lang}`, 8000)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const payload = (await res.json()) as {
      version: string
      lang: SupportedLang
      count: number
      generatedAt: string
      items: StoredGlossaryCache['items']
    }
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      throw new Error(`Glossary index unavailable for ${lang}`)
    }
    index = {
      version: payload.version,
      lang: payload.lang,
      count: payload.count,
      generatedAt: payload.generatedAt,
      fetchedAt: Date.now(),
      items: payload.items,
    }
    await ext.storage.local.set({ [key]: index }).catch(() => undefined)
  }

  const matcher = compileGlossaryMatcher(index.items)
  matcherCache.set(lang, {
    version: index.version,
    fetchedAt: index.fetchedAt ?? Date.now(),
    matcher,
  })
  return matcher
}

async function scanAndHighlight(): Promise<void> {
  const gen = ++scanGeneration
  fullScanRunning = true
  pendingMutationRoots.clear()

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

  activeLang = resolveActiveLang()

  let matcher: CompiledGlossaryMatcher
  try {
    matcher = await getMatcherForLang(activeLang)
  } catch (err) {
    fullScanRunning = false
    console.warn('[Synthszr Lexikon] Glossary index load failed:', err)
    return
  }

  if (gen !== scanGeneration || !document.body) {
    fullScanRunning = false
    return
  }

  const nextScannedNodes = new WeakSet<Text>()
  const textNodes = collectEligibleTextNodes(document.body)
  for (let i = 0; i < textNodes.length; i++) {
    nextScannedNodes.add(textNodes[i])
  }

  const pending: PendingNodeMatches[] = []
  const unambiguousSlugs = new Set<string>()
  let cursor = 0

  const processChunk = () => {
    if (gen !== scanGeneration) {
      fullScanRunning = false
      return
    }
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

    // Pass 2: Collect non-mutating Range highlights & render 6px overlapping neon-lime marker canvas
    const isAiPageContext = unambiguousSlugs.size >= 1
    const nextHitMap = new WeakMap<Text, HitEntry[]>()
    const ranges: Range[] = []
    const fixedCache = new WeakMap<Element, boolean>()

    for (let i = 0; i < pending.length && ranges.length < MAX_HIGHLIGHTS_PER_PAGE; i++) {
      const { node, matches } = pending[i]
      if (!node.isConnected) continue
      if (isInsideFixedContainer(node.parentElement, fixedCache)) continue

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

    if (gen !== scanGeneration) {
      fullScanRunning = false
      return
    }

    fullScanRunning = false
    scannedNodes = nextScannedNodes
    hitMap = nextHitMap
    pageUnambiguousSlugs = unambiguousSlugs
    activeRanges = ranges
    activeHighlightCount = ranges.length
    markerOverlay.setRanges(ranges, currentSettings.highlightStyle)
    const nativeGlossaryCount = document.querySelectorAll('a[data-glossary-slug]').length
    reportPageState(ranges.length + nativeGlossaryCount, false)
  }

  scheduleIdle(processChunk)
}

function collectNewTextNodesFromRoots(roots: Node[]): Text[] {
  const collected: Text[] = []
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i]
    if (!root.isConnected) continue

    if (root.nodeType === Node.TEXT_NODE) {
      const textNode = root as Text
      if (!scannedNodes.has(textNode) && isTextNodeEligible(textNode)) {
        scannedNodes.add(textNode)
        collected.push(textNode)
      }
      continue
    }

    if (root instanceof Element) {
      if (FORBIDDEN_TAGS.has(root.tagName) || root.closest(FORBIDDEN_ANCESTOR_SELECTOR)) {
        continue
      }
      const nodes = collectEligibleTextNodes(root)
      for (let j = 0; j < nodes.length; j++) {
        const n = nodes[j]
        if (!scannedNodes.has(n)) {
          scannedNodes.add(n)
          collected.push(n)
        }
      }
    }
  }
  return collected
}

function scheduleMutationFlush(delayMs = 450): void {
  if (mutationTimer !== null) window.clearTimeout(mutationTimer)
  mutationTimer = window.setTimeout(() => {
    mutationTimer = null
    void scanIncrementalRoots()
  }, delayMs)
}

async function scanIncrementalRoots(): Promise<void> {
  if (fullScanRunning) {
    if (pendingMutationRoots.size > 0) scheduleMutationFlush(250)
    return
  }

  if (
    !currentSettings.enabled ||
    isGlossarySelfPage() ||
    isDomainExcluded(window.location.hostname, currentSettings.excludedDomains)
  ) {
    pendingMutationRoots.clear()
    return
  }

  const cachedEntry = matcherCache.get(activeLang)
  if (!cachedEntry) {
    pendingMutationRoots.clear()
    await scanAndHighlight()
    return
  }
  const matcher = cachedEntry.matcher

  const roots = Array.from(pendingMutationRoots)
  pendingMutationRoots.clear()
  if (roots.length === 0) return

  const prevRangeCount = activeRanges.length
  const connectedRanges = activeRanges.filter((r) => r.startContainer.isConnected)
  const droppedDisconnected = connectedRanges.length !== prevRangeCount
  activeRanges = connectedRanges
  activeHighlightCount = activeRanges.length

  const newTextNodes = collectNewTextNodesFromRoots(roots)
  if (newTextNodes.length === 0) {
    if (droppedDisconnected) {
      markerOverlay.setRanges(activeRanges, currentSettings.highlightStyle)
      const nativeGlossaryCount = document.querySelectorAll('a[data-glossary-slug]').length
      reportPageState(activeRanges.length + nativeGlossaryCount, false)
    }
    return
  }

  const gen = scanGeneration
  const hadAiContextBefore = pageUnambiguousSlugs.size >= 1
  const pending: PendingNodeMatches[] = []
  let cursor = 0

  const processIncrementalChunk = () => {
    if (gen !== scanGeneration) return
    const sliceStart = performance.now()

    while (cursor < newTextNodes.length) {
      const node = newTextNodes[cursor++]
      const value = node.nodeValue
      if (!value) continue

      const matches = findMatchesInText(matcher, value)
      if (matches.length > 0) {
        pending.push({ node, matches })
        for (let i = 0; i < matches.length; i++) {
          if (!matches[i].ambiguous) {
            pageUnambiguousSlugs.add(matches[i].term.s)
          }
        }
      }

      if (performance.now() - sliceStart >= FRAME_BUDGET_MS && cursor < newTextNodes.length) {
        scheduleIdle(processIncrementalChunk)
        return
      }
    }

    if (gen !== scanGeneration) return

    // If newly inserted text promoted page context to AI-relevant, perform one full rescan
    // so previously skipped ambiguous terms elsewhere on the page become active.
    if (!hadAiContextBefore && pageUnambiguousSlugs.size >= 1) {
      void scanAndHighlight()
      return
    }

    const isAiPageContext = pageUnambiguousSlugs.size >= 1
    const fixedCache = new WeakMap<Element, boolean>()
    let addedAny = false

    for (let i = 0; i < pending.length && activeRanges.length < MAX_HIGHLIGHTS_PER_PAGE; i++) {
      const { node, matches } = pending[i]
      if (!node.isConnected) continue
      if (isInsideFixedContainer(node.parentElement, fixedCache)) continue

      const existingEntries = hitMap.get(node) ?? []
      const entries: HitEntry[] = [...existingEntries]
      const nodeLen = node.nodeValue?.length ?? 0

      for (let m = 0; m < matches.length && activeRanges.length < MAX_HIGHLIGHTS_PER_PAGE; m++) {
        const match = matches[m]
        if (match.ambiguous && !isAiPageContext) continue
        if (match.end > nodeLen) continue

        const range = document.createRange()
        range.setStart(node, match.start)
        range.setEnd(node, match.end)
        activeRanges.push(range)
        entries.push({
          range,
          term: match.term,
          start: match.start,
          end: match.end,
          surface: match.surface,
        })
        addedAny = true
      }

      if (entries.length > 0) {
        hitMap.set(node, entries)
      }
    }

    if (addedAny || droppedDisconnected) {
      activeHighlightCount = activeRanges.length
      markerOverlay.setRanges(activeRanges, currentSettings.highlightStyle)
      const nativeGlossaryCount = document.querySelectorAll('a[data-glossary-slug]').length
      reportPageState(activeRanges.length + nativeGlossaryCount, false)
    }
  }

  scheduleIdle(processIncrementalChunk)
}

function setupListeners(): void {
  document.addEventListener(
    'mousemove',
    (e: MouseEvent) => {
      if (activeHighlightCount === 0) return
      lastPointer = { x: e.clientX, y: e.clientY }
      if (hoverRafPending) return
      hoverRafPending = true
      window.requestAnimationFrame(() => {
        hoverRafPending = false
        if (activeHighlightCount === 0 || popover.isEventInside(e.target)) {
          document.documentElement.style.cursor = ''
          return
        }
        const hit = hitTestPoint(lastPointer.x, lastPointer.y)
        document.documentElement.style.cursor = hit ? 'pointer' : ''
      })
    },
    { passive: true },
  )

  document.addEventListener(
    'click',
    (e: MouseEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
      if (popover.isEventInside(e.target)) return

      if (
        currentSettings.enabled &&
        !isGlossarySelfPage() &&
        !isDomainExcluded(window.location.hostname, currentSettings.excludedDomains)
      ) {
        const nativeAnchor =
          e.target instanceof Element
            ? e.target.closest<HTMLAnchorElement>('a[data-glossary-slug]')
            : null
        if (nativeAnchor) {
          const slug = (nativeAnchor.getAttribute('data-glossary-slug') ?? '').trim()
          if (/^[a-z0-9-]{1,120}$/.test(slug)) {
            e.preventDefault()
            e.stopPropagation()

            const href = nativeAnchor.getAttribute('href') ?? ''
            const langMatch = href.match(/^\/(de|en)\/glossary\//)
            const linkLang: SupportedLang =
              langMatch?.[1] === 'en' ? 'en' : langMatch?.[1] === 'de' ? 'de' : activeLang
            const surface = (nativeAnchor.textContent ?? '').trim() || slug
            const cachedTerm =
              matcherCache.get(linkLang)?.matcher.termBySlug.get(slug) ??
              matcherCache.get(activeLang)?.matcher.termBySlug.get(slug) ?? {
                s: slug,
                n: surface,
                d: '',
              }

            popover.open(cachedTerm, surface, nativeAnchor.getBoundingClientRect(), linkLang)
            return
          }
        }
      }

      if (e.target instanceof Element && e.target.closest('a[href], button, [role="button"]')) {
        return
      }

      const result = hitTestPoint(e.clientX, e.clientY)
      if (!result) return

      e.stopPropagation()
      popover.open(result.hit.term, result.hit.surface, result.rect, activeLang)
    },
    true,
  )

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
              (added.tagName === 'SYNTHSZR-GLOSSARY-HOST' || added.id === MARKER_LAYER_ID)
            ) {
              continue
            }
            if (added.nodeType === Node.ELEMENT_NODE || added.nodeType === Node.TEXT_NODE) {
              pendingMutationRoots.add(added)
              hasRelevantChange = true
            }
          }
        }
      }

      if (!hasRelevantChange) return
      scheduleMutationFlush(450)
    })

    observer.observe(document.body, { childList: true, subtree: true })
  }

  ext.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
      const next = changes[STORAGE_KEYS.SETTINGS]?.newValue as ExtensionSettings | undefined
      if (!next) return
      currentSettings = { ...DEFAULT_SETTINGS, ...next }
      void scanAndHighlight()
      return
    }

    if (areaName === 'local') {
      let shouldRescan = false
      if (STORAGE_KEYS.INDEX_DE in changes) {
        matcherCache.delete('de')
        if (activeLang === 'de') shouldRescan = true
      }
      if (STORAGE_KEYS.INDEX_EN in changes) {
        matcherCache.delete('en')
        if (activeLang === 'en') shouldRescan = true
      }
      if (shouldRescan) {
        void scanAndHighlight()
      }
    }
  })
}

async function init(): Promise<void> {
  if (document.contentType && document.contentType !== 'text/html') return

  try {
    const stored = await ext.storage.sync.get<Record<string, ExtensionSettings>>([
      STORAGE_KEYS.SETTINGS,
    ])
    if (stored[STORAGE_KEYS.SETTINGS]) {
      currentSettings = { ...DEFAULT_SETTINGS, ...stored[STORAGE_KEYS.SETTINGS] }
    }
  } catch {
    // Use defaults if storage.sync is restricted
  }

  setupListeners()
  await scanAndHighlight()
}

void init()
