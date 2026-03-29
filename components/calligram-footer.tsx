'use client'

import { useEffect, useRef, useCallback } from 'react'
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

const FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif'
const WORD = 'OH-SO '
const CHAR_SIZE = 7

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

function greyColor(charIdx: number, total: number): string {
  const t = charIdx / Math.max(1, total - 1)
  const lightness = 35 + Math.sin(t * Math.PI) * 25
  return `hsl(0, 0%, ${lightness}%)`
}

// --- Shape: Heart SDF ---
function heartSDF(nx: number, ny: number): number {
  const x = nx * 0.85
  const y = -ny * 0.95 + 0.2
  const x2 = x * x
  const y2 = y * y
  const sum = x2 + y2 - 1
  return sum * sum * sum - x2 * y2 * y
}

function generateHeartPositions(canvasW: number, canvasH: number): CharPosition[] {
  const word = WORD
  const fontSize = CHAR_SIZE
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
      const dist = heartSDF(nx, ny)

      if (dist < -0.02) {
        const charIdx = charCounter % word.length
        const ch = word[charIdx]
        const w = charWidths[charIdx]
        positions.push({
          ch, targetX: pixelX, targetY: pixelY,
          currentX: canvasW / 2 + (Math.random() - 0.5) * canvasW * 0.6,
          currentY: canvasH / 2 + (Math.random() - 0.5) * canvasH * 0.6,
          velX: 0, velY: 0, currentAlpha: 0, targetAlpha: 1,
          delay: charCounter * 0.008 + Math.random() * 0.06,
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

// --- Shape: Text bitmap mask ---
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

  // Start with a large font, scale to fit width
  let testSize = canvasH * 0.9
  ctx.font = `800 ${testSize}px ${FONT_FAMILY}`
  const metrics = ctx.measureText(text)
  const scale = usableW / metrics.width
  const finalSize = testSize * scale
  ctx.font = `800 ${finalSize}px ${FONT_FAMILY}`
  ctx.fillText(text, padding, canvasH / 2 + finalSize * 0.05)

  return ctx.getImageData(0, 0, canvasW, canvasH)
}

function generateTextPositions(text: string, canvasW: number, canvasH: number): CharPosition[] {
  const mask = createTextMask(text, canvasW, canvasH)
  const word = WORD
  const fontSize = CHAR_SIZE
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

// --- Reusable animated canvas ---
function CalligramCanvas({
  width, height, generateFn,
}: {
  width: number
  height: number
  generateFn: () => CharPosition[]
}) {
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
    canvas.style.width = width + 'px'
    canvas.style.height = height + 'px'

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    animCharsRef.current = stableGenerate()
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
      const positions = stableGenerate()
      for (let i = 0; i < animCharsRef.current.length; i++) {
        const ch = animCharsRef.current[i]
        const pos = positions[i]
        if (!pos) continue
        ch.targetX = pos.targetX
        ch.targetY = pos.targetY
        ch.currentX = width / 2 + (Math.random() - 0.5) * width * 0.6
        ch.currentY = height / 2 + (Math.random() - 0.5) * height * 0.6
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
          ch.velX = (ch.velX + (ch.targetX - ch.currentX) * springK) * damping
          ch.velY = (ch.velY + (ch.targetY - ch.currentY) * springK) * damping
          ch.currentX += ch.velX
          ch.currentY += ch.velY
          ch.currentAlpha += (ch.targetAlpha - ch.currentAlpha) * 0.08
          const dist = Math.abs(ch.currentX - ch.targetX) + Math.abs(ch.currentY - ch.targetY)
          if (dist > 0.5) allArrived = false
        } else if (phase === 'scatter') {
          ch.currentX += ch.velX
          ch.currentY += ch.velY
          ch.velX *= 0.98
          ch.velY *= 0.98
          ch.currentAlpha += (ch.targetAlpha - ch.currentAlpha) * 0.04
          if (ch.currentAlpha > 0.01) allGone = false
        }

        ctx!.fillStyle = greyColor(ch.charIdx, WORD.length)
        ctx!.globalAlpha = Math.min(1, Math.max(0, ch.currentAlpha))
        ctx!.fillText(ch.ch, ch.currentX * dpr, ch.currentY * dpr)
      }

      ctx!.globalAlpha = 1

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
    return () => cancelAnimationFrame(rafRef.current)
  }, [stableGenerate, width, height])

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
    />
  )
}

// --- Exported composite footer ---
const HEART_W = 400
const HEART_H = 340
const TEXT_W = 600
const TEXT_H = 120

export function CalligramFooter() {
  const heartGen = useCallback(() => generateHeartPositions(HEART_W, HEART_H), [])
  const textGen = useCallback(() => generateTextPositions('synthszr', TEXT_W, TEXT_H), [])

  return (
    <div className="flex flex-col items-center -mt-6 gap-0 pb-2">
      <CalligramCanvas width={HEART_W} height={HEART_H} generateFn={heartGen} />
      <CalligramCanvas width={TEXT_W} height={TEXT_H} generateFn={textGen} />
    </div>
  )
}
