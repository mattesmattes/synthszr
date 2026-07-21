// lib/rankings/resolve-product.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { generateEmbedding } from '@/lib/embeddings/generator'
import { normalizeAlias } from '@/lib/rankings/canonicalize'
import { buildProductInsert } from '@/lib/rankings/resolve-product-payload'
import { isExcludedProduct, isCommonWordNonProduct } from '@/lib/rankings/product-exclusions'

type Admin = ReturnType<typeof createAdminClient>

/** INSERT, das eine DB-Unique-Verletzung (23505) als „schon da" toleriert. */
async function insertIgnoreDup(supabase: Admin, table: string, row: Record<string, unknown>) {
  const { error } = await supabase.from(table).insert(row)
  if (error && error.code !== '23505') throw error
}

async function ensureCreatedEvent(supabase: Admin, productId: string, key: string, evidence?: string) {
  await insertIgnoreDup(supabase, 'product_identity_events', {
    product_id: productId, event_type: 'created', new_key: key, confidence: 0, evidence: evidence ?? null,
  })
}

async function ensureAlias(supabase: Admin, productId: string, vendor: string, detectedName: string) {
  await insertIgnoreDup(supabase, 'product_aliases', {
    product_id: productId, vendor_namespace: vendor,
    alias_raw: detectedName, alias_normalized: normalizeAlias(detectedName), alias_type: 'spelling',
  })
}

/**
 * Löst einen erkannten Produktnamen idempotent + selbstheilend auf den
 * products-Eintrag auf. Identität ausschließlich über den exakten canonical_key.
 */
export async function resolveProduct(opts: {
  vendor: string; detectedName: string; evidence?: string
}): Promise<{ productId: string; canonicalKey: string; isNew: boolean }> {
  const supabase = createAdminClient()
  const p = buildProductInsert(opts.vendor, opts.detectedName)
  // NACKTER Herstellername (z.B. "Anthropic", "Mistral") → kein Chart-Produkt.
  // Mit Modell-Zusatz (Version/Qualifier, z.B. "Mistral Large 3") bleibt es ein Produkt.
  // Reine Konzept-/Allerweltswörter ("Agents", "Reasoning", "Benchmark") ebenfalls raus,
  // hier unabhängig von Version/Qualifier — sie sind nie ein Produkt.
  // 'hidden' = aus den Charts genommen (der CHECK-Constraint products_visibility_status_chk
  // erlaubt nur 'visible'/'hidden', NICHT 'excluded' — precompute lädt ohnehin nur 'visible').
  const visibility =
    (isExcludedProduct(p.family) && !p.version && !p.qualifier) || isCommonWordNonProduct(p.family)
      ? 'hidden'
      : 'visible'

  // 1) Exakter Lookup → Heilung + last_seen
  const { data: existing } = await supabase
    .from('products').select('id').eq('canonical_key', p.canonical_key).maybeSingle()
  if (existing) {
    // Heilung: last_seen immer; visibility nur VERSCHÄRFEN (auf 'hidden'). Ein bereits
    // ausgeblendetes Produkt NICHT zurück auf 'visible' heben — sonst würde eine neue
    // Alltagswort-Erwähnung das kontextbasierte validity-QA-Urteil (oder einen
    // manuellen Hide) aufheben.
    const patch: Record<string, unknown> = { last_seen: new Date().toISOString() }
    if (visibility === 'hidden') patch.visibility_status = 'hidden'
    await supabase.from('products').update(patch).eq('id', existing.id)
    await ensureCreatedEvent(supabase, existing.id, p.canonical_key, opts.evidence)
    await ensureAlias(supabase, existing.id, p.vendor_namespace, opts.detectedName)
    return { productId: existing.id, canonicalKey: p.canonical_key, isNew: false }
  }

  // 2) Family-Embedding (best-effort, nur exakte Dimension)
  let familyEmbedding: number[] | null = null
  try { const e = await generateEmbedding(p.family); if (Array.isArray(e) && e.length === 768) familyEmbedding = e } catch { /* non-fatal */ }

  // 3) Race-safe Upsert (canonical_key NICHT setzen — GENERATED)
  const { data: inserted, error: insErr } = await supabase
    .from('products')
    .upsert({
      vendor_namespace: p.vendor_namespace, family: p.family, version: p.version, qualifier: p.qualifier,
      canonical_name: p.canonical_name, slug: p.slug, family_embedding: familyEmbedding,
      identity_status: 'candidate', visibility_status: visibility, confidence_band: 'low',
    }, { onConflict: 'canonical_key', ignoreDuplicates: true })
    .select('id').maybeSingle()
  if (insErr) throw insErr

  if (!inserted) {
    // Race: parallel angelegt → re-select + Heilung
    const { data: raced, error: raceErr } = await supabase
      .from('products').select('id').eq('canonical_key', p.canonical_key).single()
    if (raceErr) throw raceErr
    if (!raced) throw new Error(`resolveProduct: race-reselect fehlgeschlagen für ${p.canonical_key}`)
    await ensureCreatedEvent(supabase, raced.id, p.canonical_key, opts.evidence)
    await ensureAlias(supabase, raced.id, p.vendor_namespace, opts.detectedName)
    return { productId: raced.id, canonicalKey: p.canonical_key, isNew: false }
  }

  await ensureCreatedEvent(supabase, inserted.id, p.canonical_key, opts.evidence)
  await ensureAlias(supabase, inserted.id, p.vendor_namespace, opts.detectedName)
  return { productId: inserted.id, canonicalKey: p.canonical_key, isNew: true }
}
