import { config } from 'dotenv'
config({ path: process.env.HOME + '/.synthszr.env.prod', quiet: true })

// Gezielter Eintrags-Fix für "Seedream 5.0 Pro":
// 1) Vendor unknown -> bytedance (resolveProduct legt Kanon an, mergeProductsInto zieht
//    die Mentions vom unknown-Produkt rüber und löscht es).
// 2) Kategorie-Membership (text-to-image, is_primary) für das bytedance-Produkt sichern.
// 3) Web-Research (Sonnet 5) -> __description/__description_en/__released + Feature-Specs,
//    mit demselben Safe-Replace-Guard wie research.ts.
// 4) precomputeMetrics() + revalidate('rankings').
const OLD_ID = '09b72346-e7e6-45ed-bf94-8bc7aec2dbec' // unknown-seedream-5-0-pro
const NAME = 'Seedream 5.0 Pro'
const VENDOR = 'bytedance'
const CATEGORY = 'text-to-image'
const META_KEEP = '(__sentiment,__description,__description_en,__released)'

async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { resolveProduct } = await import('@/lib/rankings/resolve-product')
  const { mergeProductsInto } = await import('@/lib/rankings/consolidate')
  const { researchProduct } = await import('@/lib/rankings/research')
  const { precomputeMetrics } = await import('@/lib/rankings/precompute')
  const sb = createAdminClient()

  // Evidence-Excerpt vom Alt-Produkt (für resolve + research als Suchhilfe)
  const { data: oldMents } = await sb.from('product_mentions').select('excerpt')
    .eq('product_id', OLD_ID).not('excerpt', 'is', null).limit(25)
  const evidence = (oldMents ?? []).map((x: any) => (x.excerpt as string)?.trim())
    .filter(Boolean).map((e: string) => `- ${e}`).join('\n').slice(0, 8000)
  console.log(`[0] Evidence: ${oldMents?.length ?? 0} Excerpts`)

  // 1) Kanon bytedance anlegen/finden
  const resolved = await resolveProduct({ vendor: VENDOR, detectedName: NAME, evidence: evidence.slice(0, 300) })
  const newId = resolved.productId
  console.log(`[1] resolveProduct -> id=${newId} isNew=${resolved.isNew} key=${resolved.canonicalKey}`)

  // 2) Alt-Produkt (unknown) in den Kanon mergen (Mentions/Features wandern, Alt wird gelöscht)
  if (newId !== OLD_ID) {
    await mergeProductsInto(sb, newId, [OLD_ID])
    console.log(`[2] mergeProductsInto: ${OLD_ID} -> ${newId} (unknown-Produkt gelöscht)`)
  } else {
    console.log('[2] WARN: newId === OLD_ID, kein Merge')
  }

  // 3) Kategorie-Membership sichern (merge überträgt sie nicht — cascadet beim Löschen)
  const { error: memErr } = await sb.from('product_category_membership')
    .upsert({ product_id: newId, category: CATEGORY, is_primary: true }, { onConflict: 'product_id,category' })
  if (memErr) throw new Error(`membership upsert: ${memErr.message}`)
  console.log(`[3] Membership gesetzt: ${CATEGORY} (is_primary)`)

  // 4) Web-Research + Persist
  const { data: cat } = await sb.from('product_categories').select('name, feature_dimensions').eq('slug', CATEGORY).single()
  const dimensions: string[] = Array.isArray(cat?.feature_dimensions) ? (cat!.feature_dimensions as string[]) : []
  console.log(`[4] Research startet (Kategorie "${cat?.name}", ${dimensions.length} Dimensionen)...`)
  const res = await researchProduct(NAME, VENDOR, cat?.name as string, dimensions, evidence)
  console.log(`    -> ${res.features.length} Features, desc=${res.description ? 'JA' : 'nein'}, release=${res.releaseDate ?? '-'}`)

  const rows: any[] = res.features.map((f) => ({
    product_id: newId, category: CATEGORY, dimension_key: f.dimension,
    value_text: f.value, value_text_en: f.valueEn ?? null,
    confidence: 0.85, evidence_count: 1, source_count: 1,
  }))
  if (res.description) rows.push({ product_id: newId, category: CATEGORY, dimension_key: '__description', value_text: res.description, confidence: 0.85, evidence_count: 1, source_count: 1 })
  if (res.descriptionEn) rows.push({ product_id: newId, category: CATEGORY, dimension_key: '__description_en', value_text: res.descriptionEn, confidence: 0.85, evidence_count: 1, source_count: 1 })
  if (res.releaseDate) rows.push({ product_id: newId, category: CATEGORY, dimension_key: '__released', value_text: res.releaseDate, confidence: 0.85, evidence_count: 1, source_count: 1 })
  rows.push({ product_id: newId, category: CATEGORY, dimension_key: '__researched_at', value_text: new Date().toISOString(), confidence: 1, evidence_count: 0, source_count: 1 })

  // Safe-Replace: alte echte Dims nur löschen, wenn Neu-Recherche welche lieferte
  if (res.features.length > 0) {
    await sb.from('product_features_current').delete().eq('product_id', newId).not('dimension_key', 'in', META_KEEP)
  }
  const { error: upErr } = await sb.from('product_features_current').upsert(rows, { onConflict: 'product_id,category,dimension_key' })
  if (upErr) throw new Error(`features upsert: ${upErr.message}`)
  console.log(`    -> ${rows.length} Rows geschrieben`)

  // 5) Metrics neu berechnen
  console.log('[5] precomputeMetrics()...')
  const pm = await precomputeMetrics()
  console.log(`    -> ${pm.computed} Produkte berechnet`)

  // 6) Verifikation
  const { data: check } = await sb.from('products').select('id, canonical_name, slug, vendor_namespace').eq('id', newId).single()
  const { data: metrics } = await sb.from('product_metrics').select('mention_count, chartable, primary_category, momentum').eq('product_id', newId).maybeSingle()
  const { data: desc } = await sb.from('product_features_current').select('value_text').eq('product_id', newId).eq('dimension_key', '__description').maybeSingle()
  console.log('\n=== ERGEBNIS ===')
  console.log('Produkt:', JSON.stringify(check))
  console.log('Metrics:', JSON.stringify(metrics))
  console.log('Beschreibung:', desc?.value_text ? desc.value_text.slice(0, 160) : 'KEINE')

  // 7) Cache invalidieren
  const r = await fetch('https://www.synthszr.com/api/revalidate-rankings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.REVALIDATE_SECRET ?? ''}` },
  })
  console.log(`\n[7] revalidate-rankings -> HTTP ${r.status}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
