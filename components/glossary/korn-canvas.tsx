'use client'

import { useEffect, useRef, useState } from 'react'
import type { GlossaryAnimationParams } from '@/lib/glossary/types'

/** Zellraster der Dither-Pipeline: bei coarseness 2 wird auf 384² gerastert und
 *  2× nearest auf 768 hochskaliert (s. generateGlossaryIllustration). */
const Z = 384
const KANTE = Z * 2
const FRAMES = 16
/** Zeit je Frame. 170 ms ⇒ rund 6 Bilder/s, ein Umlauf der 16 Frames dauert
 *  2,7 s. Bewusst langsam: das Korn soll atmen, nicht flimmern. */
const MS_PRO_FRAME = 170
/** Zielrate geänderter Zellen je Frame, bezogen aufs ganze Bild. */
const ZIEL = 2.0

interface Props {
  /** Original-PNG. NICHT die next/image-Variante — die ist lossy neu kodiert
   *  und das 1-Bit-Raster, von dem der Effekt lebt, wäre zerstört. */
  src: string
  animation: GlossaryAnimationParams
  className?: string
}

/** Raeumliche Frequenz des Aktivitaetsfeldes: eine Zone misst rund 110 Zellen,
 *  also knapp ein Drittel der Bildbreite. Bei kleineren Zonen ueberlagert die
 *  Halbtonverteilung des Motivs die Modulation und man sieht sie nicht mehr. */
const ZONE_ORT = 0.009
/** Zeitliche Frequenz: ueber einen Umlauf wandert das Feld zwei Zoneneinheiten. */
const ZONE_ZEIT = 2 / FRAMES

function fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10) }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }

function gitter(x: number, y: number, z: number): number {
  let n = (x * 374761393 + y * 668265263 + z * 2147483647) >>> 0
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

/** Value-Noise: raeumlich UND zeitlich stetig, im Gegensatz zum Hash. */
function rauschen(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi)
  const e = (dx: number, dy: number, dz: number) => gitter(xi + dx, yi + dy, zi + dz)
  const x00 = lerp(e(0, 0, 0), e(1, 0, 0), u), x10 = lerp(e(0, 1, 0), e(1, 1, 0), u)
  const x01 = lerp(e(0, 0, 1), e(1, 0, 1), u), x11 = lerp(e(0, 1, 1), e(1, 1, 1), u)
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w)
}

/** Aktivitaetsfeld 0..1, exakt periodisch ueber FRAMES.
 *  Lineare Zeit im Rauschen wuerde beim Ruecksprung 15 -> 0 eine Naht erzeugen;
 *  der Uebergang zwischen dem Feld bei t und bei t-FRAMES schliesst sie, weil
 *  das Gewicht am Periodenende vollstaendig auf dem zweiten liegt und dieses
 *  dort per Konstruktion dem Startzustand entspricht. */
function zone(x: number, y: number, t: number): number {
  const a = rauschen(x * ZONE_ORT, y * ZONE_ORT, t * ZONE_ZEIT)
  const b = rauschen(x * ZONE_ORT, y * ZONE_ORT, (t - FRAMES) * ZONE_ZEIT)
  const roh = lerp(a, b, t / FRAMES)
  // Spreizen: Value-Noise haeuft sich um 0,5, die Randbereiche kommen kaum vor.
  // Ohne diesen Schritt schrumpft eine nominal zwoelffache Modulation real auf
  // etwa das Doppelte — zu wenig, um gegen die Halbtonverteilung anzukommen.
  const k = Math.min(1, Math.max(0, (roh - 0.34) / 0.32))
  return k * k * (3 - 2 * k)
}

