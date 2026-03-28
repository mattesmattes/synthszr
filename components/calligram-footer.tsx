'use client'

import { useEffect, useRef, useCallback } from 'react'
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

const FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif'
const WORD = 'OH-SO '
const CHAR_SIZE = 7
const CANVAS_WIDTH = 600
const CANVAS_HEIGHT = 450

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

function heartSDF(nx: number, ny: number): number {
  // Classic wide heart: (x²+y²-1)³ - x²y³ = 0
  const x = nx * 0.85
  const y = -ny * 0.95 + 0.2
  const x2 = x * x
  const y2 = y * y
  const sum = x2 + y2 - 1
  return sum * sum * sum - x2 * y2 * y
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
  const loopPhaseRef = useRef<'assemble' | 'hold' | 'scatter'>('assemble')
  const phaseTimerRef = useRef(0)

  const generate = useCallback(() => {
    const word = WORD || 'text'
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
        const dist = heartSDF(nx, ny)

        if (dist < -0.02) {
          const charIdx = charCounter % word.length
          const ch = word[charIdx]
          const w = charWidths[charIdx]
          positions.push({
            ch,
            targetX: pixelX,
            targetY: pixelY,
            currentX: CANVAS_WIDTH / 2 + (Math.random() - 0.5) * CANVAS_WIDTH * 0.6,
            currentY: CANVAS_HEIGHT / 2 + (Math.random() - 0.5) * CANVAS_HEIGHT * 0.6,
            velX: 0,
            velY: 0,
            currentAlpha: 0,
            targetAlpha: 1,
            delay: charCounter * 0.006 + Math.random() * 0.06,
            charIdx,
            globalIdx: charCounter,
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
  }, [])

  useEffect(() => {
    if (hasGeneratedRef.current) return
    hasGeneratedRef.current = true

    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1
    canvas.width = CANVAS_WIDTH * dpr
    canvas.height = CANVAS_HEIGHT * dpr
    canvas.style.width = CANVAS_WIDTH + 'px'
    canvas.style.height = CANVAS_HEIGHT + 'px'

    charWidthCache.clear()

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    animCharsRef.current = generate()
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

    function resetForAssemble() {
      const positions = generate()
      for (let i = 0; i < animCharsRef.current.length; i++) {
        const ch = animCharsRef.current[i]
        const pos = positions[i]
        if (!pos) continue
        ch.targetX = pos.targetX
        ch.targetY = pos.targetY
        ch.currentX = CANVAS_WIDTH / 2 + (Math.random() - 0.5) * CANVAS_WIDTH * 0.6
        ch.currentY = CANVAS_HEIGHT / 2 + (Math.random() - 0.5) * CANVAS_HEIGHT * 0.6
        ch.velX = 0
        ch.velY = 0
        ch.currentAlpha = 0
        ch.targetAlpha = 1
        ch.delay = pos.delay
      }
      animTRef.current = 0
    }

    function renderFrame() {
      const w = canvas!.width
      const h = canvas!.height
      ctx!.clearRect(0, 0, w, h)

      const fontSize = CHAR_SIZE * dpr
      ctx!.font = `${fontSize}px ${FONT_FAMILY}`
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
        } else if (phase === 'scatter') {
          ch.currentX += ch.velX
          ch.currentY += ch.velY
          ch.velX *= 0.98
          ch.velY *= 0.98
          ch.currentAlpha += (ch.targetAlpha - ch.currentAlpha) * 0.04

          if (ch.currentAlpha > 0.01) allGone = false
        }

        const color = greyColor(ch.charIdx, WORD.length)
        ctx!.fillStyle = color
        ctx!.globalAlpha = Math.min(1, Math.max(0, ch.currentAlpha))
        ctx!.fillText(ch.ch, ch.currentX * dpr, ch.currentY * dpr)
      }

      ctx!.globalAlpha = 1

      // Phase transitions
      if (phase === 'assemble' && allArrived && animCharsRef.current.length > 0) {
        loopPhaseRef.current = 'hold'
        phaseTimerRef.current = 0
      } else if (phase === 'hold' && phaseTimerRef.current > 3) {
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

    return () => {
      cancelAnimationFrame(rafRef.current)
    }
  }, [generate])

  return (
    <div className="flex justify-center -mt-6 pb-2">
      <canvas
        ref={canvasRef}
        style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
      />
    </div>
  )
}
