/**
 * Import stylistic data from JSON file into Supabase
 *
 * Usage: npx tsx scripts/import-stylistic-data.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

// Load environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

interface StilistischesMerkmal {
  original: string
  ersetzung: string
  kategorie: string
}

interface StilistischeBeobachtungen {
  sprachregister: string
  fremdwortanteil: string
  metapherntypen: string[]
  typische_interpunktion: string
  personalpronomina: string
  textlaenge: string
  zitierverhalten: string
  nummerierung: string
  anglizismen_integration: string
}

interface JsonData {
  autor: string
  analysebasis: string
  stilistische_merkmale: StilistischesMerkmal[]
  wiederkehrende_phrasen: StilistischesMerkmal[]
  satzkonstruktionen: StilistischesMerkmal[]
  stilistische_beobachtungen: StilistischeBeobachtungen
  haeufige_autorenzitate: string[]
  statistik: Record<string, unknown>
}

// Map German categories to normalized database categories
function normalizeCategory(kategorie: string): string {
  const mapping: Record<string, string> = {
    'Fachbegriff': 'fachbegriff',
    'Eigener Fachbegriff': 'eigener_fachbegriff',
    'Akronym': 'akronym',
    'Anglizismus': 'anglizismus',
    'Business-Jargon': 'business_jargon',
    'Startup-Jargon': 'startup_jargon',
    'Metapher': 'metapher',
    'Bildliche Sprache': 'bildliche_sprache',
    'Neologismus': 'neologismus',
    'Wortspiel/Neologismus': 'neologismus',
    'Fremdwort': 'fremdwort',
    'Umgangssprache': 'umgangssprache',
    'Lieblingswort': 'lieblingswort',
    'Wortbildung': 'wortbildung',
    'Mantra': 'mantra',
    'Mantra/Anglizismus': 'mantra',
    'Eigenes Akronym': 'eigener_fachbegriff',
    'Praefixbildung': 'praefixbildung',
    'Zitat/Fachbegriff': 'zitat',
    'Zitat (Marc Andreessen)': 'zitat',
    'Zitat (Newton)': 'zitat',
    'Zitat (Paul Graham)': 'zitat',
    'Metapher (Christensen)': 'metapher',
    'Technische Metapher': 'metapher',
    'Fachbegriff (Herbert Simon)': 'fachbegriff',
    'Eigener Begriff': 'eigener_fachbegriff',
    'Eigene Definition': 'eigener_fachbegriff',
    'Eigene Methodik': 'eigener_fachbegriff',
    'Eigenes Konzeptmodell': 'eigener_fachbegriff',
    'Redewendung': 'redewendung',
    'Konzept': 'fachbegriff',
    'Satzkonstruktion': 'satzkonstruktion',
    'Konjunktion': 'satzkonstruktion',
    'Formalsprache': 'formalsprache',
    'Rhetorische Frage': 'rhetorische_frage',
    'Bekraeftigung': 'phrase',
    'Ueberleitung': 'phrase',
    'Einleitung': 'phrase',
    'Argumentationsstruktur': 'satzkonstruktion',
    'Narrativer Einschub': 'satzkonstruktion',
    'Aufzaehlungseinleitung': 'satzkonstruktion',
    'Erklaerungsstruktur': 'satzkonstruktion',
    'Erfahrungseinleitung': 'satzkonstruktion',
    'Reihenfolge': 'satzkonstruktion',
    'Kausalstruktur': 'satzkonstruktion',
    'Anleitungssprache': 'satzkonstruktion',
    'Symbolsprache': 'metapher',
    'Englische Einleitung': 'phrase',
    'Englische Konzeptreihe': 'anglizismus',
    'Englische Phasenbezeichnung': 'anglizismus',
    'Fachverweis': 'fachbegriff',
  }
  return mapping[kategorie] || kategorie.toLowerCase().replace(/[^a-z0-9]/g, '_')
}

async function importVocabulary(data: JsonData) {
  console.log('\n📚 Importing vocabulary (stilistische_merkmale)...')

  const entries = data.stilistische_merkmale.map(item => ({
    term: item.original,
    preferred_usage: item.ersetzung,
    avoid_alternatives: null,
    context: `Kategorie: ${item.kategorie}`,
    category: normalizeCategory(item.kategorie)
  }))

  // Insert in batches of 50
  const batchSize = 50
  let imported = 0

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize)
    const { error } = await supabase
      .from('vocabulary_dictionary')
      .upsert(batch, { onConflict: 'term', ignoreDuplicates: false })

    if (error) {
      console.error(`Error importing batch ${i / batchSize + 1}:`, error.message)
    } else {
      imported += batch.length
      console.log(`  ✓ Imported batch ${i / batchSize + 1} (${imported}/${entries.length})`)
    }
  }

  console.log(`✅ Imported ${imported} vocabulary entries`)
}

async function importPhrases(data: JsonData) {
  console.log('\n💬 Importing phrases (wiederkehrende_phrasen)...')

  const entries = data.wiederkehrende_phrasen.map(item => ({
    term: item.original,
    preferred_usage: item.ersetzung,
    avoid_alternatives: null,
    context: `Wiederkehrende Phrase - ${item.kategorie}`,
    category: 'phrase'
  }))

  const { error } = await supabase
    .from('vocabulary_dictionary')
    .upsert(entries, { onConflict: 'term', ignoreDuplicates: false })

  if (error) {
    console.error('Error importing phrases:', error.message)
  } else {
    console.log(`✅ Imported ${entries.length} phrases`)
  }
}

async function importSentenceConstructions(data: JsonData) {
  console.log('\n🔧 Importing sentence constructions (satzkonstruktionen)...')

  const entries = data.satzkonstruktionen.map(item => ({
    term: item.original,
    preferred_usage: item.ersetzung,
    avoid_alternatives: null,
    context: `Satzkonstruktion - ${item.kategorie}`,
    category: 'satzkonstruktion'
  }))

  const { error } = await supabase
    .from('vocabulary_dictionary')
    .upsert(entries, { onConflict: 'term', ignoreDuplicates: false })

  if (error) {
    console.error('Error importing constructions:', error.message)
  } else {
    console.log(`✅ Imported ${entries.length} sentence constructions`)
  }
}

async function importStylisticRules(data: JsonData) {
  console.log('\n📝 Importing stylistic rules...')

  const obs = data.stilistische_beobachtungen
  const rules = [
    {
      rule_type: 'sprachregister',
      name: 'Sprachregister',
      description: obs.sprachregister,
      priority: 90
    },
    {
      rule_type: 'stilregel',
      name: 'Fremdwortanteil',
      description: `Fremdwortanteil: ${obs.fremdwortanteil}`,
      priority: 80
    },
    {
      rule_type: 'interpunktion',
      name: 'Typische Interpunktion',
      description: obs.typische_interpunktion,
      priority: 70
    },
    {
      rule_type: 'personalpronomina',
      name: 'Personalpronomina',
      description: obs.personalpronomina,
      priority: 85
    },
    {
      rule_type: 'textlaenge',
      name: 'Textlänge',
      description: obs.textlaenge,
      priority: 75
    },
    {
      rule_type: 'zitierverhalten',
      name: 'Zitierverhalten',
      description: obs.zitierverhalten,
      priority: 65
    },
    {
      rule_type: 'stilregel',
      name: 'Nummerierung',
      description: obs.nummerierung,
      priority: 60
    },
    {
      rule_type: 'stilregel',
      name: 'Anglizismen-Integration',
      description: obs.anglizismen_integration,
      priority: 70
    },
    // Add metaphor types
    ...obs.metapherntypen.map((typ, idx) => ({
      rule_type: 'metapherntyp' as const,
      name: `Metapherntyp: ${typ.split(' ')[0]}`,
      description: typ,
      examples: typ.match(/\(([^)]+)\)/)?.[1] || null,
      priority: 50 - idx
    }))
  ]

  // Add frequently cited authors
  const authorRules = data.haeufige_autorenzitate.map((author, idx) => ({
    rule_type: 'autorenzitat' as const,
    name: author,
    description: `Häufig zitierter Autor: ${author}`,
    priority: 40 - idx
  }))

  const allRules = [...rules, ...authorRules]

  const { error } = await supabase
    .from('stylistic_rules')
    .upsert(allRules, { onConflict: 'name', ignoreDuplicates: false })

  if (error) {
    console.error('Error importing stylistic rules:', error.message)
  } else {
    console.log(`✅ Imported ${allRules.length} stylistic rules`)
  }
}

async function main() {
  const jsonPath = process.argv[2] || '/Users/mattes/dev/temp/stilistische_merkmale_schrader.json'

  console.log(`\n🚀 Starting import from: ${jsonPath}\n`)

  // Read JSON file
  const jsonContent = fs.readFileSync(jsonPath, 'utf-8')
  const data: JsonData = JSON.parse(jsonContent)

  console.log(`📊 Found:`)
  console.log(`   - ${data.stilistische_merkmale.length} stilistische Merkmale`)
  console.log(`   - ${data.wiederkehrende_phrasen.length} wiederkehrende Phrasen`)
  console.log(`   - ${data.satzkonstruktionen.length} Satzkonstruktionen`)
  console.log(`   - ${data.haeufige_autorenzitate.length} häufige Autorenzitate`)

  // Import all data
  await importVocabulary(data)
  await importPhrases(data)
  await importSentenceConstructions(data)
  await importStylisticRules(data)

  console.log('\n✅ Import complete!')

  // Show statistics
  const { count: vocabCount } = await supabase
    .from('vocabulary_dictionary')
    .select('*', { count: 'exact', head: true })

  const { count: rulesCount } = await supabase
    .from('stylistic_rules')
    .select('*', { count: 'exact', head: true })

  console.log(`\n📊 Database totals:`)
  console.log(`   - vocabulary_dictionary: ${vocabCount} entries`)
  console.log(`   - stylistic_rules: ${rulesCount} rules`)
}

main().catch(console.error)