function hash(x: number, y: number, t: number): number {
  let n = (x * 1664525 + y * 1013904223 + t * 2246822519) >>> 0
  n = Math.imul(n ^ (n >>> 15), 2246822519) >>> 0
  n = Math.imul(n ^ (n >>> 13), 3266489917) >>> 0
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

interface Kandidat { p: number; x: number; y: number; gewicht: number; frei: number[] }

/** Punkte, die springen dürfen: im Halbton, innerhalb der Region, abseits der
 *  Konturen. Hängt nur am Originalbild, wird deshalb genau einmal berechnet. */
function findeKandidaten(d: Uint8Array, region: [number, number, number, number] | undefined): Kandidat[] {
  const [rx, ry, rw, rh] = region
    ? region.map((v) => (v / 100) * Z)
    : [0, 0, Z, Z]
  const liste: Kandidat[] = []

  for (let y = 1; y < Z - 1; y++) {
    if (y < ry || y > ry + rh) continue
    for (let x = 1; x < Z - 1; x++) {
      if (x < rx || x > rx + rw) continue
      const p = y * Z + x
      if (!d[p]) continue

      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx || dy) n += d[(y + dy) * Z + x + dx]
        }
      }
      // Streupunkte und volles Schwarz nicht anfassen — dort entstünde Schmutz
      // bzw. es wäre ohnehin unsichtbar.
      if (n < 2 || n > 6) continue

      // Kantenschutz: im Halbton ist die Dichte ringsum ähnlich, an einer
      // Objektkante steht auf einer Seite Schwarz und auf der anderen Weiß.
      // Ohne diesen Test fransen die Silhouetten sichtbar aus.
      let li = 0, re = 0, ob = 0, un = 0, nl = 0, nr = 0, no = 0, nu = 0
      for (let dy = -3; dy <= 3; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= Z) continue
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= Z) continue
          const v = d[ny * Z + nx]
          if (dx < 0) { li += v; nl++ } else if (dx > 0) { re += v; nr++ }
          if (dy < 0) { ob += v; no++ } else if (dy > 0) { un += v; nu++ }
        }
      }
      const gx = Math.abs((nl ? li / nl : 0) - (nr ? re / nr : 0))
      const gy = Math.abs((no ? ob / no : 0) - (nu ? un / nu : 0))
      const flach = Math.max(0, 1 - Math.hypot(gx, gy) * 2.2)
      if (flach <= 0) continue

      const frei: number[] = []
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx, ny = y + dy
          if (nx < 1 || ny < 1 || nx >= Z - 1 || ny >= Z - 1) continue
          if (nx < rx || nx > rx + rw || ny < ry || ny > ry + rh) continue
          if (!d[ny * Z + nx]) frei.push(ny * Z + nx)
        }
      }
      if (!frei.length) continue

      liste.push({ p, x, y, gewicht: (1 - Math.abs(n - 4) / 4) * flach, frei })
    }
  }
  return liste
}

/** Sprünge eines Frames als Paare [von, nach]. Ein Sprung ist −1/+1 und hält
 *  damit die Schwarzdichte exakt — blosses Ein-/Ausschalten hellt dichte
 *  Halbtöne auf, weil dort mehr gesetzte als leere Zellen bereitstehen. */
function spruenge(kandidaten: Kandidat[], t: number, staerke: number): Int32Array {
  const belegt = new Set<number>()
  const paare: number[] = []
  for (const k of kandidaten) {
    // Das Aktivitaetsfeld hebt und senkt die Sprungchance, entscheidet aber
    // nicht selbst: wuerde es allein entscheiden, spraenge eine ganze Zone
    // gleichzeitig und der Effekt wirkte blockig statt koernig. Mittelwert der
    // Modulation ist 1,0, die Gesamtmenge je Frame bleibt damit erhalten.
    const chance = staerke * k.gewicht * (0.08 + 1.9 * zone(k.x, k.y, t))
    if (hash(k.x, k.y, t) >= chance) continue
    const i = Math.floor(hash(k.x + 7919, k.y + 104729, t) * k.frei.length) % k.frei.length
    const ziel = k.frei[i]
    if (belegt.has(ziel)) continue
    belegt.add(ziel)
    paare.push(k.p, ziel)
  }
  return Int32Array.from(paare)
}

/**
 * Lässt das Dither-Korn im markierten Bildbereich wandern: einzelne Rasterpunkte
 * springen auf freie Nachbarzellen, das Motiv selbst steht exakt still. Läuft als
 * Progressive Enhancement ÜBER dem serverseitig gerenderten <Image>; ohne
 * passende Daten, bei reduzierter Bewegung oder bei jedem Fehler bleibt der
 * Canvas unsichtbar und das Bild darunter ist der garantierte Ist-Zustand.
 */
