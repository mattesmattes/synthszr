import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://zadrjbyszvsusukajsbp.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const KEY = 'companies.detailed_analysis'
const TRANSLATIONS: Record<string, string> = {
  en: 'Detailed analysis here →',
  fr: 'Analyse détaillée ici →',
  es: 'Análisis detallado aquí →',
  it: 'Analisi dettagliata qui →',
  pt: 'Análise detalhada aqui →',
  nl: 'Gedetailleerde analyse hier →',
  pl: 'Szczegółowa analiza tutaj →',
  cs: 'Podrobná analýza zde →',
  nds: 'Utföhrliche Analyse hier →',
}

async function main() {
  for (const [lang, value] of Object.entries(TRANSLATIONS)) {
    const { error } = await supabase
      .from('ui_translations')
      .upsert(
        { key: KEY, language_code: lang, value },
        { onConflict: 'key,language_code' }
      )
    if (error) {
      console.error(`✗ ${lang}:`, error.message)
    } else {
      console.log(`✓ ${lang}: ${value}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
