'use client'

import { useEffect, useRef, useCallback } from 'react'
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'
import type { CoverAnimationShape, CalligramConfig } from '@/lib/types/cover-animation'

const FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif'

// --- Types ---

export interface CharPosition {
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
}

// --- Measurement ---

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

// --- Colors ---

export function greyColor(charIdx: number, total: number): string {
  const t = charIdx / Math.max(1, total - 1)
  const lightness = 35 + Math.sin(t * Math.PI) * 25
  return `hsl(0, 0%, ${lightness}%)`
}

// --- SDF Shapes ---

function heartSDF(nx: number, ny: number): number {
  const x = nx * 0.85
  const y = -ny * 0.95 + 0.2
  const x2 = x * x
  const y2 = y * y
  const sum = x2 + y2 - 1
  return sum * sum * sum - x2 * y2 * y
}

function circleSDF(nx: number, ny: number): number {
  return Math.sqrt(nx * nx + ny * ny) - 0.75
}

function starSDF(nx: number, ny: number): number {
  const angle = Math.atan2(ny, nx)
  const d = Math.sqrt(nx * nx + ny * ny)
  const points = 5
  const innerR = 0.35
  const outerR = 0.8
  const a = (angle / Math.PI + 1) / 2 * points % 1
  const r = a < 0.5
    ? innerR + (outerR - innerR) * (1 - Math.abs(a - 0.25) * 4)
    : innerR + (outerR - innerR) * (1 - Math.abs(a - 0.75) * 4)
  return d - r
}

function waveSDF(nx: number, ny: number): number {
  const waveY = Math.sin(nx * 4) * 0.25
  const thickness = 0.2 + Math.cos(nx * 2) * 0.05
  return Math.abs(ny - waveY) - thickness
}

function spiralSDF(nx: number, ny: number): number {
  const d = Math.sqrt(nx * nx + ny * ny)
  const angle = Math.atan2(ny, nx)
  const spiralR = (angle / Math.PI + 1) / 2 * 0.6 + d * 0.15
  const armDist = Math.abs((d - spiralR * 0.5) % 0.25 - 0.125)
  return d > 0.85 ? d - 0.85 : armDist - 0.06
}

const SDF_MAP: Record<string, (nx: number, ny: number) => number> = {
  heart: heartSDF,
  circle: circleSDF,
  star: starSDF,
  wave: waveSDF,
  spiral: spiralSDF,
}

// --- SDF-based position generator ---

function generateSDFPositions(
  sdfFn: (nx: number, ny: number) => number,
  canvasW: number, canvasH: number, word: string, fontSize: number
): CharPosition[] {
  const charWidths = word.split('').map(ch => measureChar(ch, fontSize))
  const positions: CharPosition[] = []
  const lineHeight = fontSize * 1.3
  const padding = canvasW * 0.08
  const drawArea = canvasW - padding * 2
  let charCounter = 0

  for (let pixelY = padding; pixelY < canvasH - padding; pixelY += lineHeight) {
    let pixelX = padding
    while (pixelX < canvasW - padding) {
      const nx = (pixelX - canvasW / 2) / (drawArea / 2)
      const ny = (pixelY - canvasH / 2) / (drawArea / 2)
      const dist = sdfFn(nx, ny)

      if (dist < -0.02) {
        const charIdx = charCounter % word.length
        const ch = word[charIdx]
        const w = charWidths[charIdx]
        positions.push({
          ch, targetX: pixelX, targetY: pixelY,
          currentX: canvasW / 2 + (Math.random() - 0.5) * canvasW * 0.6,
          currentY: canvasH / 2 + (Math.random() - 0.5) * canvasH * 0.6,
          velX: 0, velY: 0, currentAlpha: 0, targetAlpha: 1,
          delay: charCounter * 0.006 + Math.random() * 0.06,
          charIdx,
        })
        pixelX += w + fontSize * 0.05
        charCounter++
      } else if (dist < 0.05) {
        pixelX += fontSize * 0.3
      } else {
        pixelX += fontSize * 0.5
      }
    }
  }
  return positions
}

// --- Bitmap mask generators ---

function createTextMask(text: string, canvasW: number, canvasH: number): ImageData {
  const offscreen = document.createElement('canvas')
  offscreen.width = canvasW
  offscreen.height = canvasH
  const ctx = offscreen.getContext('2d')!

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, canvasW, canvasH)

  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'

  const padding = canvasW * 0.03
  const usableW = canvasW - padding * 2

  let testSize = canvasH * 0.9
  ctx.font = `800 ${testSize}px ${FONT_FAMILY}`
  const metrics = ctx.measureText(text)
  const scale = usableW / metrics.width
  const finalSize = testSize * scale
  ctx.font = `800 ${finalSize}px ${FONT_FAMILY}`
  ctx.fillText(text, padding, canvasH / 2 + finalSize * 0.05)

  return ctx.getImageData(0, 0, canvasW, canvasH)
}