export function KornCanvas({ src, animation, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [bereit, setBereit] = useState(false)

  useEffect(() => {
    if (animation.verfahren !== 'korn') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const canvas = canvasRef.current
    if (!canvas) return

    let abgebrochen = false
    let anim = 0
    let beobachter: IntersectionObserver | null = null

    void (async () => {
      const resp = await fetch(src)
      if (!resp.ok || abgebrochen) return
      const bitmap = await createImageBitmap(await resp.blob())
      if (abgebrochen) { bitmap.close(); return }

      const mess = document.createElement('canvas')
      mess.width = KANTE
      mess.height = KANTE
      const mctx = mess.getContext('2d', { willReadFrequently: true })
      if (!mctx) { bitmap.close(); return }
      mctx.drawImage(bitmap, 0, 0, KANTE, KANTE)
      bitmap.close()
      const roh = mctx.getImageData(0, 0, KANTE, KANTE).data

      // 768er-Bild auf das 384er-Zellraster zurückführen: jede Zelle ist ein
      // 2×2-Block, es genügt deren linke obere Ecke.
      const d = new Uint8Array(Z * Z)
      for (let y = 0; y < Z; y++) {
        for (let x = 0; x < Z; x++) {
          d[y * Z + x] = roh[((y * 2) * KANTE + x * 2) * 4 + 3] > 127 ? 1 : 0
        }
      }

      const kandidaten = findeKandidaten(d, animation.region)
      if (abgebrochen || kandidaten.length < 40) return

      // Stärke an einem einzigen Messpass normieren: die Zahl der Sprünge ist
      // direkt proportional zur Stärke, eine Suche ist deshalb unnötig.
      // Gemessen wird der ÜBERGANG zwischen zwei Frames, nicht der Abstand eines
      // Frames zum Basisbild — wahrgenommen wird die Bewegung von Bild zu Bild,
      // und die ist wegen der rückgängig gemachten Vorgänger-Sprünge fast doppelt
      // so gross.
      const zustand = (t: number, st: number) => {
        const f = new Uint8Array(d)
        const s = spruenge(kandidaten, t, st)
        for (let k = 0; k < s.length; k += 2) { f[s[k]] = 0; f[s[k + 1]] = 1 }
        return f
      }
      // Zwei Durchgaenge statt einem. Seit das Aktivitaetsfeld die Sprungchance
      // moduliert, kann sie ueber 1 steigen und SAETTIGT dort — der Punkt springt
      // dann ohnehin. Damit ist die Rate nicht mehr streng linear in der Staerke,
      // und ein einzelner Pass ueberschaetzt sie systematisch (gemessen 3,4 %
      // statt der angepeilten 2 %). Der zweite Durchgang faengt genau das ab.
      const rate = (st: number) => {
        let anders = 0
        const paare = [0, 5, 10]
        for (const t0 of paare) {
          const za = zustand(t0, st), zb = zustand((t0 + 1) % FRAMES, st)
          for (let i = 0; i < za.length; i++) if (za[i] !== zb[i]) anders++
        }
        return (anders / paare.length / (Z * Z)) * 100
      }
      let staerke = 0.4
      for (let runde = 0; runde < 2; runde++) {
        const gemessen = rate(staerke)
        if (gemessen <= 0.01) break
        staerke = Math.max(0.04, Math.min(1, staerke * (ZIEL / gemessen)))
      }

      const folge: Int32Array[] = []
      for (let i = 0; i < FRAMES; i++) folge.push(spruenge(kandidaten, i, staerke))
      if (abgebrochen) return

      canvas.width = KANTE
      canvas.height = KANTE
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const bild = ctx.createImageData(KANTE, KANTE)
      const px = bild.data
      for (let y = 0; y < Z; y++) {
        for (let x = 0; x < Z; x++) {
          if (!d[y * Z + x]) continue
          for (let b = 0; b < 4; b++) {
            const q = (((y * 2) + (b >> 1)) * KANTE + x * 2 + (b & 1)) * 4
            px[q + 3] = 255
          }
        }
      }

      const setze = (zelle: number, an: boolean) => {
        const zy = (zelle / Z) | 0, zx = zelle % Z
        for (let b = 0; b < 4; b++) {
          const q = (((zy * 2) + (b >> 1)) * KANTE + zx * 2 + (b & 1)) * 4
          px[q + 3] = an ? 255 : 0
        }
      }

      let aktuell = -1
      const zeige = (i: number) => {
        if (aktuell >= 0) {
          const alt = folge[aktuell]
          for (let k = 0; k < alt.length; k += 2) { setze(alt[k], true); setze(alt[k + 1], false) }
        }
        const neu = folge[i]
        for (let k = 0; k < neu.length; k += 2) { setze(neu[k], false); setze(neu[k + 1], true) }
        aktuell = i
        ctx.putImageData(bild, 0, 0)
      }

      let frame = 0
      let letzte = 0
      let laufend = false
      const tick = (t: number) => {
        if (abgebrochen) return
        if (t - letzte > MS_PRO_FRAME) { zeige(frame % FRAMES); frame++; letzte = t }
        anim = requestAnimationFrame(tick)
      }
      const starte = () => { if (!laufend) { laufend = true; anim = requestAnimationFrame(tick) } }
      const stoppe = () => { laufend = false; cancelAnimationFrame(anim) }

      zeige(0)
      setBereit(true)

      // Ausserhalb des Sichtbereichs pausieren — mehrere Illustrationen auf
      // einer Seite sollen nicht dauerhaft rechnen.
      beobachter = new IntersectionObserver(([eintrag]) => {
        if (eintrag.isIntersecting) starte()
        else stoppe()
      })
      beobachter.observe(canvas)
    })().catch((err) => {
      // Folgenlos: das <Image> darunter ist der garantierte Ist-Zustand.
      console.warn('[KornCanvas]', err)
    })

    return () => {
      abgebrochen = true
      beobachter?.disconnect()
      cancelAnimationFrame(anim)
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
        opacity: bereit ? 1 : 0,
        transition: 'opacity 400ms ease-out',
      }}
    />
  )
}
