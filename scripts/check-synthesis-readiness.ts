import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DIGEST_ID = '9c9132c9-6fdb-4a9b-902e-395fd9397e9f'

async function fullCheck() {
  console.log('=== Vollständige System-Prüfung für Synthese Re-Run ===\n')

  const issues: string[] = []

  // 1. Active synthesis prompt
  const { data: prompt, error: promptErr } = await supabase
    .from('synthesis_prompts')
    .select('id, name, development_prompt, content_prompt, core_thesis')
    .eq('is_active', true)
    .single()

  if (promptErr || prompt === null) {
    issues.push('Kein aktiver Synthese-Prompt gefunden')
    console.log('❌ Synthese-Prompt: FEHLT')
  } else {
    const hasDevPrompt = prompt.development_prompt && prompt.development_prompt.length > 100
    const hasThesis = prompt.core_thesis && prompt.core_thesis.length > 10
    if (hasDevPrompt === false || hasThesis === false) {
      issues.push('Synthese-Prompt unvollständig')
      console.log('⚠️  Synthese-Prompt: Unvollständig')
    } else {
      console.log('✓ Synthese-Prompt: OK (' + prompt.name + ')')
    }
  }

  // 2. Candidates check
  const { data: candidates, error: candErr } = await supabase
    .from('synthesis_candidates')
    .select(`
      id,
      source_item_id,
      related_item_id,
      daily_repo!synthesis_candidates_source_item_id_fkey(id, title, content),
      related:daily_repo!synthesis_candidates_related_item_id_fkey(id, title, content)
    `)
    .eq('digest_id', DIGEST_ID)

  if (candErr || candidates === null) {
    issues.push('Kandidaten-Abfrage fehlgeschlagen: ' + candErr?.message)
    console.log('❌ Kandidaten: Abfrage-Fehler')
  } else {
    const validCandidates = candidates.filter((c) => {
      const s = c.daily_repo as { content?: string } | null
      const r = c.related as { content?: string } | null
      return s?.content && r?.content
    })
    if (validCandidates.length === 0) {
      issues.push('Keine validen Kandidaten mit Content')
      console.log('❌ Kandidaten: 0 valide')
    } else {
      console.log('✓ Kandidaten: ' + validCandidates.length + ' valide von ' + candidates.length)
    }
  }

  // 3. Existing syntheses (should be 0 for re-run)
  const { data: syntheses } = await supabase
    .from('developed_syntheses')
    .select('id')
    .eq('digest_id', DIGEST_ID)

  console.log('✓ Existierende Synthesen: ' + (syntheses?.length || 0) + ' (werden übersprungen)')

  // 4. Check daily_repo items for the date
  const { count } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .eq('newsletter_date', '2026-01-24')

  console.log('✓ Daily Repo Items für 24.1.: ' + (count || 0))

  // 5. Check embeddings
  const { count: embeddingCount } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .eq('newsletter_date', '2026-01-24')
    .not('embedding', 'is', null)

  console.log('✓ Items mit Embeddings: ' + (embeddingCount || 0))

  // 6. Check news_queue function
  const { error: queueErr } = await supabase.from('news_queue').select('id').limit(1)

  if (queueErr) {
    issues.push('news_queue Tabelle nicht erreichbar')
    console.log('❌ News Queue: ' + queueErr.message)
  } else {
    console.log('✓ News Queue: Erreichbar')
  }

  // 7. Check find_similar_items function
  const { data: testItem } = await supabase
    .from('daily_repo')
    .select('id, embedding')
    .eq('newsletter_date', '2026-01-24')
    .not('embedding', 'is', null)
    .limit(1)
    .single()

  if (testItem) {
    const { data: similar, error: rpcErr } = await supabase.rpc('find_similar_items', {
      query_embedding: testItem.embedding,
      item_id: testItem.id,
      max_age_days: 90,
      match_threshold: 0.5,
      match_count: 3,
    })

    if (rpcErr) {
      issues.push('find_similar_items RPC Fehler: ' + rpcErr.message)
      console.log('❌ Similarity Search: ' + rpcErr.message)
    } else {
      console.log('✓ Similarity Search: Funktioniert (' + (similar?.length || 0) + ' Ergebnisse)')
    }
  }

  // 8. Check if related items in candidates are from historical dates
  if (candidates && candidates.length > 0) {
    const relatedIds = candidates.map((c) => c.related_item_id)
    const { data: relatedItems } = await supabase
      .from('daily_repo')
      .select('id, newsletter_date')
      .in('id', relatedIds)

    const sameDayItems = (relatedItems || []).filter(
      (r) => r.newsletter_date === '2026-01-24'
    )
    if (sameDayItems.length > 0) {
      issues.push(sameDayItems.length + ' Kandidaten verweisen auf Same-Day Items (Bug)')
      console.log('❌ Historische Referenzen: ' + sameDayItems.length + ' Same-Day Items gefunden!')
    } else {
      const dates = [...new Set((relatedItems || []).map((r) => r.newsletter_date))].sort()
      console.log('✓ Historische Referenzen: Alle älter als 24.1. (' + dates.join(', ') + ')')
    }
  }

  // Summary
  console.log('\n=== Ergebnis ===')
  if (issues.length === 0) {
    console.log('✅ Alle Checks bestanden - Re-Run sollte funktionieren!')
  } else {
    console.log('⚠️  ' + issues.length + ' Problem(e) gefunden:')
    issues.forEach((i) => console.log('   - ' + i))
  }
}

fullCheck().catch(console.error)
