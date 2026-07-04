/**
 * Generiert SEO-Einleitungstexte für die Kategorie-Landingpages der Synthszr
 * Charts (summary = Meta-Description, intro = 2 Absätze), in 5 Sprachen, per
 * Sonnet. Idempotent: überspringt Kategorien, die bereits in category-intros.json
 * stehen (per --force alle neu). Grounding über echte Beispiel-Produkte.
 *
 *   npx tsx scripts/generate-category-intros.ts [--force]
 */
import { config } from 'dotenv'
config({ path: process.env.HOME + '/.synthszr.env.prod', quiet: true })
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const CAT_DATA = '/private/tmp/claude-501/-Users-mattes-Library-CloudStorage-Dropbox-dev-synthszr/235b1145-4c55-49b9-8894-2d362dd3afe1/scratchpad/cat_data.json'
const OUT = 'lib/rankings/category-intros.json'
const FORCE = process.argv.includes('--force')

type Cat = { slug: string; name: string; count: number; examples: string[] }
type Intro = { summary: string; intro: string[] }
type Entry = Record<string, Intro> // locale → Intro
type Store = Record<string, Entry>

async function main() {
  const cats: Cat[] = JSON.parse(readFileSync(CAT_DATA, 'utf8')).filter((c: Cat) => c.slug !== 'other')
  const store: Store = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  let done = 0
  const CONCURRENCY = 5
  const todo = cats.filter((c) => FORCE || !(store[c.slug]?.de && store[c.slug]?.en))
  const writeStore = () => {
    const sorted: Store = {}
    for (const k of Object.keys(store).sort()) sorted[k] = store[k]
    writeFileSync(OUT, JSON.stringify(sorted, null, 2))
  }
  async function work(c: Cat) {
    const prompt = `Du schreibst den Einleitungstext für eine Kategorie-Seite der "Synthszr Charts" — ein täglich aktualisiertes Ranking von KI-Produkten, das Momentum aus tausenden News- und Newsletter-Quellen misst (recency-gewichtet, versions-granular).

Kategorie: "${c.name}" (Slug: ${c.slug}). Beispiel-Produkte, die aktuell in dieser Kategorie ranken: ${c.examples.join(', ')}.

Schreibe auf Deutsch:
- "summary": EIN Satz, maximal 155 Zeichen, geeignet als Meta-Description. Sagt, was die Kategorie umfasst und dass sie täglich gerankt wird.
- "intro": GENAU 2 Absätze (je 2-3 Sätze). Absatz 1: was diese Kategorie umfasst, welche Art von Produkten, wofür sie genutzt werden. Absatz 2: wie die Synthszr Charts hier ranken (Momentum aus Erwähnungen in News-/Newsletter-Quellen, recency-gewichtet, versions-granular, täglich aktualisiert).

Harte Regeln: Konkret und faktisch. KEINE Floskeln ("in der heutigen schnelllebigen Welt", "nahtlos", "revolutionär", "Game-Changer"). Kein Marketing-Sprech, keine Dreier-Aufzählungen als Stilmittel, keine erfundenen Produktdetails. Nenne 2-3 der Beispiel-Produkte namentlich. Natürliches, sachliches Deutsch.

Übersetze danach summary und beide intro-Absätze nach: Englisch (en), Tschechisch (cs), Plattdeutsch (nds), Französisch (fr). Produktnamen und Zahlen bleiben unverändert. Gib alles über das Tool save_intros zurück.`
    try {
      // Tool-use erzwingt validiertes, strukturiertes JSON — kein Parse-Bruch
      // durch Anführungszeichen im generierten Text (Freitext-JSON scheiterte an
      // 45/50 Kategorien).
      const langSchema = { type: 'object' as const, properties: { summary: { type: 'string' }, intro: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 } }, required: ['summary', 'intro'] }
      const res = await client.messages.create({
        model: 'claude-sonnet-5', max_tokens: 4096,
        tools: [{ name: 'save_intros', description: 'Speichert die Kategorie-Intros in 5 Sprachen', input_schema: { type: 'object', properties: { de: langSchema, en: langSchema, cs: langSchema, nds: langSchema, fr: langSchema }, required: ['de', 'en', 'cs', 'nds', 'fr'] } }],
        tool_choice: { type: 'tool', name: 'save_intros' },
        messages: [{ role: 'user', content: prompt }],
      })
      const tool = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      if (!tool) { console.log(`SKIP ${c.slug}: kein tool_use`); return }
      const parsed = tool.input as Entry
      for (const loc of ['de', 'en', 'cs', 'nds', 'fr']) {
        if (!parsed[loc]?.summary || !Array.isArray(parsed[loc]?.intro) || parsed[loc].intro.length < 2) throw new Error(`unvollständig: ${loc}`)
      }
      store[c.slug] = parsed
      writeStore()
      done++
      console.log(`OK  ${c.slug} (${c.count} Produkte) — de.summary: ${parsed.de.summary.slice(0, 60)}…`)
    } catch (e) { console.log(`FEHLER ${c.slug}: ${(e as Error).message.slice(0, 90)}`) }
  }
  // Concurrency-Pool
  let idx = 0
  async function worker() { while (idx < todo.length) { const c = todo[idx++]; await work(c) } }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  console.log(`\nFertig: ${done} generiert, ${Object.keys(store).length} gesamt in ${OUT}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
