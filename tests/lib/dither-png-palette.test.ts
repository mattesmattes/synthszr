import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { whiteToTransparent } from '@/lib/gemini/image-generator'

/**
 * whiteToTransparent erzeugt per Konstruktion Bilder mit genau ZWEI Zuständen:
 * reines Schwarz (opak) oder transparent — der Code hält das selbst fest
 * („ONLY black pixels and transparent pixels"). Gespeichert wurden sie
 * trotzdem als 8-Bit-RGBA, also 32 Bit je Pixel für 1 Bit Information. An der
 * Lexikon-Illustration auf Prod gemessen: 54.602 Bytes, als Palette-PNG
 * 13.306 Bytes bei pixelidentischem Inhalt.
 *
 * Das ist beim LCP relevant, weil next/image das Original durchreicht, sobald
 * die optimierte Variante größer wäre — bei einem Dither-Raster ist das für die
 * Breiten der Fall, die ein Retina-Display anfordert (w=640, w=750).
 */

/**
 * Deterministisches Schwarz-Weiß-Rauschen als Stellvertreter für das
 * Dither-Raster. Ein Schachbrett taugt hier nicht: PNG-Filter komprimieren
 * regelmäßige Muster so gut, dass die Farbtiefe nicht mehr auffällt. Das echte
 * Raster ist hochfrequent, und genau darum geht es.
 *
 * Bewusst DREIKANALIG (RGB), nicht Graustufe: whiteToTransparent läuft über
 * ensureAlpha().raw() und liest den Puffer in Vierersprüngen. Aus RGB wird
 * dabei RGBA, die Rechnung stimmt — aus einem Graustufenbild würden nur zwei
 * Kanäle, und der Test prüfte einen Pfad, den echte Modellbilder nie nehmen.
 */
async function ditherLikePng(size = 160): Promise<Buffer> {
  let seed = 42
  const px = Buffer.alloc(size * size * 3)
  for (let i = 0; i < size * size; i++) {
    // Linearer Kongruenzgenerator, fester Startwert — gleiche Eingabe in jedem Lauf.
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const v = (seed >> 16) % 2 === 0 ? 0 : 255
    px[i * 3] = v
    px[i * 3 + 1] = v
    px[i * 3 + 2] = v
  }
  return sharp(px, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer()
}

/** Graustufenwert je Pixel des Testbildes (r=g=b, also gleich der Luminanz). */
async function grayValues(src: Buffer): Promise<Buffer> {
  const raw = await sharp(src).removeAlpha().raw().toBuffer()
  const out = Buffer.alloc(raw.length / 3)
  for (let i = 0; i < out.length; i++) out[i] = raw[i * 3]
  return out
}

/**
 * Farbtyp aus dem IHDR-Kopf des PNG. Direkt am Byte gelesen statt über
 * sharp.metadata(): das Feld paletteBitDepth gibt sharp zur Laufzeit zurück,
 * kennt es in seinen Typen (0.34.5) aber nicht — und der Farbtyp ist die
 * eindeutigere Aussage. Aufbau: 8 Byte Signatur, dann der IHDR-Chunk mit
 * 4 Byte Länge, 4 Byte Kennung, 4 Byte Breite, 4 Byte Höhe, 1 Byte Bittiefe,
 * 1 Byte Farbtyp.
 */
function pngColorType(buf: Buffer): number {
  return buf[25]
}

/** PNG-Farbtypen laut Spezifikation, hier die beiden relevanten. */
const PNG_COLOR_TYPE_PALETTE = 3
const PNG_COLOR_TYPE_RGBA = 6

describe('whiteToTransparent: Farbtiefe der Dither-Ausgabe', () => {
  it('speichert als Palette-PNG statt als 8-Bit-RGBA', async () => {
    const src = await ditherLikePng()

    const out = await whiteToTransparent(src.toString('base64'))
    const buf = Buffer.from(out.base64, 'base64')

    expect(pngColorType(buf)).toBe(PNG_COLOR_TYPE_PALETTE)
    expect(pngColorType(buf)).not.toBe(PNG_COLOR_TYPE_RGBA)
    expect(out.mimeType).toBe('image/png')
  })

  it('bleibt dabei pixelgenau: jeder Pixel behält seinen Zustand', async () => {
    const size = 160
    const src = await ditherLikePng(size)
    const srcGray = await grayValues(src)

    const out = await whiteToTransparent(src.toString('base64'))
    const { data } = await sharp(Buffer.from(out.base64, 'base64'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    // Schwelle 128 wie im Standardaufruf: hell → transparent, dunkel → opak schwarz.
    let checked = 0
    for (let i = 0; i < size * size; i++) {
      const expectedAlpha = srcGray[i] >= 128 ? 0 : 255
      expect(data[i * 4 + 3]).toBe(expectedAlpha)
      if (expectedAlpha === 255) {
        // Opake Pixel müssen reines Schwarz sein, nicht bloß dunkel.
        expect(data[i * 4]).toBe(0)
        expect(data[i * 4 + 1]).toBe(0)
        expect(data[i * 4 + 2]).toBe(0)
      }
      checked++
    }
    expect(checked).toBe(size * size)
  })

  it('ist deutlich kleiner als dieselben Pixel als RGBA', async () => {
    const size = 160
    const src = await ditherLikePng(size)
    const srcGray = await grayValues(src)

    // Dieselbe Schwellwert-Entscheidung, aber als RGBA gespeichert — der alte Zustand.
    const rgba = Buffer.alloc(size * size * 4)
    for (let i = 0; i < size * size; i++) {
      rgba[i * 4 + 3] = srcGray[i] >= 128 ? 0 : 255
    }
    const asRgba = await sharp(rgba, { raw: { width: size, height: size, channels: 4 } })
      .png()
      .toBuffer()

    const out = await whiteToTransparent(src.toString('base64'))
    const asPalette = Buffer.from(out.base64, 'base64')

    expect(asPalette.byteLength).toBeLessThan(asRgba.byteLength)
  })
})
