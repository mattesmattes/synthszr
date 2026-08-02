import { config } from 'dotenv'
config({ path: '/private/tmp/claude-501/-Users-mattes-Library-CloudStorage-Dropbox-dev-synthszr/c70e1549-2274-4b42-9231-283a073f6f9a/scratchpad/.env.prod' })

const META = ['__sentiment', '__description', '__description_en', '__released', '__researched_at']

async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { runProductResearch } = await import('@/lib/rankings/research')
  const { precomputeMetrics } = await import('@/lib/rankings/precompute')
  const supabase = createAdminClient()
  const pageAll = async (tbl: string, sel: string, filt: (q: any) => any): Promise<any[]> => {
    const out: any[] = []
    for (let off = 0; ; off += 1000) { const { data } = await filt(supabase.from(tbl).select(sel)).range(off, off + 999); if (!data?.length) break; out.push(...data); if (data.length < 1000) break }
    return out
  }
  const t10 = (await pageAll('product_metrics', 'product_id', (q) => q.eq('chartable', true).gte('mention_count', 10))).map((r) => r.product_id as string)
  const haveFeat = new Set((await pageAll('product_features_current', 'product_id', (q) => q.not('dimension_key', 'in', `(${META.join(',')})`))).map((r) => r.product_id as string))
  const targets = t10.filter((id) => !haveFeat.has(id))
  console.log(`≥10: ${t10.length}, ohne Features (Ziele): ${targets.length}`)
  for (let i = 0; i < targets.length; i += 100) {
    await supabase.from('product_features_current').delete().eq('dimension_key', '__researched_at').in('product_id', targets.slice(i, i + 100))
  }
  console.log('Marker gelöscht')

  const t0 = Date.now(); let last = 0; let fails = 0
  const orig = console.error; console.error = (...a: unknown[]) => { if (JSON.stringify(a).includes('fetch failed') || JSON.stringify(a).includes('usage limit')) fails++; orig(...a) }
  const { researched } = await runProductResearch({
    minMentions: 10, force: false, concurrency: 5, limit: 1000,
    onProgress: (r, a) => { if (a - last >= 100) { last = a; console.log(`  attempted ${a}, researched ${r}, fails ${fails} (${((Date.now() - t0) / 60000).toFixed(1)}m)`) } },
  })
  console.log(`RECOVER FERTIG: ${researched} recherchiert, ${fails} fails, ${((Date.now() - t0) / 60000).toFixed(1)}m`)
  let computed = 0
  for (let i = 1; i <= 3; i++) { try { computed = (await precomputeMetrics()).computed; break } catch (e) { console.error(`precompute ${i}:`, e instanceof Error ? e.message : e) } }
  console.log('precompute:', computed)
  await fetch('https://www.synthszr.com/api/revalidate-rankings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.REVALIDATE_SECRET ?? ''}` },
  }).then((r) => console.log('revalidate:', r.status)).catch(() => {})
  console.log('FERTIG')
}
main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1) })
