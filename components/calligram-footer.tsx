'use client'

import { useEffect, useRef, useCallback } from 'react'
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

const FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif'
const MASK_FONT = '900 italic 1px "Helvetica Neue", Helvetica, Arial, sans-serif'
const WORD = 'OH-SO '
const CHAR_SIZE = 9
const CANVAS_WIDTH = 600
const CANVAS_HEIGHT = 500

interface CharPosition {
  ch: string
  targetX: number
  targetY: number
  currentX: number
  currentY: number
  velX: number
  velY: number
  currentAlpha: number
  targetAlpha: number
  delay: number
  charIdx: number
  globalIdx: number
}

const charWidthCache = new Map<string, number>()

function measureChar(ch: string, fontSize: number): number {
  const key = `${ch}:${fontSize}`
  const cached = charWidthCache.get(key)
  if (cached !== undefined) return cached
  const fontStr = `${fontSize}px ${FONT_FAMILY}`
  const prepared = prepareWithSegments(ch, fontStr)
  const result = layoutWithLines(prepared, 1e4, fontSize * 1.2)
  const width = result.lines.length > 0 ? result.lines[0].width : fontSize * 0.5
  charWidthCache.set(key, width)
  return width
}

function createLogoMask(width: number, height: number): ImageData {
  const offscreen = document.createElement('canvas')
  offscreen.width = width
  offscreen.height = height
  const ctx = offscreen.getContext('2d')!

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'top'

  const padding = width * 0.02
  const usableW = width - padding * 2
  const blockH = height * 0.42
  const barH = height * 0.08
  const gap = (height - blockH * 2 - barH) / 2

  // "OH" top block
  const ohFontSize = blockH * 0.95
  ctx.font = `900 ${ohFontSize}px ${FONT_FAMILY}`
  const ohMetrics = ctx.measureText('OH')
  const ohScale = usableW / ohMetrics.width
  const ohFinal = ohFontSize * ohScale
  ctx.font = `900 ${ohFinal}px ${FONT_FAMILY}`
  ctx.fillText('OH', padding, gap - ohFinal * 0.08)

  // Horizontal bar
  const barY = gap + blockH
  ctx.fillRect(padding, barY, usableW, barH)

  // "SO" bottom block
  const soFontSize = blockH * 0.95
  ctx.font = `900 ${soFontSize}px ${FONT_FAMILY}`
  const soMetrics = ctx.measureText('SO')
  const soScale = usableW / soMetrics.width
  const soFinal = soFontSize * soScale
  ctx.font = `900 ${soFinal}px ${FONT_FAMILY}`
  ctx.fillText('SO', padding, gap + blockH + barH - soFinal * 0.08)

  return ctx.getImageData(0, 0, width, height)
}

function greyColor(charIdx: number, total: number): string {
  const t = charIdx / Math.max(1, total - 1)
  const lightness = 35 + Math.sin(t * Math.PI) * 25
  return `hsl(0, 0%, ${lightness}%)`
}

export function CalligramFooter() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animCharsRef = useRef<CharPosition[]>([])
  const animTRef = useRef(0)
  const rafRef = useRef<number>(0)
  const hasGeneratedRef = useRef(false)

  const generate = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1
    canvas.width = CANVAS_WIDTH * dpr
    canvas.height = CANVAS_HEIGHT * dpr
    canvas.style.width = CANVAS_WIDTH + 'px'
    canvas.style.height = CANVAS_HEIGHT + 'px'

    charWidthCache.clear()

    const mask = createLogoMask(CANVAS_WIDTH, CANVAS_HEIGHT)

    const word = WORD || 'text'
    const fontSize = CHAR_SIZE
    const charWidths = word.split('').map(ch => measureChar(ch, fontSize))

    const positions: CharPosition[] = []
    const lineHeight = fontSize * 1.3
    let charCounter = 0

    for (let pixelY = 0; pixelY < CANVAS_HEIGHT; pixelY += lineHeight) {
      let pixelX = 0
      while (pixelX < CANVAS_WIDTH) {
        const mx = Math.floor(pixelX)
        const my = Math.floor(pixelY)

        if (mx >= 0 && mx < CANVAS_WIDTH && my >= 0 && my < CANVAS_HEIGHT) {
          const idx = (my * CANVAS_WIDTH + mx) * 4
          const r = mask.data[idx]

          if (r > 128) {
            const charIdx = charCounter % word.length
            const ch = word[charIdx]
            const w = charWidths[charIdx]
            positions.push({
              ch,
              targetX: pixelX,
              targetY: pixelY,
              currentX: CANVAS_WIDTH / 2 + (Math.random() - 0.5) * CANVAS_WIDTH * 0.3,
              currentY: CANVAS_HEIGHT / 2 + (Math.random() - 0.5) * CANVAS_HEIGHT * 0.3,
              velX: 0,
              velY: 0,
              currentAlpha: 0,
              targetAlpha: 1,
              delay: charCounter * 0.008 + Math.random() * 0.08,
              charIdx,
              globalIdx: charCounter,
            })
            pixelX += w + fontSize * 0.05
            charCounter++
          } else {
            pixelX += fontSize * 0.4
          }
        } else {
          pixelX += fontSize * 0.4
        }
      }
    }

    animCharsRef.current = positions
    animTRef.current = 0
  }, [])

  useEffect(() => {
    if (hasGeneratedRef.current) return
    hasGeneratedRef.current = true

    generate()

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1

    function renderFrame() {
      const w = canvas!.width
      const h = canvas!.height
      ctx!.clearRect(0, 0, w, h)

      const fontSize = CHAR_SIZE * dpr
      ctx!.font = `${fontSize}px ${FONT_FAMILY}`
      ctx!.textBaseline = 'top'

      animTRef.current += 0.016
      const animT = animTRef.current

      for (const ch of animCharsRef.current) {
        const tVal = Math.max(0, animT - ch.delay)
        if (tVal <= 0) continue

        const springK = 0.08
        const damping = 0.75
        const forceX = (ch.targetX - ch.currentX) * springK
        const forceY = (ch.targetY - ch.currentY) * springK
        ch.velX = (ch.velX + forceX) * damping
        ch.velY = (ch.velY + forceY) * damping
        ch.currentX += ch.velX
        ch.currentY += ch.velY
        ch.currentAlpha += (ch.targetAlpha - ch.currentAlpha) * 0.08

        const color = greyColor(ch.charIdx, WORD.length)
        ctx!.fillStyle = color
        ctx!.globalAlpha = Math.min(1, ch.currentAlpha)
        ctx!.fillText(ch.ch, ch.currentX * dpr, ch.currentY * dpr)
      }

      ctx!.globalAlpha = 1
      rafRef.current = requestAnimationFrame(renderFrame)
    }

    rafRef.current = requestAnimationFrame(renderFrame)

    return () => {
      cancelAnimationFrame(rafRef.current)
    }
  }, [generate])

  return (
    <div className="flex justify-center pt-0 pb-4">
      <canvas
        ref={canvasRef}
        style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      />
    </div>
  )
}
