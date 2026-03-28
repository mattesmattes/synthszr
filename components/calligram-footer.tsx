'use client'

import { useEffect, useRef, useCallback } from 'react'
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

const FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif'
const WORD = 'oh-so'
const CHAR_SIZE = 8
const CANVAS_WIDTH = 600
const CANVAS_HEIGHT = 600

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
  dist: number
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

function circleSDF(nx: number, ny: number): number {
  return Math.sqrt(nx * nx + ny * ny) - 0.75
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

    const word = WORD.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'text'
    const fontSize = CHAR_SIZE
    const charWidths = word.split('').map(ch => measureChar(ch, fontSize))

    const positions: CharPosition[] = []
    const lineHeight = fontSize * 1.3
    const padding = CANVAS_WIDTH * 0.08
    const drawArea = CANVAS_WIDTH - padding * 2
    let charCounter = 0

    for (let pixelY = padding; pixelY < CANVAS_HEIGHT - padding; pixelY += lineHeight) {
      let pixelX = padding
      while (pixelX < CANVAS_WIDTH - padding) {
        const nx = (pixelX - CANVAS_WIDTH / 2) / (drawArea / 2)
        const ny = (pixelY - CANVAS_HEIGHT / 2) / (drawArea / 2)
        const dist = circleSDF(nx, ny)

        if (dist < -0.02) {
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
            delay: charCounter * 0.015 + Math.random() * 0.1,
            charIdx,
            globalIdx: charCounter,
            dist: Math.abs(dist),
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
      let allArrived = true

      for (const ch of animCharsRef.current) {
        const tVal = Math.max(0, animT - ch.delay)
        if (tVal <= 0) {
          allArrived = false
          continue
        }

        const springK = 0.08
        const damping = 0.75
        const forceX = (ch.targetX - ch.currentX) * springK
        const forceY = (ch.targetY - ch.currentY) * springK
        ch.velX = (ch.velX + forceX) * damping
        ch.velY = (ch.velY + forceY) * damping
        ch.currentX += ch.velX
        ch.currentY += ch.velY
        ch.currentAlpha += (ch.targetAlpha - ch.currentAlpha) * 0.08

        const distToTarget = Math.abs(ch.currentX - ch.targetX) + Math.abs(ch.currentY - ch.targetY)
        if (distToTarget > 0.5) allArrived = false

        const color = greyColor(ch.charIdx, WORD.length)
        ctx!.fillStyle = color
        ctx!.globalAlpha = Math.min(1, ch.currentAlpha)
        ctx!.fillText(ch.ch, ch.currentX * dpr, ch.currentY * dpr)
      }

      ctx!.globalAlpha = 1

      if (allArrived && animCharsRef.current.length > 0) {
        const pulse = (Math.sin(animT * 2) + 1) / 2
        const glowAlpha = 0.02 + pulse * 0.02
        const padding = CANVAS_WIDTH * 0.08
        const drawArea = CANVAS_WIDTH - padding * 2

        ctx!.fillStyle = `rgba(160, 160, 160, ${glowAlpha})`
        for (let y = 0; y < h; y += 4 * dpr) {
          for (let x = 0; x < w; x += 4 * dpr) {
            const nx = (x / dpr - CANVAS_WIDTH / 2) / (drawArea / 2)
            const ny = (y / dpr - CANVAS_HEIGHT / 2) / (drawArea / 2)
            const dist = circleSDF(nx, ny)
            if (dist > -0.05 && dist < 0.02) {
              ctx!.fillRect(x, y, 3 * dpr, 3 * dpr)
            }
          }
        }
      }

      rafRef.current = requestAnimationFrame(renderFrame)
    }

    rafRef.current = requestAnimationFrame(renderFrame)

    return () => {
      cancelAnimationFrame(rafRef.current)
    }
  }, [generate])

  return (
    <div className="flex justify-center py-8">
      <canvas
        ref={canvasRef}
        style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      />
    </div>
  )
}
