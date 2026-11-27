import type { HighlightStyle } from '../shared/types'

export const MARKER_LAYER_ID = 'synthszr-glossary-marker-layer'

function parseRgbLuminance(color: string): number | null {
  const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i)
  if (!match) return null
  const r = Number(match[1])
  const g = Number(match[2])
  const b = Number(match[3])
  const a = match[4] !== undefined ? Number(match[4]) : 1
  if (a <= 0.1) return null
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function isDarkBackdrop(): boolean {
  const bodyBg = document.body ? window.getComputedStyle(document.body).backgroundColor : ''
  const htmlBg = window.getComputedStyle(document.documentElement).backgroundColor
  const lum = parseRgbLuminance(bodyBg) ?? parseRgbLuminance(htmlBg)
  if (lum !== null) return lum < 128
  return false
}

interface AnchorSample {
  range: Range
  expectedDocBottom: number
}

/**
 * Renders 6px `#CCFF00` neon-lime markers inside a document-space `position: absolute` layer
 * so Chrome/Safari scroll the markers in hardware lockstep with the page text (0 ms lag).
 * Uses `mix-blend-mode: multiply` (light pages) or `screen` (dark pages) so upper 3px overlap
 * sits cleanly behind glyphs with zero host text DOM mutation.
 */
export class GlossaryMarkerOverlay {
  private layer: HTMLDivElement | null = null
  private ranges: Range[] = []
  private styleMode: HighlightStyle = 'underline'
  private listenersAttached = false
  private fontsHooked = false
  private resizeObserver: ResizeObserver | null = null
  private resizeTimer: number | null = null
  private driftTimer: number | null = null
  private innerScrollTimer: number | null = null
  private anchorSample: AnchorSample | null = null

