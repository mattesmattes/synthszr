import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

// Load .env.local
config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const sources = [
  // The Information
  { name: 'AI Agenda', email: 'hello@theinformation.com' },
  { name: 'Applied AI', email: 'hello@theinformation.com' },
  { name: 'Weekend', email: 'hello@theinformation.com' },
  { name: 'Stephanie Palazzolo (AI Agenda)', email: 'stephanie@theinformation.com' },
  { name: 'Aaron Holmes (Applied AI)', email: 'aaron@theinformation.com' },

  // The Rundown AI
  { name: 'The Rundown AI (Daily)', email: 'news@daily.therundown.ai' },

  // AI Secret
  { name: 'AI Secret Newsletter', email: 'newsletter@aisecret.us' },

  // Substack
  { name: "Linas's Newsletter (FinTech/AI)", email: 'linas@substack.com' },
  { name: 'AI Supremacy (Michael Spencer)', email: 'aisupremacy+siphon@substack.com' },
  { name: 'Noahpinion', email: 'noahpinion@substack.com' },
  { name: 'Astral Codex Ten', email: 'astralcodexten@substack.com' },
  { name: 'Paul Krugman', email: 'paulkrugman@substack.com' },

  // Product Hunt
  { name: 'Product Hunt Weekly', email: 'hello@digest.producthunt.com' },

  // Wall Street Journal
  { name: 'The 10-Point (WSJ)', email: 'access@interactive.wsj.com' },

  // Semafor
  { name: 'Semafor Technology', email: 'technology@semafor.com' },

  // Gary Marcus
  { name: 'Marcus on AI', email: 'garymarcus@substack.com' },

  // Medium
  { name: 'Medium Daily Digest', email: 'noreply@medium.com' },
  { name: 'The Medium Newsletter', email: 'newsletters@medium.com' },
  { name: 'The UX Collective Newsletter', email: 'newsletters@medium.com' },
]

async function importSources() {
  console.log(`Importing ${sources.length} newsletter sources...`)

  let inserted = 0
  let skipped = 0

  for (const source of sources) {
    // Check if already exists
    const { data: existing } = await supabase
      .from('newsletter_sources')
      .select('id')
      .eq('email', source.email)
      .eq('name', source.name)
      .single()

    if (existing) {
      console.log(`⏭️  Skipped (exists): ${source.name}`)
      skipped++
      continue
    }

    const { error } = await supabase
      .from('newsletter_sources')
      .insert({
        name: source.name,
        email: source.email,
        enabled: true,
      })

    if (error) {
      console.error(`❌ Error inserting ${source.name}:`, error.message)
    } else {
      console.log(`✅ Inserted: ${source.name} (${source.email})`)
      inserted++
    }
  }

  console.log(`\nDone! Inserted: ${inserted}, Skipped: ${skipped}`)
}

importSources()
