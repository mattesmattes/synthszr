import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { fetchStockSynthszr } from '../lib/stock-synthszr/fetch-synthesis'
import { STOCK_SYNTHSZR_CACHE_MS } from '../lib/config/constants'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://zadrjbyszvsusukajsbp.supabase.co'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY missing')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const DRY_RUN = process.argv.includes('--dry-run')
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity

async function main() {
  const { data: entries, error } = await supabase
    .from('stock_synthszr_cache')
    .select('company, currency, created_at')
    .order('created_at', { ascending: true })

  if (error) throw error
  if (!entries) {
    console.log('No entries found')
    return
  }

  console.log(`Total cached companies: ${entries.length}`)

  if (DRY_RUN) {
    for (const e of entries.slice(0, 20)) {
      console.log(`  - ${e.company} (${e.currency}) created ${e.created_at}`)
    }
    if (entries.length > 20) console.log(`  ... and ${entries.length - 20} more`)
    return
  }

  const target = entries.slice(0, LIMIT)
  console.log(`Regenerating ${target.length} entries in English...`)

  let ok = 0
  let fail = 0
  for (let i = 0; i < target.length; i++) {
    const e = target[i]
    const label = `[${i + 1}/${target.length}] ${e.company} (${e.currency})`
    try {
      console.log(`${label} generating...`)
      const result = await fetchStockSynthszr({
        company: e.company,
        currency: e.currency,
        recencyDays: 90,
      })
      const now = new Date()
      const expiresAt = new Date(now.getTime() + STOCK_SYNTHSZR_CACHE_MS)
      const { error: upErr } = await supabase
        .from('stock_synthszr_cache')
        .upsert(
          {
            company: e.company.toLowerCase(),
            currency: e.currency,
            data: result,
            model: result.model,
            created_at: now.toISOString(),
            expires_at: expiresAt.toISOString(),
          },
          { onConflict: 'company,currency', ignoreDuplicates: false }
        )
      if (upErr) throw upErr
      ok++
      console.log(`${label} ✓`)
    } catch (err) {
      fail++
      console.error(`${label} ✗`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`\nDone. ok=${ok} fail=${fail}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
