import { config } from 'dotenv'
config({ path: process.argv[3] || '.env.local' })
import { readFileSync } from 'fs'

// Stellt product_features_current aus einem Backup wieder her (upsert, überschreibt
// nichts anderes). Aufruf: npx tsx scripts/restore-features.ts <backup.json> [envfile]
async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()
  const file = process.argv[2]
  if (!file) { console.error('Aufruf: restore-features.ts <backup.json> [envfile]'); process.exit(1) }
  const rows = JSON.parse(readFileSync(file, 'utf8')) as Array<Record<string, unknown>>
  let done = 0
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('product_features_current')
      .upsert(rows.slice(i, i + 500), { onConflict: 'product_id,category,dimension_key' })
    if (error) throw new Error(error.message)
    done += Math.min(500, rows.length - i)
  }
  console.log(`Restore: ${done} Zeilen upserted aus ${file}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1) })
