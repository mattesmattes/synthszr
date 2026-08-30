'use client'

import { useEffect, useRef, useState } from 'react'
import type { Gpu, FrameLoopHandle } from 'vgpu'
import type { GlossaryAnimationParams } from '@/lib/glossary/types'
import warpShader from '@/lib/dither-animation/warp.wgsl'

const MODE: Record<GlossaryAnimationParams['muster'], number> = {
  drift: 0, sway: 1, flow: 2, ripple: 3, pulse: 4, spin: 5, shimmer: 6,
}

const SIZE = 768
/** Sekunden je Loop-Durchlauf. Die Kosinus-Phasenformel unten ist identisch zu
 *  der, mit der der Vollkorpus-Test kalibriert hat (smoke/kalibrier-v2.mjs) —
 *  eine andere Formel liesse `amp` bei drift nicht mehr zur gemessenen Dosis
 *  passen. */
const PERIOD_S = 8
const FPS = 12

interface Props {
  /** Original-PNG (NICHT die next/image-optimierte Variante — die waere lossy
   *  neu kodiert und wuerde das 1-Bit-Dither-Raster zerstoeren). */
  src: string
  animation: GlossaryAnimationParams
  /** Dieselbe Klasse wie am <Image> darunter (dithered-cover/-invert), damit
   *  Pixelated-Rendering und Dark-Mode-Invert identisch greifen. */
  className?: string
}

/**
 * Subtile Endlos-Animation der Dither-Illustration per WebGPU (vgpu), als
 * Progressive Enhancement UEBER dem serverseitig gerenderten <Image> (bleibt
 * unveraendert im DOM). Ohne WebGPU, bei reduzierter Bewegung oder bei jedem
 * sonstigen Fehler bleibt dieser Canvas unsichtbar — das Bild darunter ist der
 * garantierte Ist-Zustand, die Animation ist rein additiv.
 *
 * Rendert intern IMMER bei 768x768 (autoResize:false), unabhaengig von der per
 * CSS vorgegebenen Anzeigegroesse — der Shader rechnet in Zellen auf einem
 * festen 768er-Raster (mitte=(192,192) etc.). Die vorhandene
 * image-rendering:pixelated-Regel (.dithered-cover) skaliert die Ausgabe
 * genauso knackig herunter wie das statische Bild.
 *
 * Vollkorpus-Test 29.08.2026: 2376/2376 Begriffe kalibriert und verifiziert
 * (Migration 20260829120000_glossary_animation_params.sql).
 */
export function DitheredCanvas({ src, animation, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!navigator.gpu) return
    const canvas = canvasRef.current
    if (!canvas) return

    let abgebrochen = false
    let gpu: Gpu | null = null
    let loopHandle: FrameLoopHandle | null = null
    let beobachter: IntersectionObserver | null = null

    void (async () => {
      const { init, effect, surface, frameLoop, clock } = await import('vgpu')

      const resp = await fetch(src)
      if (!resp.ok || abgebrochen) return
      const bitmap = await createImageBitmap(await resp.blob())
      if (abgebrochen || bitmap.width !== SIZE || bitmap.height !== SIZE) {
        bitmap.close()
        return
      }

      gpu = await init()
      if (abgebrochen) {
        gpu.dispose()
        bitmap.close()
        return
      }

      const texture = gpu.gpu.createTexture({
        size: [SIZE, SIZE],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      })
      gpu.gpu.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [SIZE, SIZE])
      bitmap.close()

      const target = surface(gpu, canvas, { size: [SIZE, SIZE], autoResize: false })
      const uhr = clock(gpu)
      const berechneParams = () => {
        const tau = (uhr.time % PERIOD_S) / PERIOD_S
        return {
          tau,
          phase: (1 - Math.cos(2 * Math.PI * tau)) * 0.35,
          amp: animation.amp,
          mode: MODE[animation.muster],
          pivot: animation.pivot ?? ([192, 192] as [number, number]),
          pad: [0, 0] as [number, number],
        }
      }
      const eff = effect(gpu, warpShader, { set: { ditherTex: texture, params: berechneParams() } })

      const starteLoop = () => {
        if (loopHandle || !gpu) return
        loopHandle = frameLoop(
          gpu,
          (frame) => {
            eff.set({ params: berechneParams() })
            frame.pass(target, eff)
          },
          { fps: FPS },
        )
      }
      starteLoop()

      // Ausserhalb des Sichtbereichs pausieren — spart GPU-Last, wenn eine
      // Seite mehrere Illustrationen traegt (verwandte Begriffe, A-Z-Liste),
      // ohne den Rhythmus zu verlieren: die Uhr laeuft weiter, nur das
      // Zeichnen pausiert.
      beobachter = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) starteLoop()
        else {
          loopHandle?.stop()
          loopHandle = null
        }
      })
      beobachter.observe(canvas)

      if (!abgebrochen) setReady(true)
    })().catch((err) => {
      // Jeder Fehler bleibt folgenlos: das <Image> darunter ist der
      // garantierte Ist-Zustand, die Animation ist rein additiv.
      console.warn('[DitheredCanvas]', err)
    })

    return () => {
      abgebrochen = true
      beobachter?.disconnect()
      loopHandle?.stop()
      gpu?.dispose()
    }
  }, [src, animation])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity: ready ? 1 : 0,
        transition: 'opacity 300ms ease-out',
      }}
    />
  )
}
