// Verifikation Klasse-A-RLS: anon-count vs service_role-count pro Tabelle.
// ADMIN-ONLY: anon MUSS 0 sein. PUBLIC-READ: 0 < anon <= admin (Drafts gesperrt).
import { createClient } from '@supabase/supabase-js'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anon = createClient(url, anonKey)
const svc = createClient(url, svcKey)

const ADMIN_ONLY = [
  'daily_repo', 'daily_digests', 'news_queue', 'ghostwriter_prompts',
  'vocabulary_dictionary', 'newsletter_settings', 'translation_queue',
  'edit_history', 'post_podcasts',
]
const PUBLIC_READ = [
  'posts', 'generated_posts', 'content_translations', 'post_images',
  'static_pages', 'languages', 'newsletter_sources',
]

async function count(sb: ReturnType<typeof createClient>, t: string) {
  const { error, count } = await sb.from(t).select('*', { count: 'exact', head: true })
  if (error) return { err: `${error.code ?? ''} ${error.message.slice(0, 40)}` }
  return { n: count ?? 0 }
}

async function main() {
  console.log('=== ADMIN-ONLY (anon MUSS 0 / blockiert sein) ===')
  for (const t of ADMIN_ONLY) {
    const a = await count(anon, t); const s = await count(svc, t)
    const ok = a.err || a.n === 0
    console.log(`  ${ok ? '✅' : '❌ OFFEN'} ${t.padEnd(24)} anon=${a.err ? `BLOCK(${a.err})` : a.n}  admin=${s.n ?? s.err}`)
  }
  console.log('\n=== PUBLIC-READ (anon nur published-Teilmenge; anon<=admin, >0) ===')
  for (const t of PUBLIC_READ) {
    const a = await count(anon, t); const s = await count(svc, t)
    const an = a.err ? -1 : (a.n ?? 0); const sn = s.n ?? 0
    let verdict = '✅'
    if (a.err) verdict = `❌ BLOCKIERT (${a.err}) — öffentliche Reads brechen!`
    else if (an > sn) verdict = '❌ anon>admin (unmöglich)'
    else if (an === 0 && sn > 0) verdict = '⚠️ anon=0 trotz Daten — Filter zu streng?'
    console.log(`  ${verdict} ${t.padEnd(22)} anon=${an < 0 ? 'BLOCK' : an}  admin=${sn}  ${an >= 0 && an < sn ? `(${sn - an} nicht-öffentl. verborgen)` : an === sn ? '(alle öffentlich)' : ''}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
