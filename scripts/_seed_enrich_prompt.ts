/** Einmaliges Seeding: legt den Standard-Enrich-Prompt an und aktiviert ihn.
 *  Erst NACH der manuellen Migration (enrich_prompts_rename) ausfuehrbar —
 *  s. supabase/migrations/20260831120000_enrich_prompts_rename.sql.
 *  Aufruf: npx tsx scripts/_seed_enrich_prompt.ts <env-datei> */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

const envPath = process.argv[2] || '.env.local'
dotenv.config({ path: envPath, quiet: true })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// Direkt aus der Betreiber-Formulierung des Enrich-Feature-Prompts abgeleitet
// (2026-08-31): Fluessigkeit, Nachrecherche, Take-Schaerfe — in dieser Reihenfolge,
// weil Recherche-Ergaenzungen den Text danach ohnehin nochmal umformuliert braucht.
const PROMPT_TEXT = `Du bist der Enrichment-Editor für einen KI-News-Artikel. Du bekommst GENAU EINEN Abschnitt des Artikels (eine Überschrift plus ihren Text) und überarbeitest ihn eigenständig, ohne den Rest des Artikels zu sehen.

Deine Aufgaben, in dieser Reihenfolge:

1. NACHRECHERCHE: Prüfe die im Abschnitt genannten Fakten, Zahlen und Aussagen per Websuche gegen aktuelle Quellen. Ergänze oder korrigiere, wo die Recherche etwas Neueres oder Genaueres liefert. Erfinde nichts — findest du nichts Verlässliches, lässt du den Text an dieser Stelle unverändert.

2. SPRACHLICHER FLUSS: Überarbeite den Abschnitt, damit er flüssiger liest — klarere Satzübergänge, weniger Füllwörter, aktivere Verben. Inhalt und Kernaussagen bleiben erhalten, nur die Form wird besser.

3. NUR falls dieser Abschnitt mit "Synthszr Take" überschrieben ist, zusätzlich: schärfe die Einschätzung. Mehr analytische Tiefe, mehr kritische Distanz zum Hype, eine klarere eigene Position — kein bloßes Zusammenfassen der News davor.

FORMAT: Antworte NUR mit dem überarbeiteten Markdown des Abschnitts (Überschrift + Text). Kein Vorwort, keine Erklärung deiner Änderungen, kein umschließender Codeblock.`

async function main() {
  const { data: existing } = await supabase.from('enrich_prompts').select('id, name').eq('name', 'Enrich Standard')
  if (existing && existing.length > 0) {
    console.log('„Enrich Standard" existiert bereits (id=' + existing[0].id + ') — nichts getan. Lösche die Zeile zuerst, falls du neu seeden willst.')
    return
  }

  await supabase.from('enrich_prompts').update({ is_active: false }).neq('id', '00000000-0000-0000-0000-000000000000')

  const { data, error } = await supabase
    .from('enrich_prompts')
    .insert({ name: 'Enrich Standard', prompt_text: PROMPT_TEXT, is_active: true })
    .select()
    .single()

  if (error) { console.error('FEHLER:', error.message); process.exit(1) }
  console.log('„Enrich Standard" angelegt und aktiviert, id=' + data.id)
}
void main()
