import type { HighlightStyle } from '../shared/types'

export const MARKER_CANVAS_ID = 'synthszr-glossary-marker-canvas'

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

/**
 * Renders non-mutating 6px `#CCFF00` neon-lime baseline bars whose upper 3px
 * overlap behind the lower typography using `mix-blend-mode: multiply` (light pages)
 * or `screen` (dark pages). Zero host DOM text nodes are modified.
 */
export class GlossaryMarkerOverlay {
  private canvas: HTMLCanvasElement | null = null
  private ranges: Range[] = []
  private styleMode: HighlightStyle = 'underline'
  private rafPending = false
  private listenersAttached = false

  private readonly onViewportChange = () => {
    this.scheduleDraw()
  }

  setRanges(ranges: Range[], styleMode: HighlightStyle): void {
    this.ranges = ranges
    this.styleMode = styleMode

    if (ranges.length === 0) {
      this.clear()
      return
    }

    this.ensureCanvas()
    this.attachListeners()
    this.scheduleDraw()
  }

  clear(): void {
    this.ranges = []
    this.rafPending = false
    this.detachListeners()
    if (this.canvas) {
      this.canvas.remove()
      this.canvas = null
    }
  }

  private ensureCanvas(): HTMLCanvasElement {
    if (this.canvas && this.canvas.isConnected) {
      return this.canvas
    }
    const existing = document.getElementById(MARKER_CANVAS_ID) as HTMLCanvasElement | null
    if (existing) existing.remove()

    const canvas = document.createElement('canvas')
    canvas.id = MARKER_CANVAS_ID
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.position = 'fixed'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.width = '100vw'
    canvas.style.height = '100vh'
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '2147483640'
    document.documentElement.appendChild(canvas)
    this.canvas = canvas
    return canvas
  }

  private attachListeners(): void {
    if (this.listenersAttached) return
    this.listenersAttached = true
    window.addEventListener('scroll', this.onViewportChange, { capture: true, passive: true })
    window.addEventListener('resize', this.onViewportChange, { passive: true })
  }

  private detachListeners(): void {
    if (!this.listenersAttached) return
    this.listenersAttached = false
    window.removeEventListener('scroll', this.onViewportChange, true)
    window.removeEventListener('resize', this.onViewportChange)
  }

  private scheduleDraw(): void {
    if (this.rafPending || this.ranges.length === 0) return
    this.rafPending = true
    window.requestAnimationFrame(() => {
      this.rafPending = false
      this.drawNow()
    })
  }

  private drawNow(): void {
    if (this.ranges.length === 0) return
    const canvas = this.ensureCanvas()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 3)

    const targetW = Math.max(1, Math.round(vw * dpr))
    const targetH = Math.max(1, Math.round(vh * dpr))
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dark = isDarkBackdrop()
    canvas.style.mixBlendMode = dark ? 'screen' : 'multiply'

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, vw, vh)

    const barColor = dark ? 'rgba(204, 255, 0, 0.85)' : '#ccff00'
    const bgColor = dark ? 'rgba(204, 255, 0, 0.22)' : 'rgba(204, 255, 0, 0.30)'

    for (let i = 0; i < this.ranges.length; i++) {
      const range = this.ranges[i]
      if (!range.startContainer.isConnected) continue

      const rects = range.getClientRects()
      for (let r = 0; r < rects.length; r++) {
        const rect = rects[r]
        if (rect.width < 1 || rect.height < 1) continue
        if (rect.bottom < -20 || rect.top > vh + 20) continue
        if (rect.right < -20 || rect.left > vw + 20) continue

        if (this.styleMode === 'subtle-bg') {
          ctx.fillStyle = bgColor
          ctx.fillRect(rect.left, rect.top, rect.width, rect.height)
        }

        // Baseline sits ~16% above line box bottom; 6px bar starts 3px above baseline
        // so the top 3px overlaps behind the lower typography.
        const baselineOffset = Math.max(2, Math.round(rect.height * 0.16))
        const barHeight = 6
        const barY = Math.round(rect.bottom - baselineOffset - 3)

        ctx.fillStyle = barColor
        ctx.fillRect(rect.left - 1, barY, rect.width + 2, barHeight)
      }
    }
  }
}
