/** Misst an den ECHTEN Bestandsbildern, wie viel Halbton sie tragen —
 *  der Korn-Effekt lebt ausschliesslich davon. */
import { config } from 'dotenv'
import os from 'node:os'
import { writeFileSync } from 'node:fs'
import sharp from 'sharp'
config({ path: os.homedir() + '/.synthszr.env.prod', quiet: true })

const U = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const Z = 384

async function halbtonAnteil(url: string) {
  const r = await fetch(url)
  if (!r.ok) return null
  const buf = Buffer.from(await r.arrayBuffer())
  const { data } = await sharp(buf).resize(Z, Z, { kernel: 'nearest' })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const d = new Uint8Array(Z * Z)
  for (let p = 0; p < Z * Z; p++) d[p] = data[p * 4 + 3] > 127 ? 1 : 0
  let gesetzt = 0, halbton = 0
  for (let y = 1; y < Z - 1; y++) for (let x = 1; x < Z - 1; x++) {
    const p = y * Z + x
    if (d[p]) gesetzt++
    let n = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx || dy) n += d[(y + dy) * Z + x + dx]
    }
    if (d[p] && n >= 2 && n <= 6) halbton++
  }
  return { dichte: +(100 * gesetzt / (Z * Z)).toFixed(2), halbton: +(100 * halbton / (Z * Z)).toFixed(2) }
}

async function main() {
  const slugs = process.argv[2].split(',')
  const r = await fetch(`${U}/rest/v1/glossary_terms?slug=in.(${slugs.join(',')})&select=slug,canonical_name,illustration_url,animation_params`,
    { headers: { apikey: K, Authorization: `Bearer ${K}` } })
  const rows: any[] = await r.json()
  const out: any[] = []
  for (const t of rows) {
    if (!t.illustration_url) { console.log(t.slug, 'KEIN BILD'); continue }
    const m = await halbtonAnteil(t.illustration_url)
    if (!m) { console.log(t.slug, 'BILD NICHT LADBAR'); continue }
    out.push({ slug: t.slug, name: t.canonical_name, url: t.illustration_url, ...m })
    console.log(t.slug.padEnd(22), `Dichte ${String(m.dichte).padStart(5)}%  Halbton ${String(m.halbton).padStart(5)}%`)
  }
  out.sort((a, b) => b.halbton - a.halbton)
  writeFileSync('/private/tmp/claude-501/-Users-mattes-Library-CloudStorage-Dropbox-dev-synthszr/5d78afe8-8009-4059-a6f5-7d1673bdf223/scratchpad/r2/echte.json', JSON.stringify(out, null, 1))
}
void main()
