/**
 * Einmal-Skript, zwei Aufgaben (User-Freigabe für Prod-Schreibzugriff erteilt):
 *
 * 1. illustration_url aller veröffentlichten Begriffe auf NULL setzen. Grund:
 *    13 Bilder stammen aus meinem lokalen Gemini-Fallback (falsches Modell —
 *    gewünscht ist openai/gpt-image-2), und die restlichen stammen aus der Zeit
 *    vor dem Prompt-Wechsel (Diagramm statt tonaler Metapher) und vor
 *    coarseness 3. Nach dem Nullen greift der Knopf „Fehlende Illustrationen
 *    erzeugen" im Crawl-Tab, der serverseitig über die konfigurierte
 *    Modellkette läuft — dort ist der OPENAI_API_KEY echt.
 *    Die Blobs selbst bleiben liegen und werden beim nächsten Upload
 *    überschrieben (allowOverwrite, heute ergänzt).
 *
 * 2. Alle veröffentlichten Begriffe übersetzen. Der automatische Auslöser
 *    (translatePublishedTerms) greift nur bei NEUEN Veröffentlichungen; die
 *    bestehenden Begriffe sind auf /en/glossary/* noch deutsch.
 *    ANTHROPIC_API_KEY ist in der gezogenen Env unredigiert, das läuft lokal.
 *
 * Aufruf:
 *   node --env-file=<clean .env> --import tsx scripts/_glossary_reset_and_translate.ts
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { translatePublishedTerms } from '@/lib/glossary/translate'

async function main() {
  const supabase = createAdminClient()

  const { data: terms, error } = await supabase
    .from('glossary_terms')
    .select('id, slug, illustration_url')
    .eq('status', 'published')
    .order('slug')
  if (error) throw new Error(`Begriffe nicht ladbar: ${error.message}`)
  const rows = (terms ?? []) as Array<{ id: string; slug: string; illustration_url: string | null }>
  console.log(`${rows.length} veröffentlichte Begriffe\n`)

  // --- 1) Bilder zum Neuerzeugen freigeben ---
  const withImage = rows.filter((r) => r.illustration_url)
  if (withImage.length > 0) {
    const { error: clearErr } = await supabase
      .from('glossary_terms')
      .update({ illustration_url: null, illustration_alt: null })
      .in('id', withImage.map((r) => r.id))
    if (clearErr) console.error(`✗ illustration_url nicht zurücksetzbar: ${clearErr.message}`)
    else console.log(`✓ ${withImage.length} Illustrationen freigegeben (werden über gpt-image-2 neu erzeugt)`)
  } else {
    console.log('— kein Begriff hatte ein Bild')
  }

  // --- 2) Übersetzungen nachziehen ---
  console.log(`\nÜbersetze ${rows.length} Begriffe (ein LLM-Call je Begriff und Sprache) …`)
  const t0 = Date.now()
  const result = await translatePublishedTerms(rows.map((r) => r.id))
  console.log(
    `\n✓ ${result.translated} übersetzt, ${result.failed} fehlgeschlagen ` +
    `(${Math.round((Date.now() - t0) / 1000)}s)`,
  )

  // Gegenprobe: wie viele Übersetzungszeilen liegen jetzt vor?
  const { count } = await supabase
    .from('glossary_term_translations')
    .select('term_id', { count: 'exact', head: true })
    .eq('language', 'en')
  console.log(`glossary_term_translations (en): ${count ?? '?'} Zeilen`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
