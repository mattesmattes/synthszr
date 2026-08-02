import { config } from 'dotenv'
config({ path: '/private/tmp/claude-501/-Users-mattes-Library-CloudStorage-Dropbox-dev-synthszr/f4844f86-ef73-4ff4-ae3e-026d6ecebbc3/scratchpad/.env.prod', quiet: true })

async function main() {
  const { runProductResearch } = await import('@/lib/rankings/research')
  const t0 = Date.now()
  const { researched } = await runProductResearch({
    minMentions: 1000, force: false, concurrency: 4, limit: 10,
    onProgress: (r, a) => console.log(`  progress: attempted ${a}, researched ${r} (${((Date.now() - t0) / 1000).toFixed(0)}s)`),
  })
  console.log(`\nLAUF FERTIG: ${researched} recherchiert, ${((Date.now() - t0) / 1000).toFixed(0)}s`)

  // Rankings-Cache invalidieren, damit neue Feature-Tabellen öffentlich erscheinen
  await fetch('https://www.synthszr.com/api/revalidate-rankings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.REVALIDATE_SECRET ?? ''}` },
  }).then((r) => console.log('revalidate:', r.status)).catch((e) => console.log('revalidate err:', e))
}
main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e instanceof Error ? e.message : e); process.exit(1) })
