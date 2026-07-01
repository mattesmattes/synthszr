import { config } from 'dotenv'
// Env: Standard .env.local, oder Pfad via 2. Argument.
config({ path: process.argv[3] || '.env.local' })
import { writeFileSync } from 'fs'

// Sichert product_features_current in eine JSON-Datei (durables Backup der recherchierten
// Feature-Daten — teuer per API zu regenerieren). Aufruf:
//   npx tsx scripts/backup-features.ts <out.json> [envfile]
async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()
  const out = process.argv[2]
  if (!out) { console.error('Aufruf: backup-features.ts <out.json> [envfile]'); process.exit(1) }
  const rows: unknown[] = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase.from('product_features_current')
      .select('product_id, category, dimension_key, value_text, value_numeric, confidence, evidence_count, source_count')
      .range(off, off + 999)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  writeFileSync(out, JSON.stringify(rows))
  console.log(`Backup: ${rows.length} Zeilen → ${out}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1) })