function generateBitmapPositions(
  mask: ImageData, canvasW: number, canvasH: number, word: string, fontSize: number
): CharPosition[] {
  const charWidths = word.split('').map(ch => measureChar(ch, fontSize))
  const positions: CharPosition[] = []
  const lineHeight = fontSize * 1.3
  let charCounter = 0

  for (let pixelY = 0; pixelY < canvasH; pixelY += lineHeight) {
    let pixelX = 0
    while (pixelX < canvasW) {
      const mx = Math.floor(pixelX)
      const my = Math.floor(pixelY)
      if (mx >= 0 && mx < canvasW && my >= 0 && my < canvasH) {
        const idx = (my * canvasW + mx) * 4
        if (mask.data[idx] > 128) {
          const charIdx = charCounter % word.length
          const ch = word[charIdx]
          const w = charWidths[charIdx]
          positions.push({
            ch, targetX: pixelX, targetY: pixelY,
            currentX: canvasW / 2 + (Math.random() - 0.5) * canvasW * 0.4,
            currentY: canvasH / 2 + (Math.random() - 0.5) * canvasH * 0.6,
            velX: 0, velY: 0, currentAlpha: 0, targetAlpha: 1,
            delay: charCounter * 0.004 + Math.random() * 0.05,
            charIdx,
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
  return positions
}

export function generateTextPositions(
  text: string, canvasW: number, canvasH: number, word: string, fontSize: number
): CharPosition[] {
  const mask = createTextMask(text, canvasW, canvasH)
  return generateBitmapPositions(mask, canvasW, canvasH, word, fontSize)
}

// --- Image-based mask ---

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

export async function generateImagePositions(
  imageUrl: string, canvasW: number, canvasH: number, word: string, fontSize: number
): Promise<CharPosition[]> {
  const img = await loadImage(imageUrl)
  const offscreen = document.createElement('canvas')
  offscreen.width = canvasW
  offscreen.height = canvasH
  const ctx = offscreen.getContext('2d')!

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, canvasW, canvasH)

  // Draw image scaled to fit, centered
  const scale = Math.min(canvasW / img.width, canvasH / img.height)
  const w = img.width * scale
  const h = img.height * scale
  ctx.drawImage(img, (canvasW - w) / 2, (canvasH - h) / 2, w, h)

  // Convert to grayscale mask — dark pixels = inside the shape
  const imageData = ctx.getImageData(0, 0, canvasW, canvasH)
  for (let i = 0; i < imageData.data.length; i += 4) {
    const lum = imageData.data[i] * 0.299 + imageData.data[i + 1] * 0.587 + imageData.data[i + 2] * 0.114
    // Dark pixels → white in mask (inside shape), light pixels → black (outside)
    const inside = lum < 128 ? 255 : 0
    imageData.data[i] = inside
    imageData.data[i + 1] = inside
    imageData.data[i + 2] = inside
  }

  return generateBitmapPositions(imageData, canvasW, canvasH, word, fontSize)
}

// --- Factory ---

export function createGenerateFn(config: CalligramConfig): () => CharPosition[] | Promise<CharPosition[]> {
  const { shape, width, height, word, fontSize, shapeText, shapeImageUrl } = config

  if (shape === 'custom_text' && shapeText) {
    return () => generateTextPositions(shapeText, width, height, word, fontSize)
  }

  if (shape === 'custom_image' && shapeImageUrl) {
    return () => generateImagePositions(shapeImageUrl, width, height, word, fontSize)
  }

  const sdfFn = SDF_MAP[shape]
  if (sdfFn) {
    return () => generateSDFPositions(sdfFn, width, height, word, fontSize)
  }

  // Fallback to circle
  return () => generateSDFPositions(circleSDF, width, height, word, fontSize)
}

// --- Reusable animated canvas component ---

interface CalligramCanvasProps {
  width: number
  height: number
  word?: string
  fontSize?: number
  color?: string
  holdDuration?: number
  generateFn: () => CharPosition[] | Promise<CharPosition[]>
  className?: string
  style?: React.CSSProperties
}

export function CalligramCanvas({
  width, height, word = 'OH-SO ', fontSize = 7, color = '', holdDuration = 3,
  generateFn, className, style,
}: CalligramCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animCharsRef = useRef<CharPosition[]>([])
  const animTRef = useRef(0)
  const rafRef = useRef<number>(0)
  const hasGeneratedRef = useRef(false)
  const loopPhaseRef = useRef<'assemble' | 'hold' | 'scatter'>('assemble')
  const phaseTimerRef = useRef(0)

  const stableGenerate = useCallback(generateFn, [generateFn])

  useEffect(() => {
    if (hasGeneratedRef.current) return
    hasGeneratedRef.current = true

    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1
    canvas.width = width * dpr
    canvas.height = height * dpr

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    async function init() {
      const result = stableGenerate()
      animCharsRef.current = result instanceof Promise ? await result : result
      animTRef.current = 0
      loopPhaseRef.current = 'assemble'
      phaseTimerRef.current = 0

      function resetForScatter() {
        for (const ch of animCharsRef.current) {
          ch.velX = (Math.random() - 0.5) * 8
          ch.velY = (Math.random() - 0.5) * 8
          ch.targetAlpha = 0
        }
      }

      async function resetForAssemble() {
        const r = stableGenerate()
        const positions = r instanceof Promise ? await r : r
        for (let i = 0; i < animCharsRef.current.length; i++) {
          const ch = animCharsRef.current[i]
          const pos = positions[i]
          if (!pos) continue
          ch.targetX = pos.targetX
          ch.targetY = pos.targetY
          ch.currentX = width / 2 + (Math.random() - 0.5) * width * 0.6
          ch.currentY = height / 2 + (Math.random() - 0.5) * height * 0.6
          ch.velX = 0; ch.velY = 0
          ch.currentAlpha = 0; ch.targetAlpha = 1
          ch.delay = pos.delay
        }
        animTRef.current = 0
      }

      function renderFrame() {
        const w = canvas!.width
        const h = canvas!.height
        ctx!.clearRect(0, 0, w, h)

        const fs = (fontSize ?? 7) * dpr
        ctx!.font = `${fs}px ${FONT_FAMILY}`
        ctx!.textBaseline = 'top'

        animTRef.current += 0.016
        phaseTimerRef.current += 0.016
        const animT = animTRef.current
        const phase = loopPhaseRef.current

        let allArrived = true
        let allGone = true

        for (const ch of animCharsRef.current) {
          if (phase === 'assemble') {
            const tVal = Math.max(0, animT - ch.delay)
            if (tVal <= 0) { allArrived = false; continue }
            const springK = 0.08
            const damping = 0.75
            ch.velX = (ch.velX + (ch.targetX - ch.currentX) * springK) * damping
            ch.velY = (ch.velY + (ch.targetY - ch.currentY) * springK) * damping
            ch.currentX += ch.velX
            ch.currentY += ch.velY
            ch.currentAlpha += (ch.targetAlpha - ch.currentAlpha) * 0.15
            const dist = Math.abs(ch.currentX - ch.targetX) + Math.abs(ch.currentY - ch.targetY)
            if (dist > 0.5) allArrived = false
          } else if (phase === 'scatter') {
            ch.currentX += ch.velX
            ch.currentY += ch.velY
            ch.velX *= 0.98; ch.velY *= 0.98
            ch.currentAlpha += (ch.targetAlpha - ch.currentAlpha) * 0.04
            if (ch.currentAlpha > 0.01) allGone = false
          }

          if (color) {
            ctx!.fillStyle = color
          } else {
            ctx!.fillStyle = greyColor(ch.charIdx, (word ?? 'OH-SO ').length)
          }
          ctx!.globalAlpha = Math.min(1, Math.max(0, ch.currentAlpha))
          ctx!.fillText(ch.ch, ch.currentX * dpr, ch.currentY * dpr)
        }

        ctx!.globalAlpha = 1

        if (phase === 'assemble' && allArrived && animCharsRef.current.length > 0) {
          loopPhaseRef.current = 'hold'
          phaseTimerRef.current = 0
        } else if (phase === 'hold' && phaseTimerRef.current > holdDuration) {
          loopPhaseRef.current = 'scatter'
          phaseTimerRef.current = 0
          resetForScatter()
        } else if (phase === 'scatter' && allGone) {
          loopPhaseRef.current = 'assemble'
          phaseTimerRef.current = 0
          resetForAssemble()
        }

        rafRef.current = requestAnimationFrame(renderFrame)
      }

      rafRef.current = requestAnimationFrame(renderFrame)
    }

    init()

    return () => cancelAnimationFrame(rafRef.current)
  }, [stableGenerate, width, height, fontSize, color, holdDuration, word])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width, height, ...style }}
    />
  )
}
