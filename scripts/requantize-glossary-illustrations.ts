/**
 * Zieht die bestehenden Lexikon-Illustrationen auf Palette-PNG nach.
 *
 * whiteToTransparent speichert seit dem 2026-08-05 als Palette-PNG statt als
 * 8-Bit-RGBA (lib/gemini/image-generator.ts). Das wirkt nur auf neu erzeugte
 * Bilder — die bestehenden bleiben bei 32 Bit je Pixel für 1 Bit Information,
 * an /de/glossary/transformer gemessen 54.602 statt 13.306 Bytes.
 *
 * Das ist LCP-relevant: next/image reicht das Original unverändert durch,
 * sobald die optimierte Variante größer wäre. Bei einem Dither-Raster ist das
 * für w=640 und w=750 der Fall — also genau für die Breiten, die ein
 * Retina-Display bei sizes="326px" anfordert.
 *
 * VERLUSTFREI: es sinkt nur die Farbtiefe, das Raster bleibt Pixel für Pixel.
 * Angefasst wird ein Bild nur, wenn es die Zusicherung von whiteToTransparent
 * nachweislich erfüllt (jeder Pixel entweder transparent oder reines Schwarz)
 * und die neue Fassung wirklich kleiner ist. Alles andere wird gemeldet und
 * übersprungen.
 *
 * Aufruf:
 *   npx tsx scripts/requantize-glossary-illustrations.ts <env-datei>
 *   npx tsx scripts/requantize-glossary-illustrations.ts <env-datei> --apply
 *
 * Ohne --apply wird NUR gelesen und berichtet. Für echte Prod-Schlüssel:
 *   vercel env pull --environment=production <env-datei>
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import sharp from 'sharp'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const envPath = args.find((a) => !a.startsWith('--')) || '.env.local'

dotenv.config({ path: envPath, quiet: true })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
)

/**
 * Farbtyp aus dem IHDR-Kopf: 3 = indiziert (Palette), 6 = RGBA. Aufbau: 8 Byte
 * Signatur, dann 4 Byte Länge, 4 Byte Kennung, 4 Byte Breite, 4 Byte Höhe,
 * 1 Byte Bittiefe, 1 Byte Farbtyp.
 */
function pngColorType(buf: Buffer): number {
  return buf[25]
}

/**
 * Prüft die Zusicherung, auf der die Umwandlung beruht: jeder Pixel ist entweder
 * vollständig transparent oder reines Schwarz. Nur dann ist eine Palette aus
 * zwei Farben verlustfrei. Ein Bild mit Grautönen oder Halbtransparenz würde
 * durch colors: 2 verändert — deshalb wird es lieber nicht angefasst.
 */
async function isTwoStateDither(buf: Buffer): Promise<boolean> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.channels !== 4) return false
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a !== 0 && a !== 255) return false
    if (a === 255 && (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0)) return false
  }
  return true
}

async function main() {
  console.log(`Modus: ${APPLY ? 'SCHREIBEN (--apply)' : 'nur lesen (Dry-Run)'}`)
  console.log(`Env:   ${envPath}\n`)

  // range() explizit: PostgREST kappt ohne Bereich still bei 1000 Zeilen.
  const { data, error } = await supabase
    .from('glossary_terms')
    .select('id, slug, illustration_url')
    .not('illustration_url', 'is', null)
    .order('slug')
    .range(0, 4999)

  if (error) {
    console.error('Begriffe nicht ladbar:', error.message)
    process.exit(1)
  }

  const terms = (data ?? []) as Array<{ id: string; slug: string; illustration_url: string }>
  console.log(`${terms.length} Begriffe mit Illustration\n`)

  let already = 0
  let skipped = 0
  let failed = 0
  let converted = 0
  let bytesBefore = 0
  let bytesAfter = 0

  // uploadGlossaryIllustration erst hier laden: dasselbe Ziel, dieselbe
  // ?v=-Logik wie der Crawl, aber der Import zieht den ganzen Bildmodul-Baum.
  const { uploadGlossaryIllustration } = await import('@/lib/gemini/image-generator')

  for (const term of terms) {
    try {
      const res = await fetch(term.illustration_url)
      if (!res.ok) {
        console.log(`  ✗ ${term.slug}: Blob nicht ladbar (${res.status})`)
        failed++
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())

      if (pngColorType(buf) === 3) {
        already++
        continue
      }

      if (!(await isTwoStateDither(buf))) {
        console.log(`  – ${term.slug}: nicht zweifarbig, übersprungen`)
        skipped++
        continue
      }

      const out = await sharp(buf).png({ palette: true, colors: 2 }).toBuffer()
      if (out.byteLength >= buf.byteLength) {
        console.log(`  – ${term.slug}: Palette nicht kleiner (${buf.byteLength} → ${out.byteLength})`)
        skipped++
        continue
      }

      bytesBefore += buf.byteLength
      bytesAfter += out.byteLength
      const pct = Math.round(100 - (100 * out.byteLength) / buf.byteLength)
      console.log(`  ${APPLY ? '✓' : '·'} ${term.slug}: ${buf.byteLength} → ${out.byteLength} Bytes (−${pct} %)`)

      if (APPLY) {
        const url = await uploadGlossaryIllustration(out.toString('base64'), term.slug)
        // Die URL MUSS mitgeschrieben werden: der Blob-Pfad bleibt gleich, also
        // liefern CDN und Browser ohne neues ?v= weiter die alte Datei aus.
        const { error: upErr } = await supabase
          .from('glossary_terms')
          .update({ illustration_url: url })
          .eq('id', term.id)
        if (upErr) {
          console.error(`  ✗ ${term.slug}: URL nicht speicherbar: ${upErr.message}`)
          failed++
          continue
        }
      }
      converted++
    } catch (err) {
      console.error(`  ✗ ${term.slug}: ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }
  }

  console.log('\n────────────────────────────────────────')
  console.log(`  ${APPLY ? 'umgewandelt' : 'umwandelbar'}: ${converted}`)
  console.log(`  schon Palette:          ${already}`)
  console.log(`  übersprungen:           ${skipped}`)
  console.log(`  Fehler:                 ${failed}`)
  if (bytesBefore > 0) {
    const pct = Math.round(100 - (100 * bytesAfter) / bytesBefore)
    console.log(`  ${(bytesBefore / 1024).toFixed(0)} KB → ${(bytesAfter / 1024).toFixed(0)} KB (−${pct} %)`)
  }
  if (!APPLY && converted > 0) {
    console.log('\n  Nichts geschrieben. Mit --apply erneut aufrufen.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
