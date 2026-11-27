import type { GlossaryAnimationParams } from '../shared/types'

const Z = 384
const KANTE = Z * 2
const FRAMES = 16
const MS_PRO_FRAME = 170
const ZIEL = 2.0

const ZONE_ORT = 0.009
const ZONE_ZEIT = 2 / FRAMES

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function gitter(x: number, y: number, z: number): number {
  let n = (x * 374761393 + y * 668265263 + z * 2147483647) >>> 0
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

function rauschen(x: number, y: number, z: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const u = fade(x - xi)
  const v = fade(y - yi)
  const w = fade(z - zi)
  const e = (dx: number, dy: number, dz: number) => gitter(xi + dx, yi + dy, zi + dz)
  const x00 = lerp(e(0, 0, 0), e(1, 0, 0), u)
  const x10 = lerp(e(0, 1, 0), e(1, 1, 0), u)
  const x01 = lerp(e(0, 0, 1), e(1, 0, 1), u)
  const x11 = lerp(e(0, 1, 1), e(1, 1, 1), u)
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w)
}

function zone(x: number, y: number, t: number): number {
  const a = rauschen(x * ZONE_ORT, y * ZONE_ORT, t * ZONE_ZEIT)
  const b = rauschen(x * ZONE_ORT, y * ZONE_ORT, (t - FRAMES) * ZONE_ZEIT)
  const roh = lerp(a, b, t / FRAMES)
  const k = Math.min(1, Math.max(0, (roh - 0.34) / 0.32))
  return k * k * (3 - 2 * k)
}

function hash(x: number, y: number, t: number): number {
  let n = (x * 1664525 + y * 1013904223 + t * 2246822519) >>> 0
  n = Math.imul(n ^ (n >>> 15), 2246822519) >>> 0
  n = Math.imul(n ^ (n >>> 13), 3266489917) >>> 0
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

interface Kandidat {
  p: number
  x: number
  y: number
  gewicht: number
  frei: number[]
}

function findeKandidaten(
  d: Uint8Array,
  region: [number, number, number, number] | undefined,
): Kandidat[] {
  const [rx, ry, rw, rh] = region ? region.map((v) => (v / 100) * Z) : [0, 0, Z, Z]
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
      if (n < 2 || n > 6) continue

      let li = 0
      let re = 0
      let ob = 0
      let un = 0
      let nl = 0
      let nr = 0
      let no = 0
      let nu = 0
      for (let dy = -3; dy <= 3; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= Z) continue
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= Z) continue
          const v = d[ny * Z + nx]
          if (dx < 0) {
            li += v
            nl++
          } else if (dx > 0) {
            re += v
            nr++
          }
          if (dy < 0) {
            ob += v
            no++
          } else if (dy > 0) {
            un += v
            nu++
          }
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
          const nx = x + dx
          const ny = y + dy
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

function spruenge(kandidaten: Kandidat[], t: number, staerke: number): Int32Array {
  const belegt = new Set<number>()
  const paare: number[] = []
  for (const k of kandidaten) {
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

function decodeBase64ToBlob(base64Png: string): Blob {
  const bin = atob(base64Png)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i)
  }
  return new Blob([bytes], { type: 'image/png' })
}

/**
 * Decodes a base64 PNG dither illustration, renders it statically at once,
 * and starts the wandering-grain (`korn`) animation loop if supported.
 * Returns a cleanup callback to stop the animation.
 */
export async function mountDitherIllustration(
  canvas: HTMLCanvasElement,
  base64Png: string,
  animation: GlossaryAnimationParams | null,
): Promise<() => void> {
  const blob = decodeBase64ToBlob(base64Png)
  const bitmap = await createImageBitmap(blob)

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return () => {}
  }

  canvas.width = bitmap.width
  canvas.height = bitmap.height
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0)

  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (
    animation?.verfahren !== 'korn' ||
    reducedMotion ||
    bitmap.width !== KANTE ||
    bitmap.height !== KANTE
  ) {
    bitmap.close()
    return () => {}
  }

  const mess = document.createElement('canvas')
  mess.width = KANTE
  mess.height = KANTE
  const mctx = mess.getContext('2d', { willReadFrequently: true })
  if (!mctx) {
    bitmap.close()
    return () => {}
  }
  mctx.drawImage(bitmap, 0, 0, KANTE, KANTE)
  bitmap.close()

  const roh = mctx.getImageData(0, 0, KANTE, KANTE).data

  let weich = 0
  for (let i = 3; i < roh.length; i += 4 * 97) {
    const a = roh[i]
    if (a > 24 && a < 231) weich++
  }
  if (weich > (roh.length / (4 * 97)) * 0.02) {
    return () => {}
  }

  const d = new Uint8Array(Z * Z)
  for (let y = 0; y < Z; y++) {
    for (let x = 0; x < Z; x++) {
      d[y * Z + x] = roh[((y * 2) * KANTE + x * 2) * 4 + 3] > 127 ? 1 : 0
    }
  }

  const kandidaten = findeKandidaten(d, animation.region)
  if (kandidaten.length < 40) {
    return () => {}
  }

  const zustand = (t: number, st: number) => {
    const f = new Uint8Array(d)
    const s = spruenge(kandidaten, t, st)
    for (let k = 0; k < s.length; k += 2) {
      f[s[k]] = 0
      f[s[k + 1]] = 1
    }
    return f
  }

  const rate = (st: number) => {
    let anders = 0
    const paare = [0, 5, 10]
    for (const t0 of paare) {
      const za = zustand(t0, st)
      const zb = zustand((t0 + 1) % FRAMES, st)
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
  for (let i = 0; i < FRAMES; i++) {
    folge.push(spruenge(kandidaten, i, staerke))
  }

  const bild = ctx.createImageData(KANTE, KANTE)
  const px = bild.data
  for (let y = 0; y < Z; y++) {
    for (let x = 0; x < Z; x++) {
      if (!d[y * Z + x]) continue
      for (let b = 0; b < 4; b++) {
        const q = ((y * 2 + (b >> 1)) * KANTE + x * 2 + (b & 1)) * 4
        px[q + 3] = 255
      }
    }
  }

  const setze = (zelle: number, an: boolean) => {
    const zy = (zelle / Z) | 0
    const zx = zelle % Z
    for (let b = 0; b < 4; b++) {
      const q = ((zy * 2 + (b >> 1)) * KANTE + zx * 2 + (b & 1)) * 4
      px[q + 3] = an ? 255 : 0
    }
  }

  let aktuell = -1
  const zeige = (i: number) => {
    if (aktuell >= 0) {
      const alt = folge[aktuell]
      for (let k = 0; k < alt.length; k += 2) {
        setze(alt[k], true)
        setze(alt[k + 1], false)
      }
    }
    const neu = folge[i]
    for (let k = 0; k < neu.length; k += 2) {
      setze(neu[k], false)
      setze(neu[k + 1], true)
    }
    aktuell = i
    ctx.putImageData(bild, 0, 0)
  }

  let abgebrochen = false
  let frame = 0
  let letzte = 0
  let anim = 0

  zeige(0)
  const tick = (t: number) => {
    if (abgebrochen) return
    if (t - letzte > MS_PRO_FRAME) {
      zeige(frame % FRAMES)
      frame++
      letzte = t
    }
    anim = requestAnimationFrame(tick)
  }
  anim = requestAnimationFrame(tick)

  return () => {
    abgebrochen = true
    cancelAnimationFrame(anim)
  }
}
