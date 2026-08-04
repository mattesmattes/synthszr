/**
 * Einmal-Skript: erzeugt ein Test-Set von 10 Lexikonbegriffen mit VOLLEN Seiten
 * und dichter Querverlinkung, mit allen Regeln vom 2026-08-04.
 *
 * Aufruf (Prod-Credentials, bereinigte env — s. Ledger-Falle "literales \n"):
 *   node --env-file=<clean .env> --import tsx scripts/_seed_glossary_testset.ts
 *
 * WARUM DIESE ZEHN: sie bilden ein enges Cluster rund um LLM-Inferenz. Jeder
 * Erklärtext muss die anderen zwangsläufig erwähnen ("Kontextfenster" ohne
 * "Token" zu erklären geht nicht), und genau darauf setzt die Verlinkung auf:
 * linkRelatedTerms matcht die veröffentlichten Begriffe im Fließtext. Ein
 * thematisch verstreutes Set hätte dieselben Kosten und keine Verlinkung — das
 * war der gemessene Zustand vorher (1 von 5 Begriffen hatte einen Treffer).
 *
 * ABLAUF pro Begriff: generateTermContent (Regel 4 wird jetzt durchgesetzt,
 * inkl. Nachforderung) -> Illustration falls needs_illustration -> UPSERT als
 * status='published' -> Embedding (nötig für die Nachbarschafts-RPC) ->
 * assignProducts.
 *
 * UPSERT statt INSERT: für mehrere dieser Namen existieren bereits Drafts aus
 * den lexicon-Läufen. Ein Insert würde am slug-Unique-Constraint scheitern,
 * nachdem Content und Bild bezahlt sind. Der Draft wird also überschrieben, nicht
 * gelöscht — kein Datenverlust, und die neuen Regeln greifen.
 */
import { generateTermContent } from '@/lib/glossary/generate'
import { generateGlossaryIllustration, uploadGlossaryIllustration } from '@/lib/gemini/image-generator'
import { assignProducts } from '@/lib/glossary/products'
import { generateEmbedding } from '@/lib/embeddings/generator'
import { createAdminClient } from '@/lib/supabase/admin'

const TERMS = [
  // Die zehn neuen — enges Cluster, jeder Text muss die anderen erwähnen.
  'Token',
  'Kontextfenster',
  'Transformer',
  'Attention',
  'Quantisierung',
  'Modellgewichte',
  'Fine-Tuning',
  'Retrieval-Augmented Generation',
  'Embedding',
  'Halluzination',
  // Die fünf bereits veröffentlichten, neu erzeugt: sie stammen aus der Zeit vor
  // Regel-4-Durchsetzung, Überschriften-Regel und Metapher-Bildprompt und hätten
  // sonst ~150 Wörter neben 400+ der neuen. Sie gehören ins selbe Cluster
  // ("Token" erklärt sich über Inferenz), die Verlinkung würde also auf dünne
  // Seiten zeigen.
  'Inferenz',
  'Mixture of Experts',
  'CUDA',
  'API-Gateway',
  'Bug-Bounty-Programm',
]

const supabase = createAdminClient()

function words(body: unknown): number {
  const collect = (n: unknown): string => {
    if (!n || typeof n !== 'object') return ''
    const o = n as Record<string, unknown>
    const self = typeof o.text === 'string' ? o.text : ''
    const kids = Array.isArray(o.content) ? o.content.map(collect).join(' ') : ''
    return `${self} ${kids}`
  }
  return collect(body).trim().split(/\s+/).filter(Boolean).length
}

async function seed(name: string, i: number) {
  const t0 = Date.now()
  console.log(`\n[${i + 1}/${TERMS.length}] ${name} …`)
  let gen
  try {
    gen = await generateTermContent(name)
  } catch (e) {
    console.error(`  ✗ Generierung fehlgeschlagen: ${e instanceof Error ? e.message : e}`)
    return null
  }
  console.log(`  Text: ${words(gen.body)} Wörter, Lesbarkeit ${gen.readabilityScore ?? '—'}, Slug ${gen.slug}`)
  console.log(`  Überschriften: ${(gen.body as { content?: Array<{ type: string; content?: Array<{ text?: string }> }> })
    .content?.filter((n) => n.type === 'heading').map((n) => n.content?.[0]?.text).join(' | ')}`)

  let illustrationUrl: string | null = null
  if (gen.needsIllustration) {
    try {
      const img = await generateGlossaryIllustration(gen.canonicalName, gen.summary)
      if (img.success && img.imageBase64) {
        illustrationUrl = await uploadGlossaryIllustration(img.imageBase64, gen.slug)
        console.log(`  Bild: ${illustrationUrl}`)
      } else {
        console.log(`  Bild: fehlgeschlagen (${img.error})`)
      }
    } catch (e) {
      console.log(`  Bild: Wurf (${e instanceof Error ? e.message : e})`)
    }
  } else {
    console.log('  Bild: needs_illustration=false')
  }

  // Embedding für die Nachbarschafts-RPC (match_glossary_related_terms). Ohne das
  // greift nur das Text-Matching; der News-Cron würde es später nachziehen.
  let embedding: string | null = null
  try {
    const vec = await generateEmbedding(`${gen.canonicalName}. ${gen.summary}`)
    if (vec?.length) embedding = `[${vec.join(',')}]`
  } catch (e) {
    console.log(`  Embedding: fehlgeschlagen (${e instanceof Error ? e.message : e})`)
  }

  const row = {
    slug: gen.slug,
    canonical_name: gen.canonicalName,
    aliases: gen.aliases,
    status: 'published',
    summary: gen.summary,
    body: gen.body,
    illustration_url: illustrationUrl,
    illustration_alt: gen.illustrationAlt,
    readability_score: gen.readabilityScore,
    ...(embedding ? { embedding } : {}),
    updated_at: new Date().toISOString(),
  }
  const { data: up, error } = await supabase
    .from('glossary_terms')
    .upsert(row, { onConflict: 'slug' })
    .select('id')
    .single()
  if (error) {
    console.error(`  ✗ Upsert fehlgeschlagen: ${error.message}`)
    return null
  }
  console.log(`  ✓ published (${Math.round((Date.now() - t0) / 1000)}s)`)

  try {
    const n = await assignProducts(up.id, gen.canonicalName, gen.summary)
    console.log(`  Produkte: ${n ?? 0}`)
  } catch (e) {
    console.log(`  Produkte: fehlgeschlagen (${e instanceof Error ? e.message : e})`)
  }
  return gen.slug
}

// main()-Wrapper, kein Top-Level-await: tsx transpiliert dieses Skript nach CJS
// ("Top-level await is currently not supported with the cjs output format").
// Muster aus scripts/_glossary_image_test.ts.
async function main() {
  const done: string[] = []
  const failed: string[] = []
  for (let i = 0; i < TERMS.length; i++) {
    const slug = await seed(TERMS[i], i)
    if (slug) done.push(slug)
    else failed.push(TERMS[i])
  }

  console.log(`\n=== ${done.length}/${TERMS.length} erzeugt und veröffentlicht ===`)
  console.log(done.join(', '))
  if (failed.length > 0) {
    // Erwartbar: Regel 4 wirft, wenn ein Eintrag auch nach der Nachforderung unter
    // 400 Wörtern bleibt. Diese Begriffe behalten ihren bisherigen Zustand.
    console.log(`\nNICHT erzeugt (${failed.length}): ${failed.join(', ')}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