  private readonly onResize = () => {
    if (this.ranges.length === 0) return
    if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer)
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = null
      this.renderNow()
    }, 120)
  }

  private readonly onScroll = (e: Event) => {
    if (this.ranges.length === 0 || !this.layer) return

    const isDocScroll =
      e.target === document ||
      e.target === window ||
      e.target === document.documentElement ||
      (document.scrollingElement === document.body && e.target === document.body)

    if (isDocScroll) {
      // Document scrolls move `layer` in lockstep on the GPU compositor: keep 100% visible
      // and only run a quick post-scroll drift check after scrolling settles.
      if (this.driftTimer !== null) window.clearTimeout(this.driftTimer)
      this.driftTimer = window.setTimeout(() => {
        this.driftTimer = null
        this.checkDriftAndSync()
      }, 220)
      return
    }

    // Inner overflow-scroll containers move independently of `documentElement`:
    // temporarily hide markers while scrolling inside them and resync once settled.
    this.layer.style.opacity = '0'
    if (this.innerScrollTimer !== null) window.clearTimeout(this.innerScrollTimer)
    this.innerScrollTimer = window.setTimeout(() => {
      this.innerScrollTimer = null
      this.renderNow()
    }, 180)
  }

  setRanges(ranges: Range[], styleMode: HighlightStyle): void {
    this.ranges = ranges
    this.styleMode = styleMode

    if (ranges.length === 0) {
      this.clear()
      return
    }

    this.ensureLayer()
    this.attachListeners()
    this.renderNow()
  }

  clear(): void {
    this.ranges = []
    this.anchorSample = null
    this.clearTimers()
    this.detachListeners()
    if (this.layer) {
      this.layer.remove()
      this.layer = null
    }
  }

  private clearTimers(): void {
    if (this.resizeTimer !== null) {
      window.clearTimeout(this.resizeTimer)
      this.resizeTimer = null
    }
    if (this.driftTimer !== null) {
      window.clearTimeout(this.driftTimer)
      this.driftTimer = null
    }
    if (this.innerScrollTimer !== null) {
      window.clearTimeout(this.innerScrollTimer)
      this.innerScrollTimer = null
    }
  }

  private ensureLayer(): HTMLDivElement {
    if (this.layer && this.layer.isConnected) {
      return this.layer
    }
    const existing = document.getElementById(MARKER_LAYER_ID)
    if (existing) existing.remove()

    const layer = document.createElement('div')
    layer.id = MARKER_LAYER_ID
    layer.setAttribute('aria-hidden', 'true')
    layer.style.position = 'absolute'
    layer.style.top = '0'
    layer.style.left = '0'
    layer.style.width = '100%'
    layer.style.height = '1px'
    layer.style.overflow = 'hidden'
    layer.style.pointerEvents = 'none'
    layer.style.zIndex = '2147483640'
    layer.style.transition = 'opacity 120ms ease-out'
    document.documentElement.appendChild(layer)
    this.layer = layer
    return layer
  }

  private attachListeners(): void {
    if (!this.listenersAttached) {
      this.listenersAttached = true
      window.addEventListener('resize', this.onResize, { passive: true })
      window.addEventListener('scroll', this.onScroll, { capture: true, passive: true })

      if (typeof ResizeObserver !== 'undefined' && document.body) {
        this.resizeObserver = new ResizeObserver(() => {
          if (this.ranges.length === 0) return
          if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer)
          this.resizeTimer = window.setTimeout(() => {
            this.resizeTimer = null
            this.renderNow()
          }, 150)
        })
        this.resizeObserver.observe(document.body)
      }
    }

    if (!this.fontsHooked && document.fonts?.ready) {
      this.fontsHooked = true
      void document.fonts.ready.then(() => {
        if (this.ranges.length > 0) this.renderNow()
      })
    }
  }

  private detachListeners(): void {
    if (!this.listenersAttached) return
    this.listenersAttached = false
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('scroll', this.onScroll, true)
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }
  }

  private checkDriftAndSync(): void {
    if (this.ranges.length === 0 || !this.layer || !this.anchorSample) return
    const { range, expectedDocBottom } = this.anchorSample
    if (!range.startContainer.isConnected) {
      this.renderNow()
      return
    }
    const rect = range.getClientRects()[0]
    if (!rect) return
    const origin = this.layer.getBoundingClientRect()
    const currentDocBottom = rect.bottom - origin.top
    if (Math.abs(currentDocBottom - expectedDocBottom) > 1.5) {
      this.renderNow()
    }
  }

  private renderNow(): void {
    if (this.ranges.length === 0) return
    const layer = this.ensureLayer()
    const dark = isDarkBackdrop()
    layer.style.mixBlendMode = dark ? 'screen' : 'multiply'

    const origin = layer.getBoundingClientRect()
    const fragment = document.createDocumentFragment()
    const barColor = dark ? 'rgba(204, 255, 0, 0.85)' : '#ccff00'
    const bgColor = dark ? 'rgba(204, 255, 0, 0.22)' : 'rgba(204, 255, 0, 0.30)'

    let maxBottom = 1
    let firstAnchor: AnchorSample | null = null

    for (let i = 0; i < this.ranges.length; i++) {
      const range = this.ranges[i]
      if (!range.startContainer.isConnected) continue

      const rects = range.getClientRects()
      for (let r = 0; r < rects.length; r++) {
        const rect = rects[r]
        if (rect.width < 1 || rect.height < 1) continue

        const docLeft = rect.left - origin.left
        const docTop = rect.top - origin.top
        const docBottom = rect.bottom - origin.top

        if (!firstAnchor) {
          firstAnchor = { range, expectedDocBottom: docBottom }
        }

        if (this.styleMode === 'subtle-bg') {
          const bgEl = document.createElement('div')
          bgEl.style.position = 'absolute'
          bgEl.style.left = `${Math.round(docLeft)}px`
          bgEl.style.top = `${Math.round(docTop)}px`
          bgEl.style.width = `${Math.round(rect.width)}px`
          bgEl.style.height = `${Math.round(rect.height)}px`
          bgEl.style.background = bgColor
          bgEl.style.pointerEvents = 'none'
          fragment.appendChild(bgEl)
        }

        const baselineOffset = Math.max(2, Math.round(rect.height * 0.16))
        const barHeight = 6
        const barY = Math.round(docBottom - baselineOffset - 3)

        const barEl = document.createElement('div')
        barEl.style.position = 'absolute'
        barEl.style.left = `${Math.round(docLeft - 1)}px`
        barEl.style.top = `${barY}px`
        barEl.style.width = `${Math.round(rect.width + 2)}px`
        barEl.style.height = `${barHeight}px`
        barEl.style.background = barColor
        barEl.style.borderRadius = '1px'
        barEl.style.pointerEvents = 'none'
        fragment.appendChild(barEl)

        const bottomEdge = barY + barHeight
        if (bottomEdge > maxBottom) maxBottom = bottomEdge
      }
    }

    this.anchorSample = firstAnchor
    layer.style.height = `${Math.max(1, Math.ceil(maxBottom + 12))}px`
    layer.replaceChildren(fragment)
    layer.style.opacity = '1'
  }
}
