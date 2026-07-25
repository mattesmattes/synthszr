import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// Env-Pfad optional als Argument (z.B. frische `vercel env pull`-Datei),
// sonst .env.local.
dotenv.config({ path: process.argv[2] || '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://zadrjbyszvsusukajsbp.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Charts-Teaser der Startseite (components/home-hero.tsx).
// "SYNTHSZR CHARTS" bleibt Eigenname, "Beta" ist universell (hartkodiert).
// Der Tagline-Ton folgt den bestehenden rankings.subtitle-Übersetzungen
// ("rocken" → setting the pace / cartonner / udávat tempo / den Takt angeven).
const TRANSLATIONS: Record<string, Record<string, string>> = {
  'home.charts_new': {
    en: 'New: SYNTHSZR CHARTS',
    fr: 'Nouveau : SYNTHSZR CHARTS',
    cs: 'Novinka: SYNTHSZR CHARTS',
    nds: 'Nieg: SYNTHSZR CHARTS',
  },
  'home.charts_tagline': {
    en: '— which products are setting the pace',
    fr: '— quels produits cartonnent en ce moment',
    cs: '— které produkty právě udávají tempo',
    nds: '— welke Produkten just den Takt angeevt',
  },
}

async function main() {
  for (const [key, byLang] of Object.entries(TRANSLATIONS)) {
    for (const [lang, value] of Object.entries(byLang)) {
      const { error } = await supabase
        .from('ui_translations')
        .upsert({ key, language_code: lang, value }, { onConflict: 'key,language_code' })
      if (error) {
        console.error(`✗ ${key} [${lang}]:`, error.message)
      } else {
        console.log(`✓ ${key} [${lang}]: ${value}`)
      }
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
